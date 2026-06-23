use crate::db::md_frontmatter::{self, FrontmatterRecord};
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn query_frontmatter(
    db: State<Database>,
    file_path: String,
) -> Result<Option<FrontmatterRecord>, String> {
    md_frontmatter::get_frontmatter(&db, &file_path)
        .map_err(|e| format!("Failed to query frontmatter: {}", e))
}

#[tauri::command]
pub fn query_frontmatter_by_tag(
    db: State<Database>,
    tag: String,
) -> Result<Vec<FrontmatterRecord>, String> {
    md_frontmatter::query_by_tag(&db, &tag)
        .map_err(|e| format!("Failed to query frontmatter by tag: {}", e))
}

#[tauri::command]
pub fn query_frontmatter_by_prefix(
    db: State<Database>,
    path_prefix: String,
) -> Result<Vec<FrontmatterRecord>, String> {
    md_frontmatter::query_by_prefix(&db, &path_prefix)
        .map_err(|e| format!("Failed to query frontmatter by prefix: {}", e))
}

#[tauri::command]
pub fn trigger_frontmatter_scan(path: String) -> Result<(), String> {
    crate::services::frontmatter_index::submit_scan(path);
    Ok(())
}
