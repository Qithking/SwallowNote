mod models;
pub use models::*;
mod paths;
pub use paths::*;
mod errors;
mod runner;
pub use runner::*;
mod askpass;
pub use askpass::*;
mod credentials;
pub use credentials::*;
mod scan;
pub use scan::*;
mod branch;
pub use branch::*;
mod word_diff;
pub use word_diff::*;
mod commit;
pub use commit::*;
mod pull;
pub use pull::*;
mod push;
pub use push::*;
mod clone;
pub use clone::*;
mod conflict_content;
mod conflict;
pub use conflict::*;
mod conflict_repo_records;
pub use conflict_repo_records::*;

#[cfg(test)]
mod test_utils;

use std::path::Path;
use crate::i18n;

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
    // G-15 修复：分支获取失败时记录日志，返回空字符串让前端能据此判断获取失败
    // （区别于 "unknown" 等真实分支名）。若 git 命令本身失败，后续 run_git 会向上传播错误。
    let branch = get_branch(&path).unwrap_or_else(|e| {
        #[cfg(debug_assertions)]
        eprintln!("[WARN] git_status: failed to get branch for {}: {}", path, e);
        "".to_string()
    });
    // 不再吞掉 run_git 错误：git 失败时向上传播，避免前端误以为"无改动"。
    let modified = run_git(&path, &["diff", "--name-only"])?;
    let staged_modified = run_git(&path, &["diff", "--cached", "--name-only"])?;
    let untracked = run_git(&path, &["ls-files", "--others", "--exclude-standard"])?;

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
    let deleted_output = run_git(&path, &["ls-files", "--deleted"])?;
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
    let relative_path = Path::new(&file_path)
        .strip_prefix(Path::new(&path))
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.invalidRelativePath"), e))?;
    let git_path = to_git_path(relative_path);
    run_git(&path, &["diff", "--", &git_path])
}
