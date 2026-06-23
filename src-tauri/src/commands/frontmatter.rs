use crate::db::md_frontmatter::{self, CategoryNode, FrontmatterRecord};
use crate::db::Database;
use std::collections::HashMap;
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
    use std::path::Path;
    let p = Path::new(&path);
    if p.is_file() {
        // 单文件：提交文件变更索引任务
        crate::services::frontmatter_index::submit_file_changed(path);
    } else if p.is_dir() {
        // 目录：提交全量扫描任务
        crate::services::frontmatter_index::submit_scan(path);
    }
    Ok(())
}

/// 保存 .md 文件后，同步解析 frontmatter 并更新 md_frontmatter 表
/// 确保分类面板刷新时能立即查到最新的文件关联
#[tauri::command]
pub fn index_saved_file(db: State<Database>, path: String) -> Result<(), String> {
    use std::path::Path;
    let p = Path::new(&path);
    if !p.exists() || !p.is_file() {
        return Ok(());
    }
    let lower = path.to_lowercase();
    if !lower.ends_with(".md") && !lower.ends_with(".markdown") {
        return Ok(());
    }

    // 读取文件内容
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to read file: {}", e)),
    };

    // 解析 frontmatter
    let (yaml_value, raw_yaml) = crate::services::frontmatter_index::parse_frontmatter_from_content(&content);

    // 获取修改时间
    let modified_at = match std::fs::metadata(&path) {
        Ok(meta) => match meta.modified() {
            Ok(time) => {
                let duration = time.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                format!("{}", duration.as_millis())
            }
            Err(e) => return Err(format!("Failed to get mtime: {}", e)),
        },
        Err(e) => return Err(format!("Failed to get metadata: {}", e)),
    };

    // 同步更新 md_frontmatter 表
    md_frontmatter::upsert_frontmatter(&db, &path, &yaml_value, &raw_yaml, &modified_at)
        .map_err(|e| format!("Failed to upsert frontmatter: {}", e))
}

#[tauri::command]
pub fn search_frontmatter(
    db: State<Database>,
    filters: HashMap<String, String>,
) -> Result<Vec<FrontmatterRecord>, String> {
    md_frontmatter::search_frontmatter(&db, filters)
        .map_err(|e| format!("Failed to search frontmatter: {}", e))
}

#[tauri::command]
pub fn get_category_tree(db: State<Database>) -> Result<Vec<CategoryNode>, String> {
    md_frontmatter::get_category_tree(&db)
        .map_err(|e| format!("Failed to get category tree: {}", e))
}

#[tauri::command]
pub fn rename_category(
    db: State<Database>,
    old_path: String,
    new_path: String,
) -> Result<usize, String> {
    md_frontmatter::rename_category(&db, &old_path, &new_path)
        .map_err(|e| format!("Failed to rename category: {}", e))
}

#[tauri::command]
pub fn delete_category(
    db: State<Database>,
    path: String,
) -> Result<usize, String> {
    md_frontmatter::delete_category(&db, &path)
        .map_err(|e| format!("Failed to delete category: {}", e))
}

#[tauri::command]
pub fn create_category(
    db: State<Database>,
    path: String,
) -> Result<(), String> {
    md_frontmatter::create_category(&db, &path)
        .map_err(|e| format!("Failed to create category: {}", e))
}
