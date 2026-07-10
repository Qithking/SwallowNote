use crate::db::ai_chat::AiMessage;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn save_ai_message(
    db: State<Database>,
    role: String,
    content: String,
    model_id: String,
) -> Result<i64, String> {
    crate::db::ai_chat::save_message(&db, &role, &content, &model_id)
        .map_err(|e| format!("Failed to save AI message: {}", e))
}

#[tauri::command]
pub fn load_ai_messages(
    db: State<Database>,
    before_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<AiMessage>, String> {
    // 限制 limit 范围在 1..=200，防止前端传入超大值导致一次性加载过多消息
    let limit = limit.unwrap_or(30).clamp(1, 200);
    crate::db::ai_chat::load_messages(&db, before_id, limit)
        .map_err(|e| format!("Failed to load AI messages: {}", e))
}

#[tauri::command]
pub fn clear_ai_messages(db: State<Database>) -> Result<(), String> {
    crate::db::ai_chat::clear_messages(&db)
        .map_err(|e| format!("Failed to clear AI messages: {}", e))
}
