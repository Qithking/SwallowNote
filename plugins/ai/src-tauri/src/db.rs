//! ai.db 数据层（P2.3，§6.5）。
//!
//! - 库文件：`$SWALLOWNOTE_APP_DATA_DIR/plugin-data/com.swallownote.ai/ai.db`
//!   （明文 SQLite + 文件权限 0600；**key 不入库**，走宿主 secureStorage，键 `model:<id>`）
//! - 五表结构严格对齐方案 §6.5；会话删除经外键级联删除消息。
//! - 每命令短连接（单进程内多线程访问，open 成本可忽略），避免跨线程共享 Connection。

use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 插件数据目录（不存在则创建，权限 0700）。
pub fn plugin_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = app_data_dir.join("plugin-data").join("com.swallownote.ai");
    fs::create_dir_all(&dir).map_err(|e| format!("创建插件数据目录失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

/// 打开 ai.db 并确保表结构就绪（文件权限强制 0600）。
pub fn open_db(app_data_dir: &Path) -> Result<Connection, String> {
    let dir = plugin_dir(app_data_dir)?;
    let db_path = dir.join("ai.db");
    // 先以 0600 创建文件再交给 rusqlite，避免 rusqlite 自动建文件时使用默认权限
    if !db_path.exists() {
        fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&db_path)
            .map_err(|e| format!("创建 ai.db 失败: {}", e))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&db_path, fs::Permissions::from_mode(0o600));
    }
    let conn = Connection::open(&db_path).map_err(|e| format!("打开 ai.db 失败: {}", e))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("启用外键失败: {}", e))?;
    migrate(&conn)?;
    Ok(conn)
}

/// 建表（§6.5，幂等）。会话删除 → 消息外键级联。
fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_sessions(
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_messages(
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            display_text TEXT,
            role_key TEXT,
            meta_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, created_at);
        CREATE TABLE IF NOT EXISTS ai_role_prompts(
            role_key TEXT PRIMARY KEY,
            name TEXT,
            prompt TEXT,
            is_builtin INTEGER DEFAULT 0,
            sort_order INTEGER
        );
        CREATE TABLE IF NOT EXISTS ai_models(
            id TEXT PRIMARY KEY,
            name TEXT,
            provider TEXT,
            model_id TEXT,
            base_url TEXT,
            context_window INTEGER,
            is_default INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ai_settings(key TEXT PRIMARY KEY, value TEXT);
        "#,
    )
    .map_err(|e| format!("建表失败: {}", e))
}

/// 当前 Unix 毫秒时间戳。
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------- 会话 ----------

pub fn list_sessions(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, updated_at FROM ai_sessions ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
                "updatedAt": r.get::<_, i64>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "sessions": sessions }))
}

/// 新建会话；title 空时用「新对话」。
pub fn create_session(conn: &Connection, title: &str) -> Result<Value, String> {
    let id = new_id();
    let now = now_ms();
    let title = if title.trim().is_empty() { "新对话" } else { title };
    conn.execute(
        "INSERT INTO ai_sessions(id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        rusqlite::params![id, title, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "title": title, "createdAt": now, "updatedAt": now }))
}

pub fn rename_session(conn: &Connection, id: &str, title: &str) -> Result<Value, String> {
    touch_session_at(conn, id)?;
    let n = conn
        .execute(
            "UPDATE ai_sessions SET title = ?2, updated_at = updated_at WHERE id = ?1",
            rusqlite::params![id, title],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("会话不存在".into());
    }
    Ok(json!({ "ok": true }))
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<Value, String> {
    let n = conn
        .execute("DELETE FROM ai_sessions WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("会话不存在".into());
    }
    Ok(json!({ "ok": true }))
}

/// 刷新会话 updated_at（会话不存在时静默忽略，便于消息写入不依赖会话存在性校验顺序）。
fn touch_session_at(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE ai_sessions SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 消息 ----------

pub fn list_messages(conn: &Connection, session_id: &str) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, display_text, role_key, meta_json, created_at
             FROM ai_messages WHERE session_id = ?1 ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "sessionId": r.get::<_, String>(1)?,
                "role": r.get::<_, String>(2)?,
                "content": r.get::<_, String>(3)?,
                "displayText": r.get::<_, Option<String>>(4)?,
                "roleKey": r.get::<_, Option<String>>(5)?,
                "metaJson": r.get::<_, Option<String>>(6)?,
                "createdAt": r.get::<_, i64>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "messages": messages }))
}

/// 追加消息并刷新会话 updated_at。createdAt 缺省取当前时间。
#[allow(clippy::too_many_arguments)]
pub fn append_message(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
    display_text: Option<&str>,
    role_key: Option<&str>,
    meta_json: Option<&str>,
    created_at: Option<i64>,
) -> Result<Value, String> {
    let id = new_id();
    let now = created_at.unwrap_or_else(now_ms);
    conn.execute(
        "INSERT INTO ai_messages(id, session_id, role, content, display_text, role_key, meta_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, session_id, role, content, display_text, role_key, meta_json, now],
    )
    .map_err(|e| e.to_string())?;
    touch_session_at(conn, session_id)?;
    Ok(json!({ "id": id, "createdAt": now }))
}

// ---------- 角色提示词 ----------

pub fn list_role_prompts(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role_key, name, prompt, is_builtin, sort_order
             FROM ai_role_prompts ORDER BY sort_order ASC, role_key ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "roleKey": r.get::<_, String>(0)?,
                "name": r.get::<_, Option<String>>(1)?,
                "prompt": r.get::<_, Option<String>>(2)?,
                "isBuiltin": r.get::<_, Option<i64>>(3)?.unwrap_or(0) != 0,
                "sortOrder": r.get::<_, Option<i64>>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut prompts = Vec::new();
    for row in rows {
        prompts.push(row.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "rolePrompts": prompts }))
}

/// 保存（upsert）。isBuiltin 缺省 false，sortOrder 缺省 0。
pub fn save_role_prompt(
    conn: &Connection,
    role_key: &str,
    name: &str,
    prompt: &str,
    is_builtin: bool,
    sort_order: i64,
) -> Result<Value, String> {
    conn.execute(
        "INSERT INTO ai_role_prompts(role_key, name, prompt, is_builtin, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(role_key) DO UPDATE SET name = ?2, prompt = ?3, is_builtin = ?4, sort_order = ?5",
        rusqlite::params![role_key, name, prompt, is_builtin as i64, sort_order],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn delete_role_prompt(conn: &Connection, role_key: &str) -> Result<Value, String> {
    conn.execute(
        "DELETE FROM ai_role_prompts WHERE role_key = ?1",
        rusqlite::params![role_key],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

// ---------- 模型 ----------

pub fn list_models(conn: &Connection) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, provider, model_id, base_url, context_window, is_default
             FROM ai_models ORDER BY is_default DESC, name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, Option<String>>(1)?,
                "provider": r.get::<_, Option<String>>(2)?,
                "modelId": r.get::<_, Option<String>>(3)?,
                "baseUrl": r.get::<_, Option<String>>(4)?,
                "contextWindow": r.get::<_, Option<i64>>(5)?,
                "isDefault": r.get::<_, Option<i64>>(6)?.unwrap_or(0) != 0,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut models = Vec::new();
    for row in rows {
        models.push(row.map_err(|e| e.to_string())?);
    }
    Ok(json!({ "models": models }))
}

/// 按 id 取单个模型行（P2.4 streamChat 解析用）；不存在返回 Err。
pub fn get_model(conn: &Connection, id: &str) -> Result<Value, String> {
    conn.query_row(
        "SELECT id, name, provider, model_id, base_url, context_window
         FROM ai_models WHERE id = ?1",
        rusqlite::params![id],
        |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, Option<String>>(1)?,
                "provider": r.get::<_, Option<String>>(2)?,
                "modelId": r.get::<_, Option<String>>(3)?,
                "baseUrl": r.get::<_, Option<String>>(4)?,
                "contextWindow": r.get::<_, Option<i64>>(5)?,
            }))
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "模型不存在".to_string(),
        other => other.to_string(),
    })
}

/// 保存模型（upsert）；新模型时 id 缺省生成 uuid。首个模型自动设为默认。
/// **注意：key 永不入库**——前端在调用 saveModel 前后经宿主 secureStorage 写 `model:<id>`。
pub fn save_model(
    conn: &Connection,
    id: Option<&str>,
    name: &str,
    provider: &str,
    model_id: &str,
    base_url: &str,
    context_window: i64,
) -> Result<Value, String> {
    let id = match id {
        Some(x) if !x.trim().is_empty() => x.to_string(),
        _ => new_id(),
    };
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_models", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let is_default = if count == 0 { 1 } else { 0 };
    conn.execute(
        "INSERT INTO ai_models(id, name, provider, model_id, base_url, context_window, is_default)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET name = ?2, provider = ?3, model_id = ?4, base_url = ?5, context_window = ?6",
        rusqlite::params![id, name, provider, model_id, base_url, context_window, is_default],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id, "isDefault": is_default != 0 }))
}

/// 删除模型行。**级联删除 secureStorage 键由前端编排**：本命令成功后前端须调
/// 宿主 `deleteSecure("model:<id>")`（secureStorage 仅前端可达，见方案 P2.3 修订）。
pub fn delete_model(conn: &Connection, id: &str) -> Result<Value, String> {
    let n = conn
        .execute("DELETE FROM ai_models WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("模型不存在".into());
    }
    Ok(json!({ "ok": true }))
}

/// 设置默认模型（唯一性：先清全部再置位）。
pub fn set_default_model(conn: &Connection, id: &str) -> Result<Value, String> {
    let n = conn
        .execute("UPDATE ai_models SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    let _ = n;
    let n = conn
        .execute(
            "UPDATE ai_models SET is_default = 1 WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("模型不存在".into());
    }
    Ok(json!({ "ok": true }))
}

// ---------- 设置 ----------

pub fn get_setting(conn: &Connection, key: &str) -> Result<Value, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM ai_settings WHERE key = ?1",
            rusqlite::params![key],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    Ok(json!({ "value": value }))
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<Value, String> {
    conn.execute(
        "INSERT INTO ai_settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试独立临时目录。
    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ai-plugin-db-test-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_db_creates_file_with_0600_and_tables() {
        let dir = tmp_dir("open");
        let conn = open_db(&dir).unwrap();
        // 五表齐备
        for table in [
            "ai_sessions",
            "ai_messages",
            "ai_role_prompts",
            "ai_models",
            "ai_settings",
        ] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "缺表 {}", table);
        }
        // 文件权限 0600（unix）
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(dir.join("plugin-data/com.swallownote.ai/ai.db")).unwrap();
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        }
        // 目录权限 0700（unix）
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta =
                fs::metadata(dir.join("plugin-data/com.swallownote.ai")).unwrap();
            assert_eq!(meta.permissions().mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn session_crud_and_cascade_delete() {
        let dir = tmp_dir("session");
        let conn = open_db(&dir).unwrap();
        let s = create_session(&conn, "").unwrap();
        let sid = s["id"].as_str().unwrap().to_string();
        assert_eq!(s["title"], "新对话");

        append_message(&conn, &sid, "user", "你好", Some("你好"), None, None, None).unwrap();
        append_message(&conn, &sid, "assistant", "回复", None, None, None, None).unwrap();

        let msgs = list_messages(&conn, &sid).unwrap();
        assert_eq!(msgs["messages"].as_array().unwrap().len(), 2);

        // 删除会话 → 消息级联删除
        delete_session(&conn, &sid).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "会话删除后消息应级联删除");
        // 再删报错
        assert!(delete_session(&conn, &sid).is_err());
    }

    #[test]
    fn message_ordering_and_rename() {
        let dir = tmp_dir("order");
        let conn = open_db(&dir).unwrap();
        let s = create_session(&conn, "会话A").unwrap();
        let sid = s["id"].as_str().unwrap().to_string();
        append_message(&conn, &sid, "user", "早", None, None, None, Some(100)).unwrap();
        append_message(&conn, &sid, "assistant", "早!", None, None, None, Some(200)).unwrap();
        let msgs = list_messages(&conn, &sid).unwrap()["messages"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(msgs[0]["content"], "早");
        assert_eq!(msgs[1]["content"], "早!");

        rename_session(&conn, &sid, "改名").unwrap();
        let sessions = list_sessions(&conn).unwrap()["sessions"].as_array().unwrap().clone();
        assert_eq!(sessions[0]["title"], "改名");
    }

    #[test]
    fn role_prompt_upsert_and_delete() {
        let dir = tmp_dir("role");
        let conn = open_db(&dir).unwrap();
        save_role_prompt(&conn, "polish", "润色", "提示词", false, 1).unwrap();
        save_role_prompt(&conn, "polish", "润色2", "新提示词", false, 1).unwrap();
        let list = list_role_prompts(&conn).unwrap()["rolePrompts"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "润色2");
        assert_eq!(list[0]["isBuiltin"], false);
        delete_role_prompt(&conn, "polish").unwrap();
        assert_eq!(
            list_role_prompts(&conn).unwrap()["rolePrompts"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn model_crud_default_uniqueness() {
        let dir = tmp_dir("model");
        let conn = open_db(&dir).unwrap();
        // 首个模型自动默认
        let m1 = save_model(&conn, None, "GPT", "openai", "gpt-4o", "", 128000).unwrap();
        assert_eq!(m1["isDefault"], true);
        let m2 = save_model(&conn, None, "Claude", "anthropic", "claude-3", "", 200000).unwrap();
        assert_eq!(m2["isDefault"], false);

        set_default_model(&conn, m2["id"].as_str().unwrap()).unwrap();
        let models = list_models(&conn).unwrap()["models"].as_array().unwrap().clone();
        let defaults = models
            .iter()
            .filter(|m| m["isDefault"] == true)
            .count();
        assert_eq!(defaults, 1, "默认模型必须唯一");

        // upsert 不新增行
        save_model(
            &conn,
            Some(m1["id"].as_str().unwrap()),
            "GPT改",
            "openai",
            "gpt-4o-mini",
            "https://x.io/v1",
            64000,
        )
        .unwrap();
        let models = list_models(&conn).unwrap()["models"].as_array().unwrap().clone();
        assert_eq!(models.len(), 2);

        delete_model(&conn, m1["id"].as_str().unwrap()).unwrap();
        assert!(delete_model(&conn, m1["id"].as_str().unwrap()).is_err());
    }

    #[test]
    fn get_model_by_id_roundtrip_and_missing() {
        let dir = tmp_dir("get_model");
        let conn = open_db(&dir).unwrap();
        let m = save_model(&conn, None, "GPT", "openai", "gpt-4o", "https://x.io/v1", 128000)
            .unwrap();
        let id = m["id"].as_str().unwrap();
        let got = get_model(&conn, id).unwrap();
        assert_eq!(got["provider"], "openai");
        assert_eq!(got["modelId"], "gpt-4o");
        assert_eq!(got["baseUrl"], "https://x.io/v1");
        assert_eq!(got["contextWindow"], 128000);
        // 不存在的模型返回「模型不存在」
        let err = get_model(&conn, "no-such-id").unwrap_err();
        assert!(err.contains("模型不存在"));
    }

    #[test]
    fn settings_roundtrip() {
        let dir = tmp_dir("setting");
        let conn = open_db(&dir).unwrap();
        assert_eq!(get_setting(&conn, "k").unwrap()["value"], Value::Null);
        set_setting(&conn, "k", "v1").unwrap();
        set_setting(&conn, "k", "v2").unwrap();
        assert_eq!(get_setting(&conn, "k").unwrap()["value"], "v2");
    }
}
