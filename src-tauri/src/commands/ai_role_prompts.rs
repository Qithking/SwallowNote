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

#[tauri::command]
pub fn add_ai_role_prompt(
    db: State<Database>,
    role_key: String,
    name: String,
    prompt: String,
) -> Result<AiRolePrompt, String> {
    crate::db::ai_role_prompts::add_role_prompt(&db, &role_key, &name, &prompt)
        .map_err(|e| format!("Failed to add AI role prompt: {}", e))
}

#[tauri::command]
pub fn delete_ai_role_prompt(
    db: State<Database>,
    role_key: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::delete_role_prompt(&db, &role_key)
        .map_err(|e| format!("Failed to delete AI role prompt: {}", e))
}

#[tauri::command]
pub fn update_ai_role_prompt_name(
    db: State<Database>,
    role_key: String,
    name: String,
) -> Result<(), String> {
    crate::db::ai_role_prompts::update_role_prompt_name(&db, &role_key, &name)
        .map_err(|e| format!("Failed to update AI role prompt name: {}", e))
}
