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
