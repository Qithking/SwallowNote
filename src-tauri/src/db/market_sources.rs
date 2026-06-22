use rusqlite::{params, Connection, Result};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketSource {
    pub name: String,
    pub url: String,
    pub is_active: i32, // 1 = currently selected, 0 = not
}

pub fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_market_sources (
            url TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    Ok(())
}

pub fn list_sources(conn: &Connection) -> Result<Vec<MarketSource>> {
    let mut stmt = conn.prepare("SELECT name, url, is_active FROM plugin_market_sources ORDER BY rowid")?;
    let rows = stmt.query_map([], |row| {
        Ok(MarketSource {
            name: row.get(0)?,
            url: row.get(1)?,
            is_active: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn add_source(conn: &Connection, name: &str, url: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO plugin_market_sources (name, url, is_active) VALUES (?1, ?2, 0)",
        params![name, url],
    )?;
    Ok(())
}

pub fn remove_source(conn: &Connection, url: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM plugin_market_sources WHERE url = ?1",
        params![url],
    )?;
    Ok(())
}

pub fn set_active_source(conn: &Connection, url: &str) -> Result<()> {
    // First deactivate all
    conn.execute("UPDATE plugin_market_sources SET is_active = 0", [])?;
    // Then activate the target
    conn.execute(
        "UPDATE plugin_market_sources SET is_active = 1 WHERE url = ?1",
        params![url],
    )?;
    Ok(())
}

pub fn get_active_source(conn: &Connection) -> Result<Option<MarketSource>> {
    let mut stmt = conn.prepare("SELECT name, url, is_active FROM plugin_market_sources WHERE is_active = 1")?;
    let mut rows = stmt.query_map([], |row| {
        Ok(MarketSource {
            name: row.get(0)?,
            url: row.get(1)?,
            is_active: row.get(2)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}
