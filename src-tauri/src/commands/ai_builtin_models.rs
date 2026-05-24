use crate::db::ai_builtin_models;

#[tauri::command]
pub fn get_builtin_ai_models() -> Vec<ai_builtin_models::BuiltinAiModel> {
    ai_builtin_models::get_builtin_models()
}
