use serde::{Deserialize, Serialize};
use std::path::Path;

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

/// Push commits to remote
#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    run_git(&path, &["push"]).map_err(|e| format!("Failed to push: {}", e))?;
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
    let has_submodule_modified = status_output.contains("modified content") || status_output.contains("submodule");
    
    if has_submodule_modified {
        // First try to commit changes in submodules
        match commit_submodules(&path, &message) {
            Ok(_) => {
                // Submodules committed successfully, now stage and commit parent
                run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;
                run_git(&path, &["commit", "-m", &message]).map_err(|e| format!("Failed to commit: {}", e))?;
            }
            Err(e) => {
                // Submodule commit failed - this means submodule has uncommitted changes
                // Return specific error for frontend to handle
                return Err(format!("子模块内部有未提交的变更，请先在子模块内提交"));
            }
        }
    } else {
        // Regular commit
        let commit_result = run_git(&path, &["commit", "-m", &message]);
        if let Err(e) = commit_result {
            return Err(format!("Failed to commit: {}", e));
        }
    }

    // Push - only if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_ok() {
        run_git(&path, &["push"]).map_err(|e| format!("Failed to push: {}", e))?;
    }

    Ok(())
}

fn commit_submodules(path: &str, message: &str) -> Result<(), String> {
    // Get list of submodules
    let submodule_output = run_git(path, &["submodule", "status"])?;
    
    for line in submodule_output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // Parse submodule line: e.g., " 1a2b3c4... (heads/main)" or "1a2b3c4... (heads/main)"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        
        let submodule_path = parts.last().unwrap().trim_matches(&['(', ')'][..]);
        let submodule_full_path = format!("{}/{}", path, submodule_path);
        
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

    let max_count_str = max_count.to_string();
    let skip_str = skip.to_string();

    let format_str = "%H%n%s%n%ai";
    let output = run_git(
        repo_path,
        &[
            "log",
            "--follow",
            "--format", format_str,
            "--numstat",
            "-n", &max_count_str,
            "--skip", &skip_str,
            "--",
            relative_path_str,
        ],
    )?;

    let mut entries = Vec::new();
    let mut lines = output.lines().peekable();

    while lines.peek().is_some() {
        let hash = lines.next().unwrap_or("").to_string();
        if hash.is_empty() {
            break;
        }
        let message = lines.next().unwrap_or("").to_string();
        let date = lines.next().unwrap_or("").to_string();

        let mut insertions = 0;
        let mut deletions = 0;

        while let Some(line) = lines.peek() {
            if line.is_empty() {
                lines.next();
                break;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                if let Ok(ins) = parts[0].parse::<usize>() {
                    insertions += ins;
                }
                if let Ok(del) = parts[1].parse::<usize>() {
                    deletions += del;
                }
            }
            lines.next();
        }

        entries.push(GitFileLogEntry {
            hash,
            message,
            date,
            insertions,
            deletions,
        });
    }

    Ok(entries)
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
        
        let path_str = dir.to_string_lossy().to_string();
        
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
                        
                        let submodule_path_str = submodule_full_path.to_string_lossy().to_string();
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

fn check_has_uncommitted_changes(path: &str) -> Result<bool, String> {
    let modified = run_git(path, &["diff", "--name-only"]).unwrap_or_default();
    let staged = run_git(path, &["diff", "--cached", "--name-only"]).unwrap_or_default();
    let untracked = run_git(path, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();
    
    let count = modified.lines()
        .chain(staged.lines())
        .chain(untracked.lines())
        .filter(|line| !line.is_empty())
        .count();
    
    Ok(count > 0)
}

fn get_uncommitted_count(path: &str) -> (bool, usize) {
    let modified = run_git(path, &["diff", "--name-only"]).unwrap_or_default();
    let staged = run_git(path, &["diff", "--cached", "--name-only"]).unwrap_or_default();
    let untracked = run_git(path, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();
    
    let mut count = 0usize;
    for line in modified.lines().chain(staged.lines()).chain(untracked.lines()) {
        if !line.is_empty() {
            count += 1;
        }
    }
    
    (count > 0, count)
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
