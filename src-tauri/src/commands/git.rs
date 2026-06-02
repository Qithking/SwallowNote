use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Emitter};
use crate::i18n;

#[derive(Serialize, Deserialize)]
pub struct GitRepositoryInfo {
    pub name: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub has_uncommitted_changes: bool,
    pub uncommitted_count: usize,
    pub current_branch: String,
    pub is_submodule: bool,
    pub parent_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct GitFileLogEntry {
    pub hash: String,
    pub message: String,
    pub date: String,
    pub insertions: usize,
    pub deletions: usize,
}

/// Information about a single conflicting file in a git repository
#[derive(Serialize, Deserialize)]
pub struct ConflictFile {
    /// Relative path within the repository
    pub path: String,
    /// Absolute path of the file
    pub abs_path: String,
}

/// Result of checking conflicts in a repository
#[derive(Serialize, Deserialize)]
pub struct ConflictInfo {
    /// Repository path
    pub repo_path: String,
    /// Repository name
    pub repo_name: String,
    /// List of conflicting files
    pub files: Vec<ConflictFile>,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub untracked: Vec<String>,
}

/// Check if a directory is a git repository by checking for .git folder
#[tauri::command]
pub fn git_is_repo(path: String) -> bool {
    let repo_path = Path::new(&path).join(".git");
    repo_path.exists()
}

/// Initialize a git repository using system git command
#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    let repo_path = Path::new(&path);

    // Check if already a repo
    if repo_path.join(".git").exists() {
        return Ok(());
    }

    // Use system git init command for a proper initialization
    run_git(&path, &["init"]).map_err(|e| format!("Failed to init git repo: {}", e))?;

    Ok(())
}

/// Get git status by running system git commands
#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    let branch = get_branch(&path).unwrap_or_else(|_| "unknown".to_string());
    let modified = run_git(&path, &["diff", "--name-only"]).unwrap_or_default();
    let staged_modified = run_git(&path, &["diff", "--cached", "--name-only"]).unwrap_or_default();
    let untracked = run_git(&path, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();

    // Filter modified to not include staged files
    let mut all_modified: Vec<String> = Vec::new();
    for m in modified.lines() {
        if !m.is_empty() {
            all_modified.push(m.to_string());
        }
    }

    let mut all_added: Vec<String> = Vec::new();
    for a in staged_modified.lines() {
        if !a.is_empty() {
            all_added.push(a.to_string());
        }
    }

    let mut all_untracked: Vec<String> = Vec::new();
    for u in untracked.lines() {
        if !u.is_empty() {
            all_untracked.push(u.to_string());
        }
    }

    // Get deleted files
    let deleted_output = run_git(&path, &["ls-files", "--deleted"]).unwrap_or_default();
    let mut all_deleted: Vec<String> = Vec::new();
    for d in deleted_output.lines() {
        if !d.is_empty() {
            all_deleted.push(d.to_string());
        }
    }

    Ok(GitStatus {
        branch,
        modified: all_modified,
        added: all_added,
        deleted: all_deleted,
        untracked: all_untracked,
    })
}

/// Get git diff for a specific file
#[tauri::command]
pub async fn git_diff(path: String, file_path: String) -> Result<String, String> {
    run_git(&path, &["diff", "--", &file_path]).map_err(|e| e)
}

/// Stage all changes and commit
#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<(), String> {
    // Stage all changes
    run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;

    // Commit
    run_git(&path, &["commit", "-m", &message]).map_err(|e| format!("Failed to commit: {}", e))?;

    Ok(())
}

/// Check if a git error is a rebase/merge conflict
fn is_conflict_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("conflict")
        || lower.contains("could not apply")
        || lower.contains("merge conflict")
        || lower.contains("resolve them")
        || lower.contains("fix conflicts")
        || lower.contains("after resolving the conflicts")
        || lower.contains("failed to merge in the changes")
        || lower.contains("pull is not possible because you have unmerged files")
        || lower.contains("cannot rebase") && lower.contains("uncommitted changes")
}

/// Check if a git error is an authentication failure
fn is_auth_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("permission denied (publickey)")
        || lower.contains("permission denied (keyboard-interactive)")
        || lower.contains("access denied")
        || lower.contains("fatal: could not read from remote repository")
        || lower.contains("http 403")
        || lower.contains("invalid username or password")
        || lower.contains("authentication error")
        || lower.contains("logon failed")
        || lower.contains("authentication required")
        || lower.contains("username for")
        || lower.contains("password for")
        || lower.contains("fatal: unable to access") && (lower.contains("403") || lower.contains("401") || lower.contains("authentication") || lower.contains("credential"))
}

/// Pull changes from remote with rebase by default
#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    // Check if remote exists before pulling
    let remote_url = get_remote_url(&path);
    if remote_url.is_err() {
        return Ok(()); // No remote, nothing to pull
    }

    // Check if already in a conflict state (ongoing rebase/merge)
    // If so, don't attempt another pull - return conflict status
    let rebase_merge = Path::new(&path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&path).join(".git/rebase-apply");
    let merge_head = Path::new(&path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        return Err("REBASE_CONFLICT:Already in a conflict state. Please resolve conflicts first.".to_string());
    }

    let result = run_git(&path, &["pull", "--rebase"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve
                Err(format!("REBASE_CONFLICT:{}", e))
            } else {
                Err(format!("Failed to pull: {}", e))
            }
        }
    }
}

/// Pull changes from remote with provided credentials
#[tauri::command]
pub async fn git_pull_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    // Create a temporary askpass script with a unique name to avoid conflicts
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();
    let askpass_script = temp_dir.join(format!("swallownote_pull_askpass_{}.sh", unique_id));

    #[cfg(not(target_os = "windows"))]
    let script_content = format!(
        "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
        username.replace('\'', "'\\''"),
        password.replace('\'', "'\\''")
    );

    #[cfg(target_os = "windows")]
    let script_content = format!(
        "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo {}\n) else (\n  echo {}\n)",
        username.replace('"', "\"\""),
        password.replace('"', "\"\"")
    );

    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&askpass_script)
            .map_err(|e| format!("Failed to read askpass script metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&askpass_script, perms)
            .map_err(|e| format!("Failed to set askpass script permissions: {}", e))?;
    }

    let askpass_path = askpass_script.to_string_lossy().to_string();

    let result = run_git_with_env(
        &path,
        &["pull", "--rebase"],
        &[
            ("GIT_ASKPASS", askpass_path.as_str()),
            ("GIT_TERMINAL_PROMPT", "0"),
        ],
    );

    // Clean up the askpass script immediately
    let _ = std::fs::remove_file(&askpass_script);

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve
                Err(format!("REBASE_CONFLICT:{}", e))
            } else {
                Err(format!("Failed to pull: {}", e))
            }
        }
    }
}

/// Push commits to remote
#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    let result = run_git(&path, &["push"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to push: {}", e))
            }
        }
    }
}

/// Push with provided credentials (username and password/token)
/// Uses a temporary GIT_ASKPASS script with restricted permissions to supply credentials.
/// The script is created with minimal permissions (0o600) and deleted immediately after use.
#[tauri::command]
pub async fn git_push_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    // Create a temporary askpass script with a unique name to avoid conflicts
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();
    let askpass_script = temp_dir.join(format!("swallownote_askpass_{}.sh", unique_id));

    #[cfg(not(target_os = "windows"))]
    let script_content = format!(
        "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
        username.replace('\'', "'\\''"),
        password.replace('\'', "'\\''")
    );

    #[cfg(target_os = "windows")]
    let script_content = format!(
        "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo {}\n) else (\n  echo {}\n)",
        username.replace('"', "\"\""),
        password.replace('"', "\"\"")
    );

    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&askpass_script)
            .map_err(|e| format!("Failed to read askpass script metadata: {}", e))?
            .permissions();
        // Set restrictive permissions: only owner can read/execute
        perms.set_mode(0o600);
        std::fs::set_permissions(&askpass_script, perms)
            .map_err(|e| format!("Failed to set askpass script permissions: {}", e))?;
    }

    let askpass_path = askpass_script.to_string_lossy().to_string();

    let result = run_git_with_env(
        &path,
        &["push"],
        &[
            ("GIT_ASKPASS", askpass_path.as_str()),
            ("GIT_TERMINAL_PROMPT", "0"),
        ],
    );

    // Clean up the askpass script immediately
    let _ = std::fs::remove_file(&askpass_script);

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to push: {}", e)),
    }
}

/// Force push commits to remote (overwrites remote history)
#[tauri::command]
pub async fn git_force_push(path: String) -> Result<(), String> {
    let result = run_git(&path, &["push", "--force"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to force push: {}", e))
            }
        }
    }
}

/// Force push with provided credentials (username and password/token)
#[tauri::command]
pub async fn git_force_push_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();
    let askpass_script = temp_dir.join(format!("swallownote_force_push_askpass_{}.sh", unique_id));

    #[cfg(not(target_os = "windows"))]
    let script_content = format!(
        "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
        username.replace('\'', "'\\''"),
        password.replace('\'', "'\\''")
    );

    #[cfg(target_os = "windows")]
    let script_content = format!(
        "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo {}\n) else (\n  echo {}\n)",
        username.replace('"', "\"\""),
        password.replace('"', "\"\"")
    );

    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&askpass_script)
            .map_err(|e| format!("Failed to read askpass script metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&askpass_script, perms)
            .map_err(|e| format!("Failed to set askpass script permissions: {}", e))?;
    }

    let askpass_path = askpass_script.to_string_lossy().to_string();

    let result = run_git_with_env(
        &path,
        &["push", "--force"],
        &[
            ("GIT_ASKPASS", askpass_path.as_str()),
            ("GIT_TERMINAL_PROMPT", "0"),
        ],
    );

    let _ = std::fs::remove_file(&askpass_script);

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to force push: {}", e)),
    }
}

/// Force pull from remote (discard local changes and reset to remote)
/// This performs: git fetch + git reset --hard origin/<branch> + git clean -fd
#[tauri::command]
pub async fn git_force_pull(path: String) -> Result<(), String> {
    // Check if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_err() {
        return Ok(()); // No remote, nothing to pull
    }

    // Get current branch
    let branch = get_branch(&path)?;

    // Fetch from remote
    run_git(&path, &["fetch", "origin"]).map_err(|e| format!("Failed to fetch: {}", e))?;

    // Reset to remote branch, discarding all local changes
    let remote_ref = format!("origin/{}", branch);
    run_git(&path, &["reset", "--hard", &remote_ref])
        .map_err(|e| format!("Failed to reset: {}", e))?;

    // Clean untracked files and directories
    run_git(&path, &["clean", "-fd"]).map_err(|e| format!("Failed to clean: {}", e))?;

    Ok(())
}

/// Commit and push in one command
#[tauri::command]
pub async fn git_commit_and_push(path: String, message: String) -> Result<(), String> {
    // Stage all changes including submodules
    run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;

    // Check if there are submodule changes that need special handling
    let status_output = run_git(&path, &["status"])?;
    
    // Check for submodule with modified content (submodule internal changes)
    // Use precise patterns: "modified content" is what git outputs for dirty submodules
    // and "new commits" / "modified refs" indicate submodule pointer changes
    let has_submodule_modified = status_output.contains("modified content")
        || (status_output.contains("(new commits)") && status_output.contains("submodule"))
        || (status_output.contains("(modified refs)") && status_output.contains("submodule"));
    
    if has_submodule_modified {
        // First try to commit changes in submodules
        match commit_submodules(&path, &message) {
            Ok(_) => {
                // Submodules committed successfully, now stage and commit parent
                run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;
                let commit_result = run_git(&path, &["commit", "-m", &message]);
                if let Err(e) = commit_result {
                    let err_msg = e.to_lowercase();
                    if !err_msg.contains("nothing to commit") 
                        && !err_msg.contains("working tree clean")
                        && !err_msg.contains("no changes added to commit") {
                        return Err(format!("Failed to commit: {}", e));
                    }
                }
            }
            Err(e) => {
                // Submodule commit failed - this means submodule has uncommitted changes
                // Return specific error for frontend to handle
                return Err(format!("SUBMODULE_UNCOMMITTED:{}", i18n::t("backend.git.submoduleUncommitted")));
            }
        }
    } else {
        // Regular commit - allow "nothing to commit" since there may be unpushed local commits
        let commit_result = run_git(&path, &["commit", "-m", &message]);
        if let Err(e) = commit_result {
            let err_msg = e.to_lowercase();
            if !err_msg.contains("nothing to commit") 
                && !err_msg.contains("working tree clean")
                && !err_msg.contains("no changes added to commit") {
                return Err(format!("Failed to commit: {}", e));
            }
            // "nothing to commit" is not an error - continue to push in case there are unpushed commits
        }
    }

    // Push - only if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_ok() {
        // Pull --rebase first to integrate remote changes before pushing
        // This avoids non-fast-forward push failures
        let pull_result = run_git(&path, &["pull", "--rebase"]);
        if let Err(e) = pull_result {
            let err_lower = e.to_lowercase();
            // If it's a conflict, abort the rebase and return error
            if err_lower.contains("conflict") || err_lower.contains("could not apply") {
                let _ = run_git(&path, &["rebase", "--abort"]);
                return Err(format!("REBASE_CONFLICT:{}", e));
            }
            // Auth errors during pull
            if is_auth_error(&e) {
                return Err(format!("AUTH_REQUIRED:{}", e));
            }
            // Other pull errors (e.g., no upstream) - try to push anyway
            // since we might have local commits that don't conflict
        }
        
        let push_result = run_git(&path, &["push"]);
        if let Err(e) = push_result {
            if is_auth_error(&e) {
                return Err(format!("AUTH_REQUIRED:{}", e));
            }
            return Err(format!("Failed to push: {}", e));
        }
    }

    Ok(())
}

fn commit_submodules(path: &str, message: &str) -> Result<(), String> {
    // Get list of submodules from .gitmodules for more reliable path extraction
    let gitmodules_path = std::path::Path::new(path).join(".gitmodules");
    if !gitmodules_path.exists() {
        // No submodules configured, nothing to do
        return Ok(());
    }
    
    // Parse .gitmodules to get submodule paths
    let submodule_paths = parse_gitmodules(&gitmodules_path)?;
    
    for submodule_rel_path in submodule_paths {
        let submodule_full_path = format!("{}/{}", path, submodule_rel_path);
        
        // Check if submodule directory exists
        if !std::path::Path::new(&submodule_full_path).exists() {
            continue;
        }
        
        // Check if submodule has uncommitted changes
        let submodule_status = run_git(&submodule_full_path, &["status", "--porcelain"])?;
        if !submodule_status.trim().is_empty() {
            // Stage and commit in submodule
            run_git(&submodule_full_path, &["add", "-A"])?;
            if let Err(e) = run_git(&submodule_full_path, &["commit", "-m", message]) {
                // If submodule commit fails (no changes), that's okay
                if !e.contains("nothing to commit") && !e.contains("working tree clean") {
                    return Err(e);
                }
            }
        }
    }
    
    // Now stage the submodule reference changes in parent
    run_git(path, &["add", "-A"])?;
    Ok(())
}

/// Auto commit a single file (local only, no push)
#[tauri::command]
pub async fn git_auto_commit(file_path: String) -> Result<(), String> {
    // Find the git root by walking up directories
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Ok(()), // Not in a git repo
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let commit_message = format!("Auto-save: {}", file_name);

    // Stage only this file
    run_git(repo_path, &["add", &file_path])?;

    // Commit
    match run_git(repo_path, &["commit", "-m", &commit_message]) {
        Ok(_) => Ok(()),
        Err(e) => {
            // Silently ignore "nothing to commit" errors
            if e.contains("nothing to commit") || e.contains("working tree clean") || e.contains("no changes added to commit") {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

/// Get commit log
#[tauri::command]
pub async fn git_log(path: String, max_count: i32) -> Result<Vec<String>, String> {
    let count = max_count.to_string();
    let output = run_git(&path, &["log", "--oneline", "-n", &count])
        .map_err(|e| format!("Failed to get log: {}", e))?;

    let mut logs = Vec::new();
    for line in output.lines() {
        if !line.is_empty() {
            logs.push(line.to_string());
        }
    }
    Ok(logs)
}

/// Get file commit history with pagination
#[tauri::command]
pub async fn git_file_log(file_path: String, max_count: usize, skip: usize) -> Result<Vec<GitFileLogEntry>, String> {
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Err("NOT_IN_GIT_REPO".to_string()),
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let relative_path = Path::new(&file_path)
        .strip_prefix(current)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let relative_path_str = relative_path.to_str().ok_or("Invalid path encoding")?;

    let max_count_str = max_count.to_string();
    let skip_str = skip.to_string();

    let log_output = run_git(
        repo_path,
        &[
            "log",
            "--follow",
            "--format=COMMIT_START%n%H%x00%s%x00%ct",
            "--numstat",
            "-n", &max_count_str,
            "--skip", &skip_str,
            "--",
            relative_path_str,
        ],
    )?;

    let mut entries = Vec::new();
    let mut current_hash = String::new();
    let mut current_message = String::new();
    let mut current_date = String::new();
    let mut current_insertions: usize = 0;
    let mut current_deletions: usize = 0;

    for line in log_output.lines() {
        if line.starts_with("COMMIT_START") {
            if !current_hash.is_empty() {
                entries.push(GitFileLogEntry {
                    hash: current_hash.clone(),
                    message: current_message.clone(),
                    date: current_date.clone(),
                    insertions: current_insertions,
                    deletions: current_deletions,
                });
            }
            current_hash = String::new();
            current_message = String::new();
            current_date = String::new();
            current_insertions = 0;
            current_deletions = 0;
            continue;
        }

        if current_hash.is_empty() {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 3 {
                current_hash = parts[0].to_string();
                current_message = parts[1].to_string();
                let timestamp_str = parts[2].trim();
                current_date = format!("{}000", timestamp_str);
            }
            continue;
        }

        let numstat_parts: Vec<&str> = line.split_whitespace().collect();
        if numstat_parts.len() >= 3 {
            if let (Ok(ins), Ok(del)) = (numstat_parts[0].parse::<usize>(), numstat_parts[1].parse::<usize>()) {
                current_insertions += ins;
                current_deletions += del;
            }
        }
    }

    if !current_hash.is_empty() {
        entries.push(GitFileLogEntry {
            hash: current_hash,
            message: current_message,
            date: current_date,
            insertions: current_insertions,
            deletions: current_deletions,
        });
    }

    Ok(entries)
}

/// Get diff for a specific commit and file
#[tauri::command]
pub async fn git_show_diff(file_path: String, commit_hash: String) -> Result<String, String> {
    // Find the git root by walking up directories
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Err("NOT_IN_GIT_REPO".to_string()),
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let relative_path = Path::new(&file_path)
        .strip_prefix(current)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let relative_path_str = relative_path.to_str().ok_or("Invalid path encoding")?;

    // Get diff for the specific file in this commit
    let output = run_git(
        repo_path,
        &[
            "diff",
            "-M",
            &format!("{}^", commit_hash),
            &commit_hash,
            "--no-color",
            "--",
            relative_path_str,
        ],
    )?;

    Ok(output)
}

/// Get the full file content at a specific commit (for restore functionality)
#[tauri::command]
pub async fn git_show_file_content(file_path: String, commit_hash: String) -> Result<String, String> {
    // Find the git root by walking up directories
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Err("NOT_IN_GIT_REPO".to_string()),
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let relative_path = Path::new(&file_path)
        .strip_prefix(current)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let relative_path_str = relative_path.to_str().ok_or("Invalid path encoding")?;

    // Get the full file content at the given commit
    let output = run_git(
        repo_path,
        &[
            "show",
            &format!("{}:{}", commit_hash, relative_path_str),
            "--no-color",
        ],
    )?;

    Ok(output)
}

/// Pull the latest version of a single file from remote and return its content.
/// This performs a git fetch + checkout of the remote branch version for the specific file.
#[tauri::command]
pub async fn git_pull_file_latest(file_path: String) -> Result<String, String> {
    // Find the git root by walking up directories
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Err("NOT_IN_GIT_REPO".to_string()),
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let relative_path = Path::new(&file_path)
        .strip_prefix(current)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let relative_path_str = relative_path.to_str().ok_or("Invalid path encoding")?;

    // Check if remote exists
    let remote_url = get_remote_url(repo_path);
    if remote_url.is_err() {
        return Err("NO_REMOTE".to_string());
    }

    // Fetch from remote
    run_git(repo_path, &["fetch"]).map_err(|e| {
        if is_auth_error(&e) {
            format!("AUTH_REQUIRED:{}", e)
        } else {
            format!("Failed to fetch: {}", e)
        }
    })?;

    // Get the current branch name
    let branch = get_branch(repo_path)?;

    // Get the file content from the remote branch (origin/<branch>)
    let remote_ref = format!("origin/{}:{}", branch, relative_path_str);
    let output = run_git(
        repo_path,
        &["show", "--no-color", &remote_ref],
    )?;

    // Also checkout the file from remote to update the working tree
    run_git(repo_path, &["checkout", &format!("origin/{}", branch), "--", relative_path_str])
        .map_err(|e| format!("Failed to checkout file: {}", e))?;

    Ok(output)
}

/// Force upload a single file to remote: stage, commit, and force push.
/// This overwrites the remote version with the local version.
#[tauri::command]
pub async fn git_force_upload_file(file_path: String) -> Result<(), String> {
    // Find the git root by walking up directories
    let mut current = Path::new(&file_path);
    loop {
        if current.join(".git").exists() {
            break;
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return Err("NOT_IN_GIT_REPO".to_string()),
        }
    }

    let repo_path = current.to_str().ok_or("Invalid repo path")?;
    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    // Check if remote exists
    let remote_url = get_remote_url(repo_path);
    if remote_url.is_err() {
        return Err("NO_REMOTE".to_string());
    }

    // Stage the file
    run_git(repo_path, &["add", &file_path])
        .map_err(|e| format!("Failed to stage file: {}", e))?;

    // Commit
    let commit_message = format!("Force upload: {}", file_name);
    match run_git(repo_path, &["commit", "-m", &commit_message]) {
        Ok(_) => {}
        Err(e) => {
            // If nothing to commit, we still want to force push existing commits
            if !e.contains("nothing to commit") && !e.contains("working tree clean") && !e.contains("no changes added to commit") {
                return Err(format!("Failed to commit: {}", e));
            }
        }
    }

    // Force push
    let result = run_git(repo_path, &["push", "--force"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to force push: {}", e))
            }
        }
    }
}

fn get_branch(path: &str) -> Result<String, String> {
    run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
}

/// Scan directory for all git repositories
#[tauri::command]
pub async fn scan_git_repos(root_path: String) -> Result<Vec<GitRepositoryInfo>, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let mut repos = Vec::new();
    scan_dir_recursive(root, &mut repos, None)?;
    Ok(repos)
}

fn scan_dir_recursive(dir: &Path, repos: &mut Vec<GitRepositoryInfo>, parent_path: Option<String>) -> Result<(), String> {
    // Skip common non-repo directories
    let dir_name = dir.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    
    if dir_name.starts_with('.') 
        || dir_name == "node_modules"
        || dir_name == "target"
        || dir_name == "dist"
        || dir_name == "build"
    {
        return Ok(());
    }

    // Check if this directory is a git repo
    let git_dir = dir.join(".git");
    if git_dir.exists() {
        let repo_name = dir.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        
        let path_str = dir.to_string_lossy().to_string().replace('\\', "/");
        
        // Check if .git is a file (indicating a submodule)
        let is_submodule = git_dir.is_file();
        
        // Get remote URL
        let remote_url = get_remote_url(&path_str).ok();
        
        // Get current branch
        let current_branch = get_branch(&path_str).unwrap_or_else(|_| "unknown".to_string());
        
        // Check for uncommitted changes
        let (has_changes, change_count) = get_uncommitted_count(&path_str);
        
        repos.push(GitRepositoryInfo {
            name: repo_name.clone(),
            path: path_str.clone(),
            remote_url,
            has_uncommitted_changes: has_changes,
            uncommitted_count: change_count,
            current_branch,
            is_submodule,
            parent_path: parent_path.clone(),
        });
        
        // Check for submodules in this repo
        let gitmodules_path = dir.join(".gitmodules");
        if gitmodules_path.exists() && !is_submodule {
            if let Ok(submodule_paths) = parse_gitmodules(&gitmodules_path) {
                for submodule_rel_path in submodule_paths {
                    let submodule_full_path = dir.join(&submodule_rel_path);
                    if submodule_full_path.exists() && submodule_full_path.join(".git").exists() {
                        let submodule_name = Path::new(&submodule_rel_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        
                        let submodule_path_str = submodule_full_path.to_string_lossy().to_string().replace('\\', "/");
                        let submodule_remote = get_remote_url(&submodule_path_str).ok();
                        let submodule_branch = get_branch(&submodule_path_str).unwrap_or_else(|_| "unknown".to_string());
                        let (submodule_has_changes, submodule_change_count) = get_uncommitted_count(&submodule_path_str);
                        
                        repos.push(GitRepositoryInfo {
                            name: submodule_name,
                            path: submodule_path_str,
                            remote_url: submodule_remote,
                            has_uncommitted_changes: submodule_has_changes,
                            uncommitted_count: submodule_change_count,
                            current_branch: submodule_branch,
                            is_submodule: true,
                            parent_path: Some(path_str.clone()),
                        });
                    }
                }
            }
        }
        
        // If .git is a file (submodule), don't recurse into it
        // If .git is a directory (independent repo), continue scanning subdirectories for nested repos
        if is_submodule {
            return Ok(());
        }
    }

    // Recursively scan subdirectories
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_dir_recursive(&path, repos, parent_path.clone())?;
            }
        }
    }

    Ok(())
}

/// Parse .gitmodules file to extract submodule paths
fn parse_gitmodules(gitmodules_path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(gitmodules_path)
        .map_err(|e| format!("Failed to read .gitmodules: {}", e))?;
    
    let mut paths = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("path = ") {
            let path = line.trim_start_matches("path = ").trim();
            if !path.is_empty() {
                paths.push(path.to_string());
            }
        }
    }
    
    Ok(paths)
}

fn get_remote_url(path: &str) -> Result<String, String> {
    // Try to get the first remote URL (usually 'origin')
    let output = run_git(path, &["remote", "get-url", "origin"])?;
    Ok(output.trim().to_string())
}

/// Get list of conflicting files in a repository during a rebase or merge
#[tauri::command]
pub async fn git_get_conflict_files(repo_path: String) -> Result<Vec<ConflictFile>, String> {
    // Check if there's an ongoing rebase or merge
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");

    if !rebase_merge.exists() && !rebase_apply.exists() && !merge_head.exists() {
        eprintln!("[INFO] git_get_conflict_files: no rebase/merge state found in {}", repo_path);
        return Ok(vec![]);
    }

    let mut seen_paths = std::collections::HashSet::new();
    let mut files = Vec::new();

    // Method 1: Get unmerged files using diff-filter=U
    if let Ok(output) = run_git(&repo_path, &["diff", "--name-only", "--diff-filter=U"]) {
        eprintln!("[INFO] git_get_conflict_files: diff --diff-filter=U output for {}: {:?}", repo_path, output);
        for line in output.lines() {
            let rel_path = line.trim();
            if !rel_path.is_empty() && seen_paths.insert(rel_path.to_string()) {
                let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                files.push(ConflictFile {
                    path: rel_path.to_string(),
                    abs_path,
                });
            }
        }
    }

    // Method 2: Use ls-files --unmerged as fallback
    if files.is_empty() {
        if let Ok(ls_output) = run_git(&repo_path, &["ls-files", "--unmerged"]) {
            eprintln!("[INFO] git_get_conflict_files: ls-files --unmerged output: {:?}", ls_output);
            // Parse ls-files output: mode hash stage path
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let rel_path = parts[3..].join(" ");
                    if seen_paths.insert(rel_path.clone()) {
                        let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                        files.push(ConflictFile {
                            path: rel_path,
                            abs_path,
                        });
                    }
                }
            }
        }
    }

    // Method 3: Use git status --porcelain to find conflict markers (UU, AA, DU, UD etc)
    if files.is_empty() {
        if let Ok(status_output) = run_git(&repo_path, &["status", "--porcelain"]) {
            eprintln!("[INFO] git_get_conflict_files: status --porcelain output: {:?}", status_output);
            for line in status_output.lines() {
                let line = line.trim();
                if line.len() >= 4 {
                    let xy = &line[0..2];
                    // Conflict indicators: DD, AU, UD, UA, DU, UU, AA
                    if xy.contains("U") || xy == "DD" || xy == "AA" {
                        let rel_path = line[3..].trim().to_string();
                        if seen_paths.insert(rel_path.clone()) {
                            let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                            files.push(ConflictFile {
                                path: rel_path,
                                abs_path,
                            });
                        }
                    }
                }
            }
        }
    }

    eprintln!("[INFO] git_get_conflict_files: found {} conflict files in {}", files.len(), repo_path);
    Ok(files)
}

/// Get the local version (ours) of a conflicting file
/// Uses git show with multiple fallback strategies:
/// 1. HEAD:<path> (works in most cases)
/// 2. :2:<path> (stage 2 = ours in the index)
/// 3. Read the file from ORIG_HEAD (before rebase)
#[tauri::command]
pub async fn git_get_conflict_local_content(repo_path: String, file_path: String) -> Result<String, String> {
    eprintln!("[INFO] git_get_conflict_local_content: repo_path={}, file_path={}", repo_path, file_path);

    // Strategy 1: Try git show HEAD:<path>
    match run_git(&repo_path, &["show", &format!("HEAD:{}", file_path)]) {
        Ok(output) if !output.is_empty() => {
            eprintln!("[INFO] git_get_conflict_local_content: got content from HEAD:{} (len={})", file_path, output.len());
            return Ok(output);
        }
        Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: HEAD:{} returned empty", file_path),
        Err(e) => eprintln!("[WARN] git_get_conflict_local_content: HEAD:{} failed: {}", file_path, e),
    }

    // Strategy 2: Try git show :2:<path> (stage 2 = ours in the index)
    match run_git(&repo_path, &["show", &format!(":2:{}", file_path)]) {
        Ok(output) if !output.is_empty() => {
            eprintln!("[INFO] git_get_conflict_local_content: got content from :2:{} (len={})", file_path, output.len());
            return Ok(output);
        }
        Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: :2:{} returned empty", file_path),
        Err(e) => eprintln!("[WARN] git_get_conflict_local_content: :2:{} failed: {}", file_path, e),
    }

    // Strategy 3: Read the file directly from the working tree (which has conflict markers)
    // and extract just our portion
    let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), file_path);
    match std::fs::read_to_string(&abs_path) {
        Ok(content) => {
            eprintln!("[INFO] git_get_conflict_local_content: read file directly (len={})", content.len());
            // Return the working tree version (has conflict markers but at least shows something)
            Ok(content)
        }
        Err(e) => {
            eprintln!("[ERROR] git_get_conflict_local_content: all strategies failed for {} in {}: {}", file_path, repo_path, e);
            Err(format!("Failed to get local content for {}: all strategies failed", file_path))
        }
    }
}

/// Get the remote version (theirs) of a conflicting file
/// Uses multiple fallback strategies:
/// 1. REBASE_HEAD:<path> (during rebase-merge)
/// 2. :3:<path> (stage 3 = theirs in the index)
/// 3. MERGE_HEAD:<path> (during merge)
/// 4. ORIG_HEAD:<path> (fallback)
#[tauri::command]
pub async fn git_get_conflict_remote_content(repo_path: String, file_path: String) -> Result<String, String> {
    eprintln!("[INFO] git_get_conflict_remote_content: repo_path={}, file_path={}", repo_path, file_path);

    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");

    // Strategy 1: Try REBASE_HEAD (during rebase-merge)
    if rebase_merge.exists() || rebase_apply.exists() {
        match run_git(&repo_path, &["show", &format!("REBASE_HEAD:{}", file_path)]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_remote_content: got content from REBASE_HEAD:{} (len={})", file_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: REBASE_HEAD:{} returned empty", file_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: REBASE_HEAD:{} failed: {}", file_path, e),
        }
    }

    // Strategy 2: Try :3:<path> (stage 3 = theirs in the index)
    // This is the most reliable method for getting "their" version during any conflict
    match run_git(&repo_path, &["show", &format!(":3:{}", file_path)]) {
        Ok(output) if !output.is_empty() => {
            eprintln!("[INFO] git_get_conflict_remote_content: got content from :3:{} (len={})", file_path, output.len());
            return Ok(output);
        }
        Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: :3:{} returned empty", file_path),
        Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: :3:{} failed: {}", file_path, e),
    }

    // Strategy 3: Try MERGE_HEAD (during merge)
    if merge_head.exists() {
        match run_git(&repo_path, &["show", &format!("MERGE_HEAD:{}", file_path)]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_remote_content: got content from MERGE_HEAD:{} (len={})", file_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: MERGE_HEAD:{} returned empty", file_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: MERGE_HEAD:{} failed: {}", file_path, e),
        }
    }

    // Strategy 4: Try ORIG_HEAD (fallback)
    match run_git(&repo_path, &["show", &format!("ORIG_HEAD:{}", file_path)]) {
        Ok(output) if !output.is_empty() => {
            eprintln!("[INFO] git_get_conflict_remote_content: got content from ORIG_HEAD:{} (len={})", file_path, output.len());
            return Ok(output);
        }
        Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: ORIG_HEAD:{} returned empty", file_path),
        Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: ORIG_HEAD:{} failed: {}", file_path, e),
    }

    eprintln!("[ERROR] git_get_conflict_remote_content: all strategies failed for {} in {}", file_path, repo_path);
    Err(format!("Failed to get remote content for {}: all strategies failed", file_path))
}

/// Resolve a conflict by choosing a side for a specific file
/// side: "local" or "remote"
#[tauri::command]
pub async fn git_resolve_conflict_file(repo_path: String, file_path: String, side: String) -> Result<(), String> {
    let rel_path = Path::new(&file_path)
        .strip_prefix(Path::new(&repo_path))
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let rel_path_str = rel_path.to_str().ok_or("Invalid path encoding")?;

    eprintln!("[INFO] git_resolve_conflict_file: repo_path={}, file_path={}, side={}", repo_path, file_path, side);

    // Get content based on chosen side, with multiple fallback strategies
    let content = get_conflict_content(&repo_path, rel_path_str, &side)?;

    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    // Stage the resolved file
    run_git(&repo_path, &["add", rel_path_str])?;

    check_and_continue_rebase(&repo_path)
}

/// Helper function to get conflict content for a specific side
fn get_conflict_content(repo_path: &str, rel_path: &str, side: &str) -> Result<String, String> {
    if side == "local" {
        // Get local version (ours) - try multiple strategies
        // Strategy 1: HEAD:<path>
        if let Ok(output) = run_git(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
            if !output.is_empty() {
                return Ok(output);
            }
        }
        // Strategy 2: :2:<path> (stage 2 = ours in the index)
        if let Ok(output) = run_git(repo_path, &["show", &format!(":2:{}", rel_path)]) {
            if !output.is_empty() {
                return Ok(output);
            }
        }
        Err(format!("Failed to get local content for {}", rel_path))
    } else if side == "remote" {
        // Get remote version (theirs) - try multiple strategies
        let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
        let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
        let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");

        // Strategy 1: REBASE_HEAD (during rebase)
        if rebase_merge.exists() || rebase_apply.exists() {
            if let Ok(output) = run_git(repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
                if !output.is_empty() {
                    return Ok(output);
                }
            }
        }

        // Strategy 2: :3:<path> (stage 3 = theirs in the index)
        if let Ok(output) = run_git(repo_path, &["show", &format!(":3:{}", rel_path)]) {
            if !output.is_empty() {
                return Ok(output);
            }
        }

        // Strategy 3: MERGE_HEAD (during merge)
        if merge_head.exists() {
            if let Ok(output) = run_git(repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                if !output.is_empty() {
                    return Ok(output);
                }
            }
        }

        Err(format!("Failed to get remote content for {}", rel_path))
    } else {
        Err(format!("Invalid side: {}", side))
    }
}

/// Helper function to check if all conflicts are resolved and continue rebase/merge if so
fn check_and_continue_rebase(repo_path: &str) -> Result<(), String> {
    let remaining = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
    if remaining.trim().is_empty() {
        // All conflicts resolved - continue the rebase/merge
        let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
        let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");

        if rebase_merge.exists() || rebase_apply.exists() {
            // Continue rebase - use GIT_EDITOR=true to skip editor
            let result = run_git_with_env(
                repo_path,
                &["rebase", "--continue"],
                &[("GIT_EDITOR", "true")],
            );
            if let Err(e) = result {
                eprintln!("[WARN] git_resolve_conflict_file: rebase --continue failed: {}", e);
                // Don't fail the whole operation - the conflict is resolved but rebase couldn't continue
                // User can continue manually
            }
        } else {
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                run_git(repo_path, &["commit", "--no-edit"])?;
            }
        }
    }
    Ok(())
}

/// Abort the current rebase or merge, restoring the repository to a clean state
#[tauri::command]
pub async fn git_abort_conflict(repo_path: String) -> Result<(), String> {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");

    if rebase_merge.exists() || rebase_apply.exists() {
        run_git(&repo_path, &["rebase", "--abort"])?;
    } else if merge_head.exists() {
        run_git(&repo_path, &["merge", "--abort"])?;
    } else {
        return Err("No rebase or merge in progress".to_string());
    }
    Ok(())
}

fn get_uncommitted_count(path: &str) -> (bool, usize) {
    let status_output = run_git(path, &["status", "--porcelain"]).unwrap_or_default();
    
    let total_lines = status_output.lines().filter(|l| !l.is_empty()).count();
    
    // Count only tracked (staged/modified) files, excluding untracked
    let tracked_count = status_output.lines()
        .filter(|line| {
            let xy = line.get(..2).unwrap_or("  ");
            !xy.starts_with('?') && !xy.ends_with('?')
        })
        .count();
    
    (total_lines > 0, tracked_count)
}

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    run_git_with_env(path, args, &[])
}

fn run_git_with_env(path: &str, args: &[&str], env_vars: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = super::create_command("git");
    cmd.current_dir(path).args(args);

    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            // 如果 stderr 为空，尝试从 stdout 获取错误信息
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                Err(stdout)
            } else {
                Err("Git command failed with no output".to_string())
            }
        } else {
            Err(stderr)
        }
    }
}

/// Clone a git repository to a local path
#[tauri::command]
pub async fn git_clone(app: AppHandle, url: String, local_path: String) -> Result<String, String> {
    do_git_clone(&app, &url, &local_path, None, None).await
}

/// Clone a private git repository with credentials
#[tauri::command]
pub async fn git_clone_with_credentials(
    app: AppHandle,
    url: String,
    local_path: String,
    username: String,
    password: String,
) -> Result<String, String> {
    do_git_clone(&app, &url, &local_path, Some(&username), Some(&password)).await
}

async fn do_git_clone(
    app: &AppHandle,
    url: &str,
    local_path: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<String, String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(local_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Check if target path already exists
    if Path::new(local_path).exists() {
        return Err(format!("{}: {}", i18n::t("backend.git.targetPathExists"), local_path));
    }

    // Send start event
    let _ = app.emit("git-clone-progress", serde_json::json!({
        "status": "started",
        "message": i18n::t("backend.git.cloning")
    }));

    // If credentials provided, set up GIT_ASKPASS
    let askpass_script_path = if username.is_some() && password.is_some() {
        let temp_dir = std::env::temp_dir();
        let unique_id = uuid::Uuid::new_v4().to_string();
        let askpass_script = temp_dir.join(format!("swallownote_clone_askpass_{}.sh", unique_id));

        #[cfg(not(target_os = "windows"))]
        let script_content = format!(
            "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
            username.unwrap().replace('\'', "'\\''"),
            password.unwrap().replace('\'', "'\\''")
        );

        #[cfg(target_os = "windows")]
        let script_content = format!(
            "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo {}\n) else (\n  echo {}\n)",
            username.unwrap().replace('"', "\"\""),
            password.unwrap().replace('"', "\"\"")
        );

        std::fs::write(&askpass_script, &script_content)
            .map_err(|e| format!("Failed to create askpass script: {}", e))?;

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&askpass_script)
                .map_err(|e| format!("Failed to read askpass script metadata: {}", e))?
                .permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(&askpass_script, perms)
                .map_err(|e| format!("Failed to set askpass script permissions: {}", e))?;
        }

        Some(askpass_script.to_string_lossy().to_string())
    } else {
        None
    };

    let mut cmd = super::create_command("git");
    cmd.args(["clone", "--progress", url, local_path])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref askpass_path) = askpass_script_path {
        cmd.env("GIT_ASKPASS", askpass_path);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to execute git clone: {}", e))?;

    // Read stderr for progress (git clone outputs progress to stderr)
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                // Send progress update
                let _ = app.emit("git-clone-progress", serde_json::json!({
                    "status": "progress",
                    "message": line
                }));
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for git clone: {}", e))?;

    // Clean up askpass script
    if let Some(ref askpass_path) = askpass_script_path {
        let _ = std::fs::remove_file(askpass_path);
    }

    if status.success() {
        let _ = app.emit("git-clone-progress", serde_json::json!({
            "status": "completed",
            "message": i18n::t("backend.git.cloneCompleted")
        }));
        Ok(local_path.replace('\\', "/"))
    } else {
        let _ = app.emit("git-clone-progress", serde_json::json!({
            "status": "error",
            "message": i18n::t("backend.git.cloneFailed")
        }));
        Err(i18n::t("backend.git.cloneFailed"))
    }
}

// ===================== Keyring Credential Management =====================

const KEYRING_SERVICE: &str = "SwallowNote";

/// Save git credentials for a repository to the system keyring
/// The credential key is based on the repository's remote URL for uniqueness
#[tauri::command]
pub fn git_credential_save(repo_path: String, username: String, password: String) -> Result<(), String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    // Store as JSON: {"username": "...", "password": "..."}
    let credential = serde_json::json!({
        "username": username,
        "password": password,
    });
    
    entry.set_password(&credential.to_string())
        .map_err(|e| format!("Failed to save credential: {}", e))?;
    
    Ok(())
}

/// Get git credentials for a repository from the system keyring
#[tauri::command]
pub fn git_credential_get(repo_path: String) -> Result<Option<GitCredential>, String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    match entry.get_password() {
        Ok(json_str) => {
            let cred: GitCredential = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse credential: {}", e))?;
            Ok(Some(cred))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get credential: {}", e)),
    }
}

/// Delete git credentials for a repository from the system keyring
#[tauri::command]
pub fn git_credential_delete(repo_path: String) -> Result<(), String> {
    let key = build_credential_key(&repo_path)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    entry.delete_credential()
        .map_err(|e| format!("Failed to delete credential: {}", e))?;
    
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitCredential {
    pub username: String,
    pub password: String,
}

/// Build a unique credential key based on the repository's remote URL
fn build_credential_key(repo_path: &str) -> Result<String, String> {
    // Use the remote URL as the key if available, otherwise use the repo path
    match get_remote_url(repo_path) {
        Ok(url) => Ok(format!("git:{}", url)),
        Err(_) => Ok(format!("git:path:{}", repo_path.replace('\\', "/"))),
    }
}
