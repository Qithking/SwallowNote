use crate::db::ai_role_prompts::AiRolePrompt;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn load_ai_role_prompts(
    db: State<Database>,
) -> Result<Vec<AiRolePrompt>, String> {
    crate::db::ai_role_prompts::load_role_prompts(&db)
        .map_err(|e| format!("Failed to load AI role prompts: {}", e))
}

#[tauri::command]
pub fn get_ai_role_prompt(
    db: State<Database>,
    role_key: String,
) -> Result<Option<AiRolePrompt>, String> {
    crate::db::ai_role_prompts::get_role_prompt(&db, &role_key)
        .map_err(|e| format!("Failed to get AI role prompt: {}", e))
}

#[tauri::command]
pub fn update_ai_role_prompt(
    db: State<Database>,
    role_key: String,
    prompt: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::update_role_prompt(&db, &role_key, &prompt)
        .map_err(|e| format!("Failed to update AI role prompt: {}", e))
}
