//! 内置 AI 存量数据一次性导出（P3.1，方案 §5 P3.1 / §6.5）。
//!
//! 主应用升级后首次启动：把旧 `ai_messages`、`ai_role_prompts` 表与
//! `settings.aiModels`（session_state 键）导出为
//! `plugin-data/swallownote-ai-migration.json`（AI 插件首启导入，schema 见
//! 插件 import.rs v1——**不含任何密钥材料**），同时把自配模型 key 完成
//! 双算法迁移（legacy 解密 → secureStorage 新算法重加密）直写宿主
//! `secure_storage` 表（键 `model:<id>`），最后 drop 旧表、删除旧键。
//!
//! 幂等设计：本模块在 `init_db` **建表之前**调用，以旧表是否存在判定——
//! drop 之后旧表不再存在，后续启动自然跳过，无需迁移标记。
//! 失败安全：任一步失败即中止且不 drop（下次启动重试），不阻塞应用启动。

use crate::crypto;
use crate::db::secure_storage;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

/// AI 插件 id（密钥迁移的目标插件命名空间）。
const AI_PLUGIN_ID: &str = "com.swallownote.ai";
/// 旧模型清单的 session_state 键（SETTINGS_PREFIX 约定）。
const LEGACY_MODELS_KEY: &str = "settings.aiModels";

/// 入口：有可导出数据则导出并清理；无数据（含全新安装）仅做旧表清理。
/// 所有失败仅记日志（best-effort），不阻塞应用启动。
pub fn run_if_needed(conn: &Connection, app_data_dir: &Path) {
    match export(conn, app_data_dir) {
        Ok(summary) => {
            if summary.exported {
                log::info!(
                    "[ai-migration] exported: messages={} rolePrompts={} models={} keysMigrated={} file={}",
                    summary.messages,
                    summary.role_prompts,
                    summary.models,
                    summary.keys_migrated,
                    summary.file_display
                );
            }
        }
        Err(e) => log::error!("[ai-migration] 导出失败（旧数据保留，下次启动重试）: {}", e),
    }
}

struct ExportSummary {
    exported: bool,
    messages: usize,
    role_prompts: usize,
    models: usize,
    keys_migrated: usize,
    file_display: String,
}

/// 核心导出。返回 Err 时**不 drop、不写文件**（下次启动重试）。
fn export(conn: &Connection, app_data_dir: &Path) -> Result<ExportSummary, String> {
    // 旧表不存在（全新安装 / 已迁移）→ 直接跳过（无表可清理）
    if !table_exists(conn, "ai_messages")? && !table_exists(conn, "ai_role_prompts")? {
        return Ok(ExportSummary {
            exported: false,
            messages: 0,
            role_prompts: 0,
            models: 0,
            keys_migrated: 0,
            file_display: String::new(),
        });
    }

    // ---- 读取三段旧数据 ----
    let messages = read_legacy_messages(conn)?;
    let role_prompts = read_legacy_role_prompts(conn)?;
    let models_raw = read_legacy_models(conn)?;

    // 内置模型条目跳过（§6.11）；自配条目剥离任何密钥字段（apiKey/_decryptedApiKey）
    let mut models: Vec<Value> = Vec::new();
    let mut model_keys: Vec<(String, String)> = Vec::new(); // (model_id, legacy 密文)
    for m in &models_raw {
        if m["isBuiltIn"].as_bool().unwrap_or(false) {
            continue;
        }
        let Some(id) = m["id"].as_str().filter(|s| !s.is_empty()) else {
            continue;
        };
        let mut entry = m.clone();
        if let Some(obj) = entry.as_object_mut() {
            obj.remove("apiKey");
            obj.remove("_decryptedApiKey");
        }
        if let Some(key_cipher) = m["apiKey"].as_str().filter(|s| !s.is_empty()) {
            model_keys.push((id.to_string(), key_cipher.to_string()));
        }
        models.push(entry);
    }

    let has_user_data = !messages.is_empty() || !models.is_empty() || has_custom_role(&role_prompts);

    // ---- 密钥双算法迁移：legacy 解密 → secureStorage 新算法重加密，直写宿主表 ----
    // 单个 key 解密失败（如库从其他机器恢复，密文本就不可解）只跳过该 key
    // （模型行仍导出，用户在插件里重填即可），不阻塞整体迁移。
    let mut keys_migrated = 0usize;
    for (id, cipher) in &model_keys {
        let plain = match crypto::decrypt_api_key(cipher) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("[ai-migration] 模型 {} 的 API key 解密失败，跳过该 key（需在插件中重配）: {}", id, e);
                continue;
            }
        };
        if plain.is_empty() {
            continue;
        }
        let reencrypted = crypto::encrypt_plugin_secret(AI_PLUGIN_ID, &plain)?;
        secure_storage::upsert_secret(conn, AI_PLUGIN_ID, &format!("model:{}", id), &reencrypted)
            .map_err(|e| format!("写入 secure_storage 失败（模型 {}）: {}", id, e))?;
        keys_migrated += 1;
    }

    if has_user_data {
        let file_path = migration_file_path(app_data_dir);
        let payload = json!({
            "version": 1,
            "exportedAt": now_millis(),
            "messages": messages,
            "rolePrompts": role_prompts,
            "aiModels": models,
        });
        write_private_json(&file_path, &payload)?;
        // 文件先落盘成功后才允许清理旧表（下一段）
        cleanup_legacy(conn)?;
        return Ok(ExportSummary {
            exported: true,
            messages: messages.len(),
            role_prompts: role_prompts.len(),
            models: models.len(),
            keys_migrated,
            file_display: file_path.display().to_string(),
        });
    }

    // 无用户数据（全新安装或空库）：不产生迁移文件，仅清理旧表/旧键
    cleanup_legacy(conn)?;
    Ok(ExportSummary {
        exported: false,
        messages: 0,
        role_prompts: 0,
        models: 0,
        keys_migrated,
        file_display: String::new(),
    })
}

/// 导出文件路径：`<app_data_dir>/plugin-data/swallownote-ai-migration.json`。
fn migration_file_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir
        .join("plugin-data")
        .join("swallownote-ai-migration.json")
}

/// drop 旧表 + 删除旧 session_state 键。
fn cleanup_legacy(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS ai_messages;
         DROP TABLE IF EXISTS ai_role_prompts;
         DELETE FROM session_state WHERE key = 'settings.aiModels';",
    )
    .map_err(|e| format!("清理旧表/旧键失败: {}", e))
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// 旧消息（含分页截断的历史，按 id 升序导出，插件按时间序入默认会话）。
/// 表不存在（边缘态：仅其一存活）按空处理。
fn read_legacy_messages(conn: &Connection) -> Result<Vec<Value>, String> {
    if !table_exists(conn, "ai_messages")? {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, model_id, created_at
             FROM ai_messages ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "role": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "model_id": row.get::<_, String>(3)?,
                "created_at": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 旧角色提示词（含内置与自定义；字段名与插件导入侧对齐）。表不存在按空处理。
fn read_legacy_role_prompts(conn: &Connection) -> Result<Vec<Value>, String> {
    if !table_exists(conn, "ai_role_prompts")? {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, role_key, name, prompt, is_builtin, created_at, updated_at
             FROM ai_role_prompts ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "role_key": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "prompt": row.get::<_, String>(3)?,
                "is_builtin": row.get::<_, i64>(4)?,
                "created_at": row.get::<_, String>(5)?,
                "updated_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// `settings.aiModels`（JSON 数组字符串）→ Value 数组；键不存在/解析失败按空处理。
fn read_legacy_models(conn: &Connection) -> Result<Vec<Value>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM session_state WHERE key = ?1",
            [LEGACY_MODELS_KEY],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let parsed: Result<Value, _> = serde_json::from_str(&raw);
    match parsed {
        Ok(v) => Ok(v.as_array().cloned().unwrap_or_default()),
        Err(e) => {
            // 清单损坏不应阻塞整体迁移：记日志按空处理
            log::warn!("[ai-migration] {} 解析失败，按无模型处理: {}", LEGACY_MODELS_KEY, e);
            Ok(Vec::new())
        }
    }
}

/// 是否存在自定义角色（is_builtin = 0）。
fn has_custom_role(prompts: &[Value]) -> bool {
    prompts.iter().any(|p| p["is_builtin"].as_i64() == Some(0))
}

/// 当前 Unix 毫秒。
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 写 JSON 文件并设 0600 权限（§6.5 隐私边界：与旧 SQLite 同水平）。
fn write_private_json(path: &Path, payload: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 plugin-data 目录失败: {}", e))?;
    }
    let body = serde_json::to_string_pretty(payload).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| format!("写迁移文件失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("设置迁移文件权限失败: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时数据目录。
    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "legacy-ai-export-test-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 旧库镜像：legacy 两表 + session_state + secure_storage（生产 DDL）。
    fn legacy_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE ai_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model_id TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')));
             CREATE TABLE ai_role_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                is_builtin INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')));
             CREATE TABLE session_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE secure_storage (
                plugin_id TEXT NOT NULL, key TEXT NOT NULL, ciphertext TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
                PRIMARY KEY (plugin_id, key));",
        )
        .unwrap();
        c
    }

    fn insert_prompt(c: &Connection, key: &str, name: &str, builtin: bool) {
        c.execute(
            "INSERT INTO ai_role_prompts (role_key, name, prompt, is_builtin) VALUES (?1, ?2, 'p', ?3)",
            rusqlite::params![key, name, builtin as i64],
        )
        .unwrap();
    }

    fn set_models(c: &Connection, json: &str) {
        c.execute(
            "INSERT INTO session_state (key, value) VALUES ('settings.aiModels', ?1)",
            [json],
        )
        .unwrap();
    }

    #[test]
    fn export_full_roundtrip() {
        let c = legacy_conn();
        let dir = tmp_dir("full");
        c.execute("INSERT INTO ai_messages (role, content, model_id, created_at) VALUES ('user', '你好', 'm1', '2025-01-02 08:30:00')", []).unwrap();
        insert_prompt(&c, "polish", "润色", true);
        insert_prompt(&c, "my_role", "自定义", false);
        let plain_key = "sk-secret-密钥-abc";
        let cipher = crypto::encrypt_api_key(plain_key).unwrap();
        set_models(
            &c,
            &format!(
                r#"[{{"id":"builtin-1","name":"内置","category":"api","provider":"openai","apiKey":"x","baseUrl":"","model":"gpt-4o-mini","isBuiltIn":true}},
                    {{"id":"m1","name":"我的GPT","category":"api","provider":"openai","apiKey":"{cipher}","baseUrl":"https://api.x.com/v1","model":"gpt-4o","isBuiltIn":false}}]"#
            ),
        );

        let s = export(&c, &dir).unwrap();
        assert!(s.exported);
        assert_eq!(s.messages, 1);
        assert_eq!(s.role_prompts, 2);
        assert_eq!(s.models, 1, "内置模型条目应跳过");
        assert_eq!(s.keys_migrated, 1);

        // 迁移文件：字段完整、无任何密钥材料
        let file = migration_file_path(&dir);
        assert!(file.exists());
        let text = fs::read_to_string(&file).unwrap();
        assert!(!text.contains(plain_key), "文件不得含明文 key");
        assert!(!text.contains(&cipher), "文件不得含 legacy 密文");
        assert!(!text.contains("apiKey"), "文件不得含 apiKey 字段");
        let data: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(data["version"], 1);
        assert_eq!(data["messages"][0]["content"], "你好");
        assert_eq!(data["messages"][0]["created_at"], "2025-01-02 08:30:00");
        assert_eq!(data["rolePrompts"].as_array().unwrap().len(), 2);
        let models = data["aiModels"].as_array().unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["id"], "m1");
        assert_eq!(models[0]["baseUrl"], "https://api.x.com/v1");

        // 密钥已直写宿主 secure_storage（model:<id>），且可用新算法解回明文
        let stored = secure_storage::read_secret(&c, AI_PLUGIN_ID, "model:m1")
            .unwrap()
            .expect("secure_storage 应有 model:m1");
        assert_eq!(
            crypto::decrypt_plugin_secret(AI_PLUGIN_ID, &stored).unwrap(),
            plain_key
        );
        // 内置模型无对应键
        assert!(secure_storage::read_secret(&c, AI_PLUGIN_ID, "model:builtin-1")
            .unwrap()
            .is_none());

        // 旧表/旧键已清理
        assert!(!table_exists(&c, "ai_messages").unwrap());
        assert!(!table_exists(&c, "ai_role_prompts").unwrap());
        let n: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM session_state WHERE key = 'settings.aiModels'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn rerun_after_export_is_noop() {
        let c = legacy_conn();
        let dir = tmp_dir("rerun");
        c.execute("INSERT INTO ai_messages (role, content, model_id, created_at) VALUES ('user', 'x', 'm', '2025-01-02 08:30:00')", []).unwrap();
        export(&c, &dir).unwrap();
        assert!(migration_file_path(&dir).exists());
        // drop 后旧表不存在 → 二次运行跳过且不重建文件
        fs::remove_file(migration_file_path(&dir)).unwrap();
        let s2 = export(&c, &dir).unwrap();
        assert!(!s2.exported);
        assert!(!migration_file_path(&dir).exists());
    }

    #[test]
    fn fresh_install_no_file_but_tables_cleaned() {
        let c = legacy_conn();
        let dir = tmp_dir("fresh");
        // 仅内置角色（启动种子态），无消息无模型 → 无用户数据
        insert_prompt(&c, "chat", "智能问答", true);
        let s = export(&c, &dir).unwrap();
        assert!(!s.exported, "无用户数据不得产生迁移文件");
        assert!(!migration_file_path(&dir).exists());
        assert!(!table_exists(&c, "ai_role_prompts").unwrap());
    }

    #[test]
    fn no_tables_at_all_is_noop() {
        let c = Connection::open_in_memory().unwrap();
        c.execute("CREATE TABLE session_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []).unwrap();
        let dir = tmp_dir("notable");
        let s = export(&c, &dir).unwrap();
        assert!(!s.exported);
        assert!(!migration_file_path(&dir).exists());
    }

    #[test]
    fn custom_role_only_still_exports() {
        let c = legacy_conn();
        let dir = tmp_dir("custom-role");
        insert_prompt(&c, "chat", "智能问答", true);
        insert_prompt(&c, "mine", "我的角色", false);
        let s = export(&c, &dir).unwrap();
        assert!(s.exported, "自定义角色属于用户数据，应导出");
        let text = fs::read_to_string(migration_file_path(&dir)).unwrap();
        assert!(text.contains("\"mine\""));
    }

    #[test]
    fn undecryptable_key_skipped_not_fatal() {
        let c = legacy_conn();
        let dir = tmp_dir("badkey");
        set_models(
            &c,
            r#"[{"id":"m1","name":"坏key模型","category":"api","provider":"openai","apiKey":"!!!not-base64!!!","baseUrl":"https://x","model":"gpt","isBuiltIn":false}]"#,
        );
        let s = export(&c, &dir).unwrap();
        assert!(s.exported, "坏 key 只跳过，不阻塞整体导出");
        assert_eq!(s.keys_migrated, 0);
        assert!(secure_storage::read_secret(&c, AI_PLUGIN_ID, "model:m1")
            .unwrap()
            .is_none());
        // 模型行仍在迁移文件中
        let text = fs::read_to_string(migration_file_path(&dir)).unwrap();
        assert!(text.contains("坏key模型"));
    }

    #[test]
    fn corrupted_models_json_does_not_block_export() {
        let c = legacy_conn();
        let dir = tmp_dir("badjson");
        c.execute("INSERT INTO ai_messages (role, content, model_id, created_at) VALUES ('user', 'x', 'm', '2025-01-02 08:30:00')", []).unwrap();
        set_models(&c, "not-a-json");
        let s = export(&c, &dir).unwrap();
        assert!(s.exported);
        let text = fs::read_to_string(migration_file_path(&dir)).unwrap();
        let data: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(data["aiModels"].as_array().unwrap().len(), 0);
    }
}
