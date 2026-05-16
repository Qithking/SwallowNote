use crate::db::Database;
use rusqlite::Result;

pub fn save_folder(db: &Database, path: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    
    conn.execute(
        "INSERT OR REPLACE INTO folder_history (path, opened_at) VALUES (?1, datetime('now'))",
        [path],
    )?;
    
    conn.execute(
        "DELETE FROM folder_history WHERE id NOT IN (
            SELECT id FROM folder_history ORDER BY opened_at DESC LIMIT 50
        )",
        [],
    )?;
    
    Ok(())
}

pub fn get_latest_folder(db: &Database) -> Result<Option<String>> {
    let conn = db.conn.lock().unwrap();
    
    let mut stmt = conn.prepare(
        "SELECT path FROM folder_history ORDER BY opened_at DESC LIMIT 1"
    )?;
    
    let mut rows = stmt.query([])?;
    
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn get_folder_history(db: &Database) -> Result<Vec<String>> {
    let conn = db.conn.lock().unwrap();
    
    let mut stmt = conn.prepare(
        "SELECT path FROM folder_history ORDER BY opened_at DESC LIMIT 50"
    )?;
    
    let rows = stmt.query_map([], |row| row.get(0))?;
    
    let mut paths = Vec::new();
    for path_result in rows {
        paths.push(path_result?);
    }
    
    Ok(paths)
}

pub fn remove_folder(db: &Database, path: &str) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    
    conn.execute(
        "DELETE FROM folder_history WHERE path = ?1",
        [path],
    )?;
    
    Ok(())
}

pub fn clear_other_history(db: &Database, current_path: Option<&str>) -> Result<()> {
    let conn = db.conn.lock().unwrap();
    
    match current_path {
        Some(path) => {
            conn.execute(
                "DELETE FROM folder_history WHERE path != ?1",
                [path],
            )?;
        }
        None => {
            conn.execute("DELETE FROM folder_history", [])?;
        }
    }
    
    Ok(())
}
