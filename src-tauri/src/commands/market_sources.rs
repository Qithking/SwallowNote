use crate::db::market_sources as repo;
use crate::db::Database;
use tauri::State;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MarketSourceView {
    pub name: String,
    pub url: String,
    pub is_active: bool,
}

impl From<repo::MarketSource> for MarketSourceView {
    fn from(s: repo::MarketSource) -> Self {
        Self {
            name: s.name,
            url: s.url,
            is_active: s.is_active == 1,
        }
    }
}

#[tauri::command]
pub fn list_market_sources(db: State<'_, Database>) -> Result<Vec<MarketSourceView>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let sources = repo::list_sources(&conn).map_err(|e| e.to_string())?;
    Ok(sources.into_iter().map(MarketSourceView::from).collect())
}

#[tauri::command]
pub fn add_market_source(db: State<'_, Database>, name: String, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::add_source(&conn, &name, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_market_source(db: State<'_, Database>, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::remove_source(&conn, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_market_source(db: State<'_, Database>, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    repo::set_active_source(&conn, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_market_source(db: State<'_, Database>) -> Result<Option<MarketSourceView>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let source = repo::get_active_source(&conn).map_err(|e| e.to_string())?;
    Ok(source.map(MarketSourceView::from))
}
