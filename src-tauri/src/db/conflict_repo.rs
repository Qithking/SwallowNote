//! conflict_repos 表：存储存在合并/变基冲突的仓库记录，供前端标记状态与会话恢复。

use crate::db::Database;
use rusqlite::Result;
use serde::{Deserialize, Serialize};

/// A record of a repository with active merge/rebase conflicts
#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictRepoRecord {
    /// Repository root path (unique key)
    pub repo_path: String,
    /// Repository display name
    pub repo_name: String,
    /// Number of conflicting files
    pub conflict_file_count: i64,
    /// When the conflict was first detected
    pub detected_at: String,
    /// When the record was last updated
    pub updated_at: String,
}

/// Create the conflict_repos table (called during DB initialization)
pub fn create_table(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS conflict_repos (
            repo_path TEXT PRIMARY KEY,
            repo_name TEXT NOT NULL,
            conflict_file_count INTEGER NOT NULL DEFAULT 0,
            detected_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
        )",
        [],
    )?;
    Ok(())
}

/// Upsert a conflict repo record.
/// If the repo already exists, update its name and file count.
pub fn upsert_conflict_repo(db: &Database, repo_path: &str, repo_name: &str, file_count: i64) -> Result<()> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    conn.execute(
        "INSERT INTO conflict_repos (repo_path, repo_name, conflict_file_count, updated_at)
         VALUES (?1, ?2, ?3, datetime('now','localtime'))
         ON CONFLICT(repo_path) DO UPDATE SET
            repo_name = excluded.repo_name,
            conflict_file_count = excluded.conflict_file_count,
            updated_at = datetime('now','localtime')",
        [repo_path, repo_name, &file_count.to_string()],
    )?;
    Ok(())
}

/// Remove a conflict repo record (when all conflicts are resolved)
pub fn remove_conflict_repo(db: &Database, repo_path: &str) -> Result<()> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    conn.execute(
        "DELETE FROM conflict_repos WHERE repo_path = ?1",
        [repo_path],
    )?;
    Ok(())
}

/// Get all conflict repo records
pub fn get_all_conflict_repos(db: &Database) -> Result<Vec<ConflictRepoRecord>> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    let mut stmt = conn.prepare(
        "SELECT repo_path, repo_name, conflict_file_count, detected_at, updated_at
         FROM conflict_repos ORDER BY detected_at ASC"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ConflictRepoRecord {
            repo_path: row.get(0)?,
            repo_name: row.get(1)?,
            conflict_file_count: row.get(2)?,
            detected_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }
    Ok(records)
}

/// Clear all conflict repo records (e.g., on session cleanup)
#[allow(dead_code)]
pub fn clear_all_conflict_repos(db: &Database) -> Result<()> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });
    conn.execute("DELETE FROM conflict_repos", [])?;
    Ok(())
}

/// Sync conflict records: given a list of current conflict repos,
/// remove resolved ones and upsert new/updated ones.
/// Returns the final list of conflict repos.
pub fn sync_conflict_repos(
    db: &Database,
    current_conflicts: &[(String, String, i64)], // (repo_path, repo_name, file_count)
) -> Result<Vec<ConflictRepoRecord>> {
    // 优雅降级：mutex 中毒时不 panic，记录日志后继续使用 guard
    let conn = db.conn.lock().unwrap_or_else(|e| {
        eprintln!("[DB] mutex poisoned: {}", e);
        e.into_inner()
    });

    // Get existing records
    let existing_paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT repo_path FROM conflict_repos")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let current_paths: std::collections::HashSet<&str> = current_conflicts.iter().map(|(p, _, _)| p.as_str()).collect();

    // Remove records for repos that are no longer in conflict
    for existing in &existing_paths {
        if !current_paths.contains(existing.as_str()) {
            conn.execute("DELETE FROM conflict_repos WHERE repo_path = ?1", [existing])?;
        }
    }

    // Upsert current conflict repos
    for (repo_path, repo_name, file_count) in current_conflicts {
        conn.execute(
            "INSERT INTO conflict_repos (repo_path, repo_name, conflict_file_count, updated_at)
             VALUES (?1, ?2, ?3, datetime('now','localtime'))
             ON CONFLICT(repo_path) DO UPDATE SET
                repo_name = excluded.repo_name,
                conflict_file_count = excluded.conflict_file_count,
                updated_at = datetime('now','localtime')",
            [repo_path, repo_name, &file_count.to_string()],
        )?;
    }

    drop(conn);

    // Return the updated list
    get_all_conflict_repos(db)
}
