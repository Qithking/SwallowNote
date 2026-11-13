//! 插件 secureStorage IPC 命令（P1.5 / ADR-0003）。
//!
//! 值以明文经 IPC 到达宿主后**即刻加密**入库（落盘只有密文）；
//! 读取时解密后返回。权限门控在前端宿主桥接层（assertPermission，
//! 要求 'secure-storage' 细目），Rust 侧仅做插件 ID 边界校验。
//! 威胁模型边界见 ADR-0003：防落盘明文泄露，不防同 webview 内插件。

use crate::crypto;
use crate::db::secure_storage as repo;
use crate::db::Database;
use tauri::{Manager, State};

#[tauri::command]
pub fn secure_storage_set(
    db: State<'_, Database>,
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    // IPC 边界路径遍历防护（与 settings 同模式）。
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let ciphertext = crypto::encrypt_plugin_secret(&plugin_id, &value)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::upsert_secret(&conn, &plugin_id, &key, &ciphertext).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_storage_get(
    db: State<'_, Database>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match repo::read_secret(&conn, &plugin_id, &key).map_err(|e| e.to_string())? {
        None => Ok(None),
        Some(ciphertext) => crypto::decrypt_plugin_secret(&plugin_id, &ciphertext)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn secure_storage_delete(
    db: State<'_, Database>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::delete_secret(&conn, &plugin_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_storage_keys(
    db: State<'_, Database>,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    crate::commands::plugin::validate_plugin_id(&plugin_id).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::list_secret_keys(&conn, &plugin_id).map_err(|e| e.to_string())
}

/// 卸载流程辅助：勾选 delete_data 时连带删该插件全部密文（默认保留）。
/// 幂等，best-effort 调用方记录日志即可。
pub fn drop_secure_storage_for(app: &tauri::AppHandle, plugin_id: &str) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::drop_secure_storage_for(&conn, plugin_id).map_err(|e| e.to_string())
}

/// B3 启动迁移：secure_storage 表内旧派生（machine_id）密文重加密为
/// keyring 主密钥派生（v2）。幂等：
/// - 已是 v2 密文（v2 解密成功）→ 跳过；
/// - 仅 legacy 派生可解 → v2 重加密回写；
/// - 两者都解不开（换机器等）→ 保留原样，不阻塞其余行。
/// master key 不可用时整体跳过（数据不动，读路径双试兜底）。
/// 返回 (迁移行数, 跳过行数)。
pub fn migrate_secure_storage_to_keyring(conn: &rusqlite::Connection) -> Result<(usize, usize), String> {
    let master_key = match crypto::get_master_key() {
        Some(k) => k,
        None => {
            log::warn!("[crypto-migrate] master key unavailable (keyring), skip migration");
            return Ok((0, 0));
        }
    };
    let rows = repo::read_all_secrets(conn).map_err(|e| e.to_string())?;
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    for (plugin_id, key, ciphertext) in rows {
        if ciphertext.is_empty() {
            skipped += 1;
            continue;
        }
        // 已是 v2 密文：跳过（v2-only 判定，无回退——带回退会把 legacy 密文误判）
        if crypto::decrypt_plugin_secret_v2_only(&plugin_id, &master_key, &ciphertext).is_ok()
        {
            skipped += 1;
            continue;
        }
        // 仅 legacy 可解：重加密回写
        match crypto::decrypt_plugin_secret_legacy(&plugin_id, &ciphertext) {
            Ok(plaintext) => {
                let new_ct =
                    crypto::encrypt_plugin_secret_with_master(&plugin_id, &master_key, &plaintext)?;
                repo::upsert_secret(conn, &plugin_id, &key, &new_ct).map_err(|e| e.to_string())?;
                migrated += 1;
            }
            Err(_) => {
                // 换机器/损坏：保留原样，不阻塞其余行
                skipped += 1;
            }
        }
    }
    Ok((migrated, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::test_init_master_key;
    use rusqlite::Connection;

    /// in-memory 连接 + 生产 DDL 镜像（与 db::secure_storage 测试同款）。
    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE secure_storage (
                plugin_id TEXT NOT NULL,
                key TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
                PRIMARY KEY (plugin_id, key)
            )",
        )
        .unwrap();
        c
    }

    #[test]
    fn migrate_rewrites_legacy_ciphertext_and_preserves_plaintext() {
        test_init_master_key();
        let c = conn();
        // 造两条旧派生密文（模拟存量数据）
        for (pid, k) in [("plugin-a", "apiKey"), ("plugin-b", "token")] {
            let plaintext = format!("{}:{}", pid, k);
            let ct = crate::crypto::encrypt_plugin_secret_legacy_placeholder(pid, &plaintext);
            repo::upsert_secret(&c, pid, k, &ct).unwrap();
        }
        let (migrated, skipped) = migrate_secure_storage_to_keyring(&c).unwrap();
        assert_eq!(migrated, 2, "两条 legacy 密文都应迁移");
        assert_eq!(skipped, 0);
        // 迁移后明文不变（且确为 v2-only 可解密文）
        for (pid, k) in [("plugin-a", "apiKey"), ("plugin-b", "token")] {
            let row = repo::read_secret(&c, pid, k).unwrap().unwrap();
            let plain = crate::crypto::decrypt_plugin_secret_v2_only(
                pid,
                &crate::crypto::TEST_MASTER_KEY,
                &row,
            )
            .unwrap();
            assert_eq!(plain, format!("{}:{}", pid, k));
        }
    }

    #[test]
    fn migrate_is_idempotent_on_second_run() {
        test_init_master_key();
        let c = conn();
        let ct = crate::crypto::encrypt_plugin_secret_legacy_placeholder("plugin-a", "plain-a");
        repo::upsert_secret(&c, "plugin-a", "k1", &ct).unwrap();
        assert_eq!(migrate_secure_storage_to_keyring(&c).unwrap(), (1, 0));
        // 第二次：已是 v2 密文，全部跳过
        assert_eq!(migrate_secure_storage_to_keyring(&c).unwrap(), (0, 1));
    }

    #[test]
    fn migrate_preserves_undecryptable_rows() {
        test_init_master_key();
        let c = conn();
        // 一条无法解密的行（换机器场景）+ 一条 legacy 行
        repo::upsert_secret(&c, "plugin-x", "broken", "not-a-valid-ciphertext").unwrap();
        let ct = crate::crypto::encrypt_plugin_secret_legacy_placeholder("plugin-a", "plain-a");
        repo::upsert_secret(&c, "plugin-a", "k1", &ct).unwrap();
        let (migrated, skipped) = migrate_secure_storage_to_keyring(&c).unwrap();
        assert_eq!(migrated, 1);
        assert_eq!(skipped, 1);
        // 解不开的行保留原样
        assert_eq!(
            repo::read_secret(&c, "plugin-x", "broken").unwrap().unwrap(),
            "not-a-valid-ciphertext"
        );
    }

    #[test]
    fn migrate_then_public_decrypt_path_works() {
        // 不注入 master key 的场景无法在共享 OnceLock 下模拟（并行测试已注入固定 key），
        // 回退分支由 crypto 层 encrypt_plugin_secret_inner(None) 测试覆盖；
        // 此处验证迁移后公开读路径（getSecure 命令链路）可解。
        test_init_master_key();
        let c = conn();
        let ct = crate::crypto::encrypt_plugin_secret_legacy_placeholder("plugin-a", "plain-a");
        repo::upsert_secret(&c, "plugin-a", "k1", &ct).unwrap();
        migrate_secure_storage_to_keyring(&c).unwrap();
        let row = repo::read_secret(&c, "plugin-a", "k1").unwrap().unwrap();
        assert_eq!(
            crate::crypto::decrypt_plugin_secret("plugin-a", &row).unwrap(),
            "plain-a"
        );
    }
}
