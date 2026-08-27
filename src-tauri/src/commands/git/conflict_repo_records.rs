use super::conflict::git_get_conflict_files;

// ──────────────────────────────────────────────
// Conflict Repo Record Commands
// ──────────────────────────────────────────────

/// Get all conflict repo records from the database
#[tauri::command]
pub fn get_conflict_repo_records(db: tauri::State<'_, crate::db::Database>) -> Result<Vec<crate::db::conflict_repo::ConflictRepoRecord>, String> {
    crate::db::conflict_repo::get_all_conflict_repos(&db).map_err(|e| e.to_string())
}

/// Remove a conflict repo record (called when all conflicts in a repo are resolved)
#[tauri::command]
pub fn remove_conflict_repo_record(db: tauri::State<'_, crate::db::Database>, repo_path: String) -> Result<(), String> {
    crate::db::conflict_repo::remove_conflict_repo(&db, &repo_path).map_err(|e| e.to_string())
}

/// Sync conflict repo records: update the database with current conflict state
/// and return the final list. Called by the auto-sync task after pulling.
#[tauri::command]
pub async fn sync_conflict_repo_records(
    db: tauri::State<'_, crate::db::Database>,
    conflict_repos: Vec<(String, String, i64)>, // (repo_path, repo_name, file_count)
) -> Result<Vec<crate::db::conflict_repo::ConflictRepoRecord>, String> {
    crate::db::conflict_repo::sync_conflict_repos(&db, &conflict_repos).map_err(|e| e.to_string())
}

/// Check if a specific repo has conflicts and upsert the record.
/// Returns the conflict file count (0 means no conflicts, record will be removed).
#[tauri::command]
pub async fn check_and_update_conflict_repo(
    db: tauri::State<'_, crate::db::Database>,
    repo_path: String,
    repo_name: String,
) -> Result<i64, String> {
    // Check for actual conflict files
    let files = git_get_conflict_files(repo_path.clone()).await?;

    if files.is_empty() {
        // No conflicts — remove the record
        crate::db::conflict_repo::remove_conflict_repo(&db, &repo_path).map_err(|e| e.to_string())?;
        Ok(0)
    } else {
        // Has conflicts — upsert the record
        let count = files.len() as i64;
        crate::db::conflict_repo::upsert_conflict_repo(&db, &repo_path, &repo_name, count).map_err(|e| e.to_string())?;
        Ok(count)
    }
}
