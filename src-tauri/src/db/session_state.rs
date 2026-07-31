use crate::db::Database;
use rusqlite::Result;
use std::collections::HashMap;

pub fn save_session_state(db: &Database, states: &HashMap<String, String>) -> Result<()> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn_lock();
    // 事务包裹批量 INSERT 保证原子性
    let tx = conn.unchecked_transaction()?;

    for (key, value) in states {
        tx.execute(
            "INSERT OR REPLACE INTO session_state (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn get_session_state(db: &Database) -> Result<HashMap<String, String>> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn_lock();
    
    let mut stmt = conn.prepare("SELECT key, value FROM session_state")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;
    
    let mut states = HashMap::new();
    for row_result in rows {
        let (key, value) = row_result?;
        states.insert(key, value);
    }
    
    Ok(states)
}
