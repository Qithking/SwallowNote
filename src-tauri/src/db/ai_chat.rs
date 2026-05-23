use rusqlite::{Connection, OpenFlags, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AiChatDatabase {
    pub conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub model_id: String,
    pub created_at: String,
}

pub fn init_ai_chat_db(app_data_dir: PathBuf) -> Result<AiChatDatabase> {
    let db_path = app_data_dir.join("ai_chat.db");
    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model_id TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(created_at DESC)",
        [],
    )?;

    Ok(AiChatDatabase {
        conn: Mutex::new(conn),
    })
}

pub fn save_message(db: &AiChatDatabase, role: &str, content: &str, model_id: &str) -> Result<i64> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO ai_messages (role, content, model_id) VALUES (?1, ?2, ?3)",
        [role, content, model_id],
    )?;
    let id = conn.last_insert_rowid();

    conn.execute(
        "DELETE FROM ai_messages WHERE id NOT IN (
            SELECT id FROM ai_messages ORDER BY id DESC LIMIT 500
        )",
        [],
    )?;

    Ok(id)
}

pub fn load_messages(
    db: &AiChatDatabase,
    before_id: Option<i64>,
    limit: i64,
) -> Result<Vec<AiMessage>> {
    let conn = db.conn.lock().unwrap();

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

pub fn clear_messages(db: &AiChatDatabase) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM ai_messages", [])?;
    Ok(())
}
