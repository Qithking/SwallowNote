use crate::db::Database;
use rusqlite::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub model_id: String,
    pub created_at: String,
}

pub fn save_message(db: &Database, role: &str, content: &str, model_id: &str) -> Result<i64> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    // 用事务包裹 INSERT + DELETE，保证原子性：避免插入成功但清理失败时
    // 出现部分写入。任一步骤失败时 Transaction drop 会自动回滚。
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO ai_messages (role, content, model_id) VALUES (?1, ?2, ?3)",
        [role, content, model_id],
    )?;
    let id = tx.last_insert_rowid();

    tx.execute(
        "DELETE FROM ai_messages WHERE id NOT IN (
            SELECT id FROM ai_messages ORDER BY id DESC LIMIT 500
        )",
        [],
    )?;
    tx.commit()?;

    Ok(id)
}

pub fn load_messages(
    db: &Database,
    before_id: Option<i64>,
    limit: i64,
) -> Result<Vec<AiMessage>> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });

    let mut messages = Vec::new();

    match before_id {
        Some(bid) => {
            let mut stmt = conn.prepare(
                "SELECT id, role, content, model_id, created_at FROM ai_messages WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map([bid, limit], |row| {
                Ok(AiMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    model_id: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?;
            for msg in rows {
                messages.push(msg?);
            }
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, role, content, model_id, created_at FROM ai_messages ORDER BY id DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map([limit], |row| {
                Ok(AiMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    model_id: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?;
            for msg in rows {
                messages.push(msg?);
            }
        }
    }

    Ok(messages)
}

pub fn clear_messages(db: &Database) -> Result<()> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    conn.execute("DELETE FROM ai_messages", [])?;
    Ok(())
}
