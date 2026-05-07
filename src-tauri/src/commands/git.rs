use serde::Serialize;
use std::path::Path;

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

/// Initialize a git repository
#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    let repo_path = Path::new(&path);

    // Check if already a repo
    if repo_path.join(".git").exists() {
        return Ok(());
    }

    // Use git2-rs if available, otherwise use system git
    // For now, use a simple approach - create .git folder manually with basic structure
    // In production, this would use git2-rs
    let git_dir = repo_path.join(".git");
    std::fs::create_dir_all(&git_dir).map_err(|e| format!("Failed to create .git directory: {}", e))?;

    // Create basic git structure
    std::fs::create_dir_all(git_dir.join("objects")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(git_dir.join("refs").join("heads")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(git_dir.join("refs").join("tags")).map_err(|e| e.to_string())?;

    // Write HEAD file
    std::fs::write(git_dir.join("HEAD"), b"ref: refs/heads/main\n").map_err(|e| e.to_string())?;

    // Write basic config
    let config = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";
    std::fs::write(git_dir.join("config"), config).map_err(|e| e.to_string())?;

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

fn get_branch(path: &str) -> Result<String, String> {
    run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
}

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}
