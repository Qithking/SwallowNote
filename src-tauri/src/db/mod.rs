pub mod folder_history;

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

pub fn init_db(app_data_dir: PathBuf) -> Result<Database> {
    let db_path = app_data_dir.join("swallownote.db");
    let conn = Connection::open(&db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_opened_at ON folder_history(opened_at DESC)",
        [],
    )?;
    
    Ok(Database {
        conn: Mutex::new(conn),
    })
}
