use crate::db::Database;
use tauri::State;
use std::collections::HashMap;

#[tauri::command]
pub fn save_session_state(db: State<Database>, states: HashMap<String, String>) -> Result<(), String> {
    crate::db::session_state::save_session_state(&db, &states)
        .map_err(|e| format!("Failed to save session state: {}", e))
}

#[tauri::command]
pub fn get_session_state(db: State<Database>) -> Result<HashMap<String, String>, String> {
    crate::db::session_state::get_session_state(&db)
        .map_err(|e| format!("Failed to get session state: {}", e))
}
