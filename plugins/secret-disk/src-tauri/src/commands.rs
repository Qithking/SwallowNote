//! 命令实现：所有 JSON-RPC 命令的业务逻辑。
//!
//! 每个命令接收 `&State` 和 `Value` 参数，返回 `Result<Value, String>`。
//! 错误信息为面向用户的中文提示，不含敏感信息（密码、SQL 参数等）。

use std::fs;
use std::path::Path;

use rusqlite::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::Database;
use crate::models::{NoteFull, NoteListItem, NoteType};
use crate::security::{self, protect_password, validate_password_length};
use crate::state::State;

// ──────────────────────────────────────────────────────────────────
// 认证命令
// ──────────────────────────────────────────────────────────────────

/// `init`：创建加密数据库并建表。
pub fn cmd_init(state: &State, params: &Value) -> Result<Value, String> {
    let password = extract_password(params)?;
    validate_password_length(&password)?;
    if state.is_initialized() {
        return Err("数据库已存在，请使用解锁功能".to_string());
    }
    let (secret, _lock) = protect_password(password).map_err(|e| format!("内存锁定失败: {}", e))?;
    let db = Database::create(state.db_path(), &secret)?;
    state.set_db(db);
    Ok(json!(true))
}

/// `unlock`：用密码解锁数据库。
pub fn cmd_unlock(state: &State, params: &Value) -> Result<Value, String> {
    let password = extract_password(params)?;
    validate_password_length(&password)?;
    if state.is_unlocked() {
        return Ok(json!(true)); // 已解锁，幂等返回
    }
    if !state.is_initialized() {
        return Err("数据库未初始化".to_string());
    }
    let (secret, _lock) = protect_password(password).map_err(|e| format!("内存锁定失败: {}", e))?;
    let db = Database::open(state.db_path(), &secret)?;
    state.set_db(db);
    Ok(json!(true))
}

/// `lock`：关闭数据库连接。
pub fn cmd_lock(state: &State, _params: &Value) -> Result<Value, String> {
    state.close_db();
    Ok(json!(true))
}

/// `is_initialized`：检查 .swl 文件是否存在。
pub fn cmd_is_initialized(state: &State, _params: &Value) -> Result<Value, String> {
    Ok(json!(state.is_initialized()))
}

/// `is_unlocked`：检查数据库是否已解锁。
pub fn cmd_is_unlocked(state: &State, _params: &Value) -> Result<Value, String> {
    Ok(json!(state.is_unlocked()))
}

// ──────────────────────────────────────────────────────────────────
// CRUD 命令
// ──────────────────────────────────────────────────────────────────

/// `list_children`：列出子项（不含 content 字段）。
pub fn cmd_list_children(state: &State, params: &Value) -> Result<Value, String> {
    let parent_id = params.get("parentId").and_then(|v| v.as_str());
    state.with_db(|db| {
        let mut sql = "SELECT id, parent_id, title, type, sort_order, created_at, updated_at FROM notes".to_string();
        let mut values: Vec<String> = Vec::new();
        match parent_id {
            Some(pid) => {
                sql.push_str(" WHERE parent_id = ? ORDER BY sort_order ASC, title ASC");
                values.push(pid.to_string());
            }
            None => {
                sql.push_str(" WHERE parent_id IS NULL ORDER BY sort_order ASC, title ASC");
            }
        }
        let mut stmt = db.conn().prepare(&sql).map_err(|e| format!("查询失败: {}", e))?;
        let items: Vec<NoteListItem> = if parent_id.is_some() {
            let rows = stmt
                .query_map(params![values[0]], map_list_item)
                .map_err(|e| format!("查询失败: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        } else {
            let rows = stmt
                .query_map([], map_list_item)
                .map_err(|e| format!("查询失败: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        Ok(json!(items))
    })
}

/// `create_item`：创建文件/文件夹，返回新 id。
pub fn cmd_create_item(state: &State, params: &Value) -> Result<Value, String> {
    let parent_id = params.get("parentId").and_then(|v| v.as_str());
    let title = params.get("title").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 title 参数".to_string())?;
    let type_str = params.get("type").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 type 参数".to_string())?;
    let note_type = NoteType::from_str(type_str);
    let id = Uuid::new_v4().to_string();

    state.with_db(|db| {
        db.conn().execute(
            "INSERT INTO notes (id, parent_id, title, type) VALUES (?1, ?2, ?3, ?4)",
            params![id, parent_id, title, note_type.as_str()],
        ).map_err(|e| format!("创建失败: {}", e))?;
        Ok(json!(id))
    })
}

/// `get_note`：获取笔记完整内容。
pub fn cmd_get_note(state: &State, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id 参数".to_string())?;
    state.with_db(|db| {
        let note = db.conn().query_row(
            "SELECT id, parent_id, title, type, sort_order, created_at, updated_at, content FROM notes WHERE id = ?1",
            params![id],
            |row| {
                Ok(NoteFull {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    title: row.get(2)?,
                    note_type: NoteType::from_str(row.get::<_, String>(3)?.as_str()),
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    content: row.get(7)?,
                })
            },
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "笔记不存在".to_string(),
            other => format!("查询失败: {}", other),
        })?;
        Ok(json!(note))
    })
}

/// `update_note`：更新笔记内容。
pub fn cmd_update_note(state: &State, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id 参数".to_string())?;
    let content = params.get("content").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 content 参数".to_string())?;
    state.with_db(|db| {
        let affected = db.conn().execute(
            "UPDATE notes SET content = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
            params![content, id],
        ).map_err(|e| format!("更新失败: {}", e))?;
        if affected == 0 {
            return Err("笔记不存在".to_string());
        }
        Ok(json!(true))
    })
}

/// `rename_item`：重命名。
pub fn cmd_rename_item(state: &State, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id 参数".to_string())?;
    let title = params.get("title").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 title 参数".to_string())?;
    state.with_db(|db| {
        let affected = db.conn().execute(
            "UPDATE notes SET title = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
            params![title, id],
        ).map_err(|e| format!("重命名失败: {}", e))?;
        if affected == 0 {
            return Err("项目不存在".to_string());
        }
        Ok(json!(true))
    })
}

/// `delete_item`：递归删除（递归 CTE 批量删除 + WAL 回收）。
pub fn cmd_delete_item(state: &State, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id 参数".to_string())?;
    state.with_db(|db| {
        // 递归 CTE 收集所有后代 id（含自身），单事务批量删除。
        let tx = db.conn().unchecked_transaction()
            .map_err(|e| format!("开启事务失败: {}", e))?;
        let deleted = tx.execute(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM notes WHERE id = ?1
                UNION ALL
                SELECT n.id FROM notes n
                JOIN descendants d ON n.parent_id = d.id
            )
            DELETE FROM notes WHERE id IN (SELECT id FROM descendants)",
            params![id],
        ).map_err(|e| format!("删除失败: {}", e))?;
        tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;
        // 删除完成后触发 WAL 回收。
        db.wal_checkpoint_passive()?;
        Ok(json!(deleted > 0))
    })
}

/// `move_item`：移动到目标文件夹。
pub fn cmd_move_item(state: &State, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id 参数".to_string())?;
    let new_parent_id = params.get("newParentId").and_then(|v| v.as_str());
    state.with_db(|db| {
        let affected = db.conn().execute(
            "UPDATE notes SET parent_id = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
            params![new_parent_id, id],
        ).map_err(|e| format!("移动失败: {}", e))?;
        if affected == 0 {
            return Err("项目不存在".to_string());
        }
        Ok(json!(true))
    })
}

// ──────────────────────────────────────────────────────────────────
// 数据库管理命令
// ──────────────────────────────────────────────────────────────────

/// `backup`：复制 .swl 到目标路径（不 lock/unlock）。
pub fn cmd_backup(state: &State, params: &Value) -> Result<Value, String> {
    let target_path = params.get("targetPath").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 targetPath 参数".to_string())?;
    let target = Path::new(target_path);
    security::ensure_swl_extension(target)?;

    // 确保数据库已解锁，才能执行 wal_checkpoint。
    if !state.is_unlocked() {
        return Err("数据库未解锁".to_string());
    }

    state.with_db(|db| {
        // WAL 刷入主库确保文件一致性，不执行 lock/unlock（避免重复 PBKDF2）。
        db.wal_checkpoint_truncate()?;
        fs::copy(db.path(), target).map_err(|e| format!("复制文件失败: {}", e))?;
        // 备份文件设置 0600 权限。
        security::set_secure_permissions(target).map_err(|e| format!("设置权限失败: {}", e))?;
        Ok(json!(true))
    })
}

/// `import_db`：验证源密码 → 备份 .swl.bak → 替换 → unlock 新库；失败回滚。
pub fn cmd_import_db(state: &State, params: &Value) -> Result<Value, String> {
    let source_path = params.get("sourcePath").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 sourcePath 参数".to_string())?;
    let password = extract_password(params)?;
    validate_password_length(&password)?;
    let source = Path::new(source_path);
    security::ensure_swl_extension(source)?;

    // 先验证源文件密码正确（打开后立即关闭，仅做校验）。
    let (secret, _lock) = protect_password(password).map_err(|e| format!("内存锁定失败: {}", e))?;
    {
        let _probe = Database::open(source, &secret)?;
        // probe drop 时关闭连接
    }

    // 关闭当前数据库连接（如果已解锁）。
    state.close_db();

    let current_path = state.db_path();
    let bak_path = current_path.with_extension("swl.bak");

    // 备份当前 .swl 到 .swl.bak（如果存在）。
    let has_current = current_path.exists();
    if has_current {
        fs::rename(current_path, &bak_path).map_err(|e| format!("备份当前数据库失败: {}", e))?;
    }

    // 复制源文件到当前位置。
    if let Err(e) = fs::copy(source, current_path) {
        // 复制失败，从 .swl.bak 恢复。
        if has_current {
            let _ = fs::rename(&bak_path, current_path);
        }
        return Err(format!("替换数据库失败: {}", e));
    }

    // 设置 0600 权限。
    if let Err(e) = security::set_secure_permissions(current_path) {
        // 权限设置失败，回滚。
        if has_current {
            let _ = fs::remove_file(current_path);
            let _ = fs::rename(&bak_path, current_path);
        }
        return Err(format!("设置权限失败: {}", e));
    }

    // 尝试 unlock 新库，失败则回滚。
    match Database::open(current_path, &secret) {
        Ok(db) => {
            state.set_db(db);
            // 成功，删除 .swl.bak。
            if has_current {
                let _ = fs::remove_file(&bak_path);
            }
            Ok(json!(true))
        }
        Err(e) => {
            // unlock 失败，恢复备份。
            let _ = fs::remove_file(current_path);
            if has_current {
                let _ = fs::rename(&bak_path, current_path);
            }
            Err(format!("导入失败，已恢复原数据库: {}", e))
        }
    }
}

/// `change_password`：验证当前密码后用 PRAGMA rekey 更换密钥。
pub fn cmd_change_password(state: &State, params: &Value) -> Result<Value, String> {
    let current_password = params.get("currentPassword").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 currentPassword 参数".to_string())?;
    let new_password = params.get("newPassword").and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 newPassword 参数".to_string())?;

    validate_password_length(current_password)?;
    validate_password_length(new_password)?;

    let (current_secret, _lock1) = protect_password(current_password.to_string())
        .map_err(|e| format!("内存锁定失败: {}", e))?;
    let (new_secret, _lock2) = protect_password(new_password.to_string())
        .map_err(|e| format!("内存锁定失败: {}", e))?;

    // 先用 current_password 打开临时连接验证密码正确性，连接在块结束时关闭。
    {
        let _probe = Database::open(state.db_path(), &current_secret)?;
        // _probe drop：关闭验证连接，避免与 rekey 冲突。
    }

    // 在已解锁的连接上执行 PRAGMA rekey 更换密钥。
    state.with_db(|db| {
        db.rekey(&new_secret)?;
        Ok(json!(true))
    })
}

// ──────────────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────────────

/// 从 params 中提取 password 字段。
fn extract_password(params: &Value) -> Result<String, String> {
    params.get("password").and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "缺少 password 参数".to_string())
}

/// 将数据库行映射为 `NoteListItem`（不含 content）。
fn map_list_item(row: &rusqlite::Row) -> rusqlite::Result<NoteListItem> {
    Ok(NoteListItem {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        title: row.get(2)?,
        note_type: NoteType::from_str(row.get::<_, String>(3)?.as_str()),
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
