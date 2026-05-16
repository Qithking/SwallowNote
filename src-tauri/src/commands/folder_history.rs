use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn save_folder_history(db: State<Database>, path: String) -> Result<(), String> {
    crate::db::folder_history::save_folder(&db, &path)
        .map_err(|e| format!("Failed to save folder history: {}", e))
}

#[tauri::command]
pub fn get_latest_folder(db: State<Database>) -> Result<Option<String>, String> {
    crate::db::folder_history::get_latest_folder(&db)
        .map_err(|e| format!("Failed to get latest folder: {}", e))
}

#[tauri::command]
pub fn get_folder_history(db: State<Database>) -> Result<Vec<String>, String> {
    crate::db::folder_history::get_folder_history(&db)
        .map_err(|e| format!("Failed to get folder history: {}", e))
}
