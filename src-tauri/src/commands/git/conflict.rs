use std::path::Path;
use super::models::ConflictFile;
use super::runner::{run_git, run_git_no_trim};
use super::paths::{to_git_path, unescape_git_path};
use super::branch::is_rebase_scenario;
use super::conflict_content::{fetch_stage_content, get_conflict_content, check_and_continue_rebase};
use log::{debug, warn};

/// Get list of conflicting files in a repository during a rebase or merge
#[tauri::command]
pub async fn git_get_conflict_files(repo_path: String) -> Result<Vec<ConflictFile>, String> {
    // Check if there's an ongoing rebase or merge
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    let has_state_file = rebase_merge.exists() || rebase_apply.exists() || merge_head.exists();

    let mut seen_paths = std::collections::HashSet::new();
    let mut files = Vec::new();

    // Method 1: Get unmerged files using diff-filter=U
    if let Ok(output) = run_git(&repo_path, &["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"]) {
        for line in output.lines() {
            let rel_path = line.trim().trim_matches('"');
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
        if let Ok(ls_output) = run_git(&repo_path, &["-c", "core.quotepath=false", "ls-files", "--unmerged"]) {
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let raw_path = parts[3..].join(" ");
                    let rel_path = unescape_git_path(raw_path.trim_matches('"'));
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
        if let Ok(status_output) = run_git(&repo_path, &["-c", "core.quotepath=false", "status", "--porcelain"]) {
            for line in status_output.lines() {
                let line = line.trim();
                if line.len() >= 4 {
                    let xy = &line[0..2];
                    if xy.contains("U") || xy == "DD" || xy == "AA" {
                        let raw_path = line[3..].trim();
                        let rel_path = unescape_git_path(raw_path.trim_matches('"'));
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

    // Method 4: Check for conflict markers in working tree files as last resort
    if files.is_empty() && has_state_file {
        if let Ok(grep_output) = run_git(&repo_path, &["grep", "-l", "^<<<<<<< ", "--full-name"]) {
            for line in grep_output.lines() {
                let rel_path = line.trim().trim_matches('"').to_string();
                if !rel_path.is_empty() && seen_paths.insert(rel_path.clone()) {
                    let abs_path = format!("{}/{}", repo_path.trim_end_matches('/'), rel_path);
                    files.push(ConflictFile {
                        path: rel_path,
                        abs_path,
                    });
                }
            }
        }
    }

    // Early return if no state file and no conflicts found
    if !has_state_file && files.is_empty() {
        debug!("[INFO] git_get_conflict_files: no rebase/merge state found and no conflicts detected in {}", repo_path);
        return Ok(vec![]);
    }

    // If we have a state file but found NO actual conflict files via standard methods,
    // the rebase/merge may be in a special state (e.g. interactive rebase with empty todo).
    // Return empty list - the frontend should keep showing the conflict tab until user resolves it.
    if files.is_empty() {
        debug!("[INFO] git_get_conflict_files: rebase/merge state exists but no unmerged files found in {}", repo_path);
    }

    debug!("[INFO] git_get_conflict_files: found {} conflict files in {}", files.len(), repo_path);
    Ok(files)
}

// 获取冲突文件的本地版本。rebase 用 stage 3/REBASE_HEAD，merge 用 stage 2/HEAD。
#[tauri::command]
pub async fn git_get_conflict_local_content(repo_path: String, file_path: String) -> Result<String, String> {
    debug!("[INFO] git_get_conflict_local_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts
    if rel_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    debug!("[INFO] git_get_conflict_local_content: normalized rel_path='{}'", rel_path);

    // G-14 修复：使用公共函数统一 stage 映射逻辑
    // rebase: local = REBASE_HEAD + stage 3（theirs = 本地）
    // merge : local = HEAD + stage 2（ours = 本地）
    let is_rebasing = is_rebase_scenario(&repo_path);
    let result = if is_rebasing {
        // 先尝试 REBASE_HEAD（rebase 场景下的本地提交）
        // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 3 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 3)
    } else {
        // 先尝试 HEAD（merge 场景下的本地分支）
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 2 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 2)
    };

    if let Some(content) = result {
        debug!("[INFO] git_get_conflict_local_content: OK from stage (len={})", content.len());
        Ok(content)
    } else {
        warn!("[WARN] git_get_conflict_local_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
        Ok(String::new())
    }
}

// 获取冲突文件的远程版本。rebase 用 stage 2/HEAD，merge 用 stage 3/MERGE_HEAD。
#[tauri::command]
pub async fn git_get_conflict_remote_content(repo_path: String, file_path: String) -> Result<String, String> {
    debug!("[INFO] git_get_conflict_remote_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts
    if rel_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    debug!("[INFO] git_get_conflict_remote_content: normalized rel_path='{}'", rel_path);

    // G-14 修复：使用公共函数统一 stage 映射逻辑
    // rebase: remote = HEAD + stage 2（ours = upstream/remote）
    // merge : remote = MERGE_HEAD + stage 3（theirs = remote）
    let is_rebasing = is_rebase_scenario(&repo_path);
    let result = if is_rebasing {
        // 先尝试 HEAD（rebase 场景下的 upstream/remote）
        // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
        if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
            if !output.is_empty() { return Ok(output); }
        }
        // 再用 stage 2 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 2)
    } else {
        // 先尝试 MERGE_HEAD（merge 场景下的 remote）
        let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
        if merge_head.exists() {
            if let Ok(output) = run_git_no_trim(&repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        }
        // 再用 stage 3 + cat-file fallback
        fetch_stage_content(&repo_path, &rel_path, 3)
    };

    if let Some(content) = result {
        debug!("[INFO] git_get_conflict_remote_content: OK from stage (len={})", content.len());
        Ok(content)
    } else {
        warn!("[WARN] git_get_conflict_remote_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
        Ok(String::new())
    }
}

/// Resolve a conflict by choosing a side for a specific file
/// side: "local" or "remote"
#[tauri::command]
pub async fn git_resolve_conflict_file(repo_path: String, file_path: String, side: String) -> Result<(), String> {
    // strip_prefix 失败时用 canonicalize 规范化两个路径后再 strip，处理符号链接、相对路径等情况
    // 用 match + to_path_buf 取得所有权，避免 or_else 闭包返回引用局部变量导致的借用错误。
    let rel_path = match Path::new(&file_path).strip_prefix(Path::new(&repo_path)) {
        Ok(p) => p.to_path_buf(),
        Err(_) => {
            // 规范化后重试：解决因路径形式不一致（如 /var vs /private/var）导致 strip_prefix 失败
            let canon_file = std::fs::canonicalize(&file_path)
                .map_err(|e| format!("Failed to resolve file path '{}': {}", file_path, e))?;
            let canon_repo = std::fs::canonicalize(&repo_path)
                .map_err(|e| format!("Failed to resolve repo path '{}': {}", repo_path, e))?;
            canon_file
                .strip_prefix(&canon_repo)
                .map(|p| p.to_path_buf())
                .map_err(|e| {
                    format!("File path '{}' is not within repository '{}': {}", file_path, repo_path, e)
                })?
        }
    };
    let git_path = to_git_path(&rel_path);

    // Validate: reject path traversal attempts
    if git_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", git_path));
    }

    debug!("[INFO] git_resolve_conflict_file: repo_path={}, file_path={}, side={}", repo_path, file_path, side);

    // If side is "current", the user has already edited and saved the file via
    // git_save_conflict_file_content, so we just need to stage it.
    // If side is "local" or "remote", we overwrite with the chosen side's content.
    if side != "current" {
        let content = get_conflict_content(&repo_path, &git_path, &side)?;
        // 写入目标必须基于 repo_path + 相对路径，避免前端传入的 file_path
        // 指向仓库外（路径穿越）。
        let target_path = Path::new(&repo_path).join(&rel_path);
        std::fs::write(&target_path, &content)
            .map_err(|e| format!("Failed to write file: {}", e))?;
    }

    // Stage the resolved file
    run_git(&repo_path, &["add", &git_path])?;

    check_and_continue_rebase(&repo_path)
}

/// Save edited content to a conflict file (without marking as resolved).
/// This writes the user's edits back to the file but does NOT stage it.
/// The conflict is NOT considered resolved until git_resolve_conflict_file is called,
/// which stages the file and checks if rebase can continue.
#[tauri::command]
pub async fn git_save_conflict_file_content(repo_path: String, file_path: String, content: String) -> Result<(), String> {
    let rel_path = Path::new(&file_path)
        .strip_prefix(Path::new(&repo_path))
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let git_path = to_git_path(rel_path);

    // Validate: reject path traversal attempts
    if git_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", git_path));
    }

    debug!("[INFO] git_save_conflict_file_content: repo_path={}, file_path={}", repo_path, file_path);

    // Write the edited content back to the file
    // Do NOT run `git add` here — that would prematurely resolve the conflict.
    // Staging is done in `git_resolve_conflict_file` when the user explicitly resolves.
    // 写入目标基于 repo_path + 相对路径，避免前端传入的 file_path 指向仓库外（路径穿越）。
    let target_path = Path::new(&repo_path).join(rel_path);
    std::fs::write(&target_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

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

pub fn get_uncommitted_count(path: &str) -> (bool, usize) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_utils::{git_cmd, setup_conflict_repo, normalize};

    #[tokio::test]
    async fn test_get_conflict_local_content_merge_has_no_markers() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "line1\nlocal\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        // Trigger merge conflict without committing
        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["merge", "feature", "--no-commit", "--no-ff"])
            .status()
            .unwrap();
        assert!(!status.success(), "merge should produce conflicts");

        let working = std::fs::read_to_string(repo.join("file.txt")).unwrap();
        assert!(working.contains("<<<<<<<"), "working tree should have conflict markers");

        let local = git_get_conflict_local_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();
        let remote = git_get_conflict_remote_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();

        assert!(!local.contains("<<<<<<<"), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains("======="), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains(">>>>>>>"), "local content must not contain conflict markers:\n{}", local);
        assert!(!remote.contains("<<<<<<<"), "remote content must not contain conflict markers:\n{}", remote);

        assert_eq!(normalize(&local), "line1\nlocal\n", "local content should be HEAD version");
        assert_eq!(normalize(&remote), "line1\nremote\n", "remote content should be MERGE_HEAD version");
    }

    #[tokio::test]
    async fn test_get_conflict_local_content_rebase_has_no_markers() {
        let tmp = setup_conflict_repo();
        let repo = tmp.path();

        git_cmd(repo, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repo.join("file.txt"), "line1\nlocal\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "feature"]);

        git_cmd(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("file.txt"), "line1\nremote\n").unwrap();
        git_cmd(repo, &["add", "file.txt"]);
        git_cmd(repo, &["commit", "-q", "-m", "main"]);

        // Rebase feature onto main: feature is the branch being rebased (local).
        git_cmd(repo, &["checkout", "-q", "feature"]);
        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(["rebase", "main"])
            .status()
            .unwrap();
        assert!(!status.success(), "rebase should produce conflicts");
        assert!(repo.join(".git/rebase-merge").exists() || repo.join(".git/rebase-apply").exists(),
            "rebase state should exist");

        let working = std::fs::read_to_string(repo.join("file.txt")).unwrap();
        assert!(working.contains("<<<<<<<"), "working tree should have conflict markers");

        let local = git_get_conflict_local_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();
        let remote = git_get_conflict_remote_content(repo.to_str().unwrap().to_string(), "file.txt".to_string()).await.unwrap();

        assert!(!local.contains("<<<<<<<"), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains("======="), "local content must not contain conflict markers:\n{}", local);
        assert!(!local.contains(">>>>>>>"), "local content must not contain conflict markers:\n{}", local);
        assert!(!remote.contains("<<<<<<<"), "remote content must not contain conflict markers:\n{}", remote);

        assert_eq!(normalize(&local), "line1\nlocal\n", "local content should be REBASE_HEAD/stage 3 version (branch being rebased)");
        assert_eq!(normalize(&remote), "line1\nremote\n", "remote content should be HEAD/stage 2 version (upstream)");
    }
}
