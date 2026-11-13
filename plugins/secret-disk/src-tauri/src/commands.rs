//! 命令实现：所有 JSON-RPC 命令的业务逻辑。
//!
//! 每个命令接收 `&State` 和 `Value` 参数，返回 `Result<Value, String>`。
//! 错误信息为面向用户的中文提示，不含敏感信息（密码、SQL 参数等）。

use std::fs;
use std::path::Path;

use rusqlite::{params, Connection};
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
///
/// 解锁不做密码规则校验（规则提示仅用于创建/改密）：输入与已设密码
/// 不匹配时统一返回「密码错误」，避免在解锁场景泄露密码规则细节。
/// 仅保留长度上限防护（防 JSON-RPC 反序列化与 mlock 内存炸弹），
/// 超长输入不可能与已设密码匹配，同样按「密码错误」处理。
pub fn cmd_unlock(state: &State, params: &Value) -> Result<Value, String> {
    let password = extract_password(params)?;
    if password.chars().count() > security::PASSWORD_MAX_LEN {
        return Err("密码错误".to_string());
    }
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
        // 必须用 UNION 去重而非 UNION ALL：历史脏数据可能已含 parent_id 环，
        // UNION ALL 遇环会无限递归（内存耗尽 + 持 State Mutex 阻塞全部密盘命令），UNION 遇环自动终止
        let tx = db.conn().unchecked_transaction()
            .map_err(|e| format!("开启事务失败: {}", e))?;
        let deleted = tx.execute(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM notes WHERE id = ?1
                UNION
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
        // 环校验：目标父级若是自身或自身后代，移动会构造环（树渲染/递归删除等操作挂死），拒绝
        if let Some(npid) = new_parent_id {
            if move_would_create_cycle(db.conn(), id, npid)? {
                return Err("不能移动到自身或其子级".to_string());
            }
        }
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

/// 判断把 `id` 移到 `new_parent` 下是否会成环：new_parent 落在 id 的后代集合内（含自身）即成环。
/// 同样用 UNION（去重）递归 CTE——即使历史脏数据已含环，校验本身也能正常终止
fn move_would_create_cycle(conn: &Connection, id: &str, new_parent: &str) -> Result<bool, String> {
    let count: i64 = conn.query_row(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM notes WHERE id = ?1
            UNION
            SELECT n.id FROM notes n
            JOIN descendants d ON n.parent_id = d.id
        )
        SELECT COUNT(*) FROM descendants WHERE id = ?2",
        params![id, new_parent],
        |row| row.get(0),
    ).map_err(|e| format!("查询失败: {}", e))?;
    Ok(count > 0)
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

/// 从参数中提取密码。
///
/// 已知残留点（威胁模型已接受，2026-10-16 用户确认）：密码经 stdin JSON 传入，
/// serde_json 反序列化产生的 `String`/`Value` 在堆上残留明文副本，无法零化
/// （serde_json 无 zeroize 支持）。`protect_password` 仅保护后续使用中的副本。
/// 攻击者若能读取本进程内存，系统已被攻破，全库加密无法防御该层级攻击。
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 在系统临时目录中构造测试 State（uuid 目录名避免并行冲突）。
    fn test_state() -> (State, PathBuf) {
        let dir = std::env::temp_dir().join(format!("secret-disk-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("创建测试目录失败");
        (State::new_for_test(dir.join("secret.swl")), dir)
    }

    #[test]
    fn unlock_with_short_password_reports_password_error() {
        let (state, dir) = test_state();
        cmd_init(&state, &json!({ "password": "abcd1234" })).expect("初始化失败");
        cmd_lock(&state, &json!({})).expect("锁定失败");
        // 短密码解锁：统一报「密码错误」，不应出现「密码长度不能少于」类规则提示
        let err = cmd_unlock(&state, &json!({ "password": "abc" })).unwrap_err();
        assert_eq!(err, "密码错误");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unlock_with_overlong_password_reports_password_error() {
        let (state, dir) = test_state();
        cmd_init(&state, &json!({ "password": "abcd1234" })).expect("初始化失败");
        cmd_lock(&state, &json!({})).expect("锁定失败");
        // 超长密码（不可能与已设密码匹配）：同样按密码错误处理，保留长度上限防护
        let err = cmd_unlock(&state, &json!({ "password": "a".repeat(257) })).unwrap_err();
        assert_eq!(err, "密码错误");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unlock_with_correct_password_succeeds() {
        let (state, dir) = test_state();
        cmd_init(&state, &json!({ "password": "abcd1234" })).expect("初始化失败");
        cmd_lock(&state, &json!({})).expect("锁定失败");
        assert!(cmd_unlock(&state, &json!({ "password": "abcd1234" })).is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn move_item_rejects_move_into_own_descendant() {
        // B5：把项目移到自己或自己的后代下会成环（树渲染/递归操作挂死），必须拒绝
        let (state, dir) = test_state();
        cmd_init(&state, &json!({ "password": "abcd1234" })).expect("初始化失败");
        let a_id = cmd_create_item(&state, &json!({ "title": "a", "type": "folder" }))
            .expect("创建 a 失败")
            .as_str()
            .expect("返回 id")
            .to_string();
        let b_id = cmd_create_item(&state, &json!({ "title": "b", "type": "folder", "parentId": a_id }))
            .expect("创建 b 失败")
            .as_str()
            .expect("返回 id")
            .to_string();
        // a 移到后代 b 下 → 成环，拒绝
        let err = cmd_move_item(&state, &json!({ "id": a_id, "newParentId": b_id })).unwrap_err();
        assert_eq!(err, "不能移动到自身或其子级");
        // 自移到自己也拒绝
        let err = cmd_move_item(&state, &json!({ "id": a_id, "newParentId": a_id })).unwrap_err();
        assert_eq!(err, "不能移动到自身或其子级");
        // 合法移动（b 移到根）不受影响
        cmd_move_item(&state, &json!({ "id": b_id, "newParentId": null })).expect("合法移动不应被拒");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn delete_item_terminates_on_legacy_cycle() {
        // B5：历史脏数据可能已含环（parent_id 互指）。递归 CTE 必须用 UNION 去重终止，
        // UNION ALL 会无限递归挂死后端（持 State Mutex 阻塞全部密盘命令）
        let (state, dir) = test_state();
        cmd_init(&state, &json!({ "password": "abcd1234" })).expect("初始化失败");
        // 绕过命令层直接写入环数据（a、b 互为父级），模拟旧版本产生的脏数据
        state
            .with_db(|db| {
                db.conn().execute(
                    "INSERT INTO notes (id, parent_id, title, type) VALUES ('a', 'b', 'a', 'folder')",
                    [],
                ).map_err(|e| e.to_string())?;
                db.conn().execute(
                    "INSERT INTO notes (id, parent_id, title, type) VALUES ('b', 'a', 'b', 'folder')",
                    [],
                ).map_err(|e| e.to_string())?;
                Ok(json!(true))
            })
            .expect("造环数据失败");
        cmd_delete_item(&state, &json!({ "id": "a" })).expect("删除环数据不应挂死或报错");
        let remaining: i64 = state
            .with_db(|db| {
                Ok(db.conn().query_row(
                    "SELECT COUNT(*) FROM notes WHERE id IN ('a','b')",
                    [],
                    |row| row.get(0),
                ).map_err(|e| e.to_string())?)
            })
            .expect("查询残留失败");
        assert_eq!(remaining, 0, "环中两条记录都应被删除");
        let _ = std::fs::remove_dir_all(dir);
    }
}
