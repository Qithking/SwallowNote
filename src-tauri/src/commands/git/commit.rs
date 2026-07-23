use std::path::Path;
use super::models::{CommitPushResult, GitFileLogEntry};
use super::runner::{run_git, run_git_no_trim};
use super::paths::to_git_path;
use super::branch::{is_detached_head, fix_detached_head, should_use_rebase, resolve_push_target_branch, is_rebase_or_merge_in_progress, has_real_conflicts, cleanup_stale_rebase_state};
use super::scan::{get_remote_url, parse_gitmodules};
use super::errors::{is_conflict_error, is_auth_error};
use crate::i18n;
use log::{debug, error};

/// Stage all changes and commit
/// G-02 修复：返回 bool 表示是否有实际提交（true=已提交，false=无改动），
/// 让前端能区分"无改动"和"提交成功"，避免误报"提交成功"但实际无提交。
/// G-06 修复：检测到 detached HEAD 时不自动切换分支，返回 DETACHED_HEAD 错误码
/// 让前端提示用户手动处理，避免分支切换丢失改动。
#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<bool, String> {
    // G-06 修复：检测 detached HEAD，不自动切换分支，返回错误码让前端提示用户
    if is_detached_head(&path) {
        return Err("DETACHED_HEAD:Repository is in detached HEAD state. Please checkout a branch first.".to_string());
    }

    // Stage all changes
    // G-10 风险评估：git add -A 包含 untracked 文件，可能意外提交敏感文件。
    // 用户决策保留此行为，依赖 .gitignore 排除文件。建议用户在 .gitignore 中配置
    // 敏感文件模式（如 .env、*.key、*.pem 等）防止意外提交。
    run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;

    // Commit
    let committed = match run_git(&path, &["commit", "-m", &message]) {
        Ok(_) => true, // 提交成功
        Err(e) => {
            let err_lower = e.to_lowercase();
            if !err_lower.contains("nothing to commit")
                && !err_lower.contains("working tree clean")
                && !err_lower.contains("no changes added to commit") {
                return Err(format!("Failed to commit: {}", e));
            }
            // G-02 修复：nothing to commit 不再静默视为成功，返回 false 让前端区分
            false
        }
    };

    Ok(committed)
}

/// Commit and push in one command
#[tauri::command]
pub async fn git_commit_and_push(path: String, message: String) -> Result<CommitPushResult, String> {
    // G-06 修复：检测到 detached HEAD 时自动修复，按用户场景无需用户手动切换分支。
    // 若无法自动修复，fix_detached_head 会返回错误，提交前失败比提交中失败更安全。
    if is_detached_head(&path) {
        fix_detached_head(&path).map_err(|e| format!("Failed to prepare commit: {}", e))?;
    }

    // Stage all changes including submodules
    run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;

    // 使用 --porcelain 输出避免依赖本地化文本（如 "modified content"），保证跨语言环境稳定。
    // 通过将 porcelain 变更路径与 .gitmodules 中的子模块路径比对，判定子模块是否有改动。
    let status_output = run_git(&path, &["status", "--porcelain"])?;
    let gitmodules_path = std::path::Path::new(&path).join(".gitmodules");
    let has_submodule_modified = gitmodules_path.exists()
        && parse_gitmodules(&gitmodules_path)
            .map(|submodule_paths| {
                status_output.lines().any(|line| {
                    // porcelain v1 格式：XY <path>，前两位为状态码，第三位为空格。
                    // 变更行长度至少为 3；取第三位之后的路径部分与子模块路径比对。
                    // trim_matches('"') 处理含空格等特殊字符时 git 自动加引号的情况。
                    if line.len() < 3 { return false; }
                    let entry_path = line[3..].trim().trim_matches('"');
                    submodule_paths.iter().any(|sp| sp == entry_path)
                })
            })
            .unwrap_or(false);

    // G-02 修复：追踪是否产生了新提交，让前端能区分"无改动"和"提交成功"
    let mut committed = false;

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
                    // nothing to commit：committed 保持 false
                } else {
                    committed = true;
                }
            }
            Err(_) => {
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
            // G-02 修复：nothing to commit 不再静默视为成功，committed 保持 false，
            // 继续尝试 push（可能有未推送的本地提交）
        } else {
            committed = true;
        }
    }

    // Push - only if remote exists
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(&path)?;
    let mut pushed = false;
    if remote_url.is_some() {
        // Check if already in a rebase/merge state before pulling
        if is_rebase_or_merge_in_progress(&path) {
            if has_real_conflicts(&path) {
                return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress".to_string());
            }
            // Stale state files - clean up before proceeding
            cleanup_stale_rebase_state(&path);
        }

        // Pull first to integrate remote changes before pushing
        // G-13 修复：尊重用户 git 配置 pull.rebase，决定使用 rebase 还是 merge
        let use_rebase = should_use_rebase(&path);
        let pull_args: Vec<&str> = if use_rebase {
            vec!["pull", "--rebase"]
        } else {
            vec!["pull"]
        };
        let pull_result = run_git(&path, &pull_args);
        if let Err(e) = pull_result {
            // If it's a conflict, do NOT abort - preserve conflict state for UI.
            // Keep conflict markers in the working tree so the user must resolve them in ConflictResolver.
            if is_conflict_error(&e) {
                return Err(format!("REBASE_CONFLICT:{} [Note: Conflict markers preserved in working tree. Use ConflictResolver to resolve.]", e));
            }
            // Auth errors during pull
            if is_auth_error(&e) {
                return Err(format!("AUTH_REQUIRED:{}", e));
            }
            // Non-conflict, non-auth error (network, zlib, etc.):
            // Clean up stale rebase state that pull --rebase may have left
            // and report error without triggering conflict UI
            cleanup_stale_rebase_state(&path);
            return Err(format!("Pull failed: {}", e));
        }

        // Fix detached HEAD that rebase may have caused（rebase 后修复 detached HEAD 是合理场景，保留）
        fix_detached_head(&path)?;

        // Check again after pull - if we're now in a conflict state, don't push
        if is_rebase_or_merge_in_progress(&path) {
            if has_real_conflicts(&path) {
                return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress".to_string());
            }
            // Pull left stale state (shouldn't happen normally but be defensive)
            cleanup_stale_rebase_state(&path);
        }

        let push_result = run_git(&path, &["push"]);
        match push_result {
            Ok(_) => {
                pushed = true;
            }
            Err(e) => {
                let err_lower = e.to_lowercase();
                // detached HEAD fallback
                if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                    if let Some(branch) = resolve_push_target_branch(&path) {
                        debug!("[INFO] git_commit_and_push: detached HEAD, pushing HEAD:refs/heads/{}", branch);
                        let retry = run_git(&path, &["push", "origin", &format!("HEAD:refs/heads/{}", branch)]);
                        if let Err(retry_err) = retry {
                            let retry_lower = retry_err.to_lowercase();
                            if retry_lower.contains("not currently on a branch") || retry_lower.contains("detached head") {
                                // Still detached after retry — return original error
                                return Err(format!("Failed to push: {}", e));
                            }
                            if is_auth_error(&retry_err) {
                                return Err(format!("AUTH_REQUIRED:{}", retry_err));
                            }
                            return Err(format!("Failed to push: {}", retry_err));
                        }
                        pushed = true;
                    } else {
                        if is_auth_error(&e) {
                            return Err(format!("AUTH_REQUIRED:{}", e));
                        }
                        return Err(format!("Failed to push: {}", e));
                    }
                } else if is_auth_error(&e) {
                    return Err(format!("AUTH_REQUIRED:{}", e));
                } else {
                    return Err(format!("Failed to push: {}", e));
                }
            }
        }
    }

    Ok(CommitPushResult { committed, pushed })
}

pub fn commit_submodules(path: &str, message: &str) -> Result<(), String> {
    // 从 .gitmodules 获取子模块路径列表
    let gitmodules_path = std::path::Path::new(path).join(".gitmodules");
    if !gitmodules_path.exists() {
        // 无 .gitmodules，说明没有子模块配置，直接返回
        return Ok(());
    }

    let submodule_paths = parse_gitmodules(&gitmodules_path)?;

    for submodule_rel_path in submodule_paths {
        let submodule_full_path = format!("{}/{}", path, submodule_rel_path);

        // 子模块目录不存在则跳过
        if !std::path::Path::new(&submodule_full_path).exists() {
            continue;
        }

        // 递归处理嵌套子模块：先提交最内层子模块的变更，再逐层向外提交。
        commit_submodules(&submodule_full_path, message)?;

        // 检查当前子模块是否有未提交变更
        let submodule_status = run_git(&submodule_full_path, &["status", "--porcelain"])?;
        if !submodule_status.trim().is_empty() {
            // 在子模块内暂存并提交
            run_git(&submodule_full_path, &["add", "-A"])?;
            if let Err(e) = run_git(&submodule_full_path, &["commit", "-m", message]) {
                // 子模块无改动（nothing to commit）不算错误
                if !e.contains("nothing to commit") && !e.contains("working tree clean") {
                    return Err(e);
                }
            }
        }
    }

    // 在父仓库中暂存子模块引用变更
    run_git(path, &["add", "-A"])?;
    Ok(())
}

/// Walk up directories from `path` to find the first ancestor containing a `.git` directory.
/// Returns the repo root path as a String, or None if not inside a git repository.
fn find_git_root(path: &str) -> Option<String> {
    let mut current = Path::new(path);
    loop {
        if current.join(".git").exists() {
            return current.to_str().map(|s| s.to_string());
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return None,
        }
    }
}

/// Auto commit a single file (local only, no push)
#[tauri::command]
pub async fn git_auto_commit(file_path: String) -> Result<(), String> {
    debug!("[INFO] git_auto_commit called for: {}", file_path);

    // Find the git root by walking up directories
    let repo_root = match find_git_root(&file_path) {
        Some(root) => root,
        None => {
            debug!("[INFO] git_auto_commit: not in a git repo, skipping");
            return Ok(()); // Not in a git repo
        }
    };
    let repo_path = repo_root.as_str();
    debug!("[INFO] git_auto_commit: repo_path={}", repo_path);

    // Skip auto-commit if repo is in a rebase/merge conflict state
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        debug!("[INFO] git_auto_commit: repo is in conflict state, skipping");
        return Ok(()); // Skip silently during conflict resolution
    }

    // Auto-fix detached HEAD by switching back to the correct branch
    if let Err(e) = fix_detached_head(repo_path) {
        error!("[ERROR] git_auto_commit: fix_detached_head failed: {}", e);
        return Err(e);
    }

    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.invalidRelativePath"), e))?;
    let relative_path_str = relative_path.to_str().ok_or(i18n::t("backend.git.invalidPathEncoding"))?;
    let git_path = to_git_path(relative_path);
    debug!("[INFO] git_auto_commit: relative_path={} git_path={}", relative_path_str, git_path);

    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    let commit_message = format!("Auto-save: {}", file_name);

    // Stage only this file using the relative path to avoid issues with absolute Windows paths
    match run_git(repo_path, &["add", &git_path]) {
        Ok(_) => {
            debug!("[INFO] git_auto_commit: git add succeeded")
        }
        Err(e) => {
            error!("[ERROR] git_auto_commit: git add failed: {}", e);
            return Err(e);
        }
    }

    // Commit
    match run_git(repo_path, &["commit", "-m", &commit_message]) {
        Ok(_) => {
            debug!("[INFO] git_auto_commit: git commit succeeded");
            Ok(())
        }
        Err(e) => {
            // "nothing to commit" usually means the working tree/index content is identical to HEAD.
            // Keep this silent but log it so we can diagnose why auto-commit appears to do nothing.
            if e.contains("nothing to commit") || e.contains("working tree clean") || e.contains("no changes added to commit") {
                debug!("[INFO] git_auto_commit: git commit reports no changes ({})", e);
                Ok(())
            } else {
                error!("[ERROR] git_auto_commit: git commit failed: {}", e);
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
    let repo_root = find_git_root(&file_path).ok_or("NOT_IN_GIT_REPO".to_string())?;
    let repo_path = repo_root.as_str();
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let git_path = to_git_path(relative_path);

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
            &git_path,
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
    let repo_root = find_git_root(&file_path).ok_or("NOT_IN_GIT_REPO".to_string())?;
    let repo_path = repo_root.as_str();
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let git_path = to_git_path(relative_path);

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
            &git_path,
        ],
    )?;

    Ok(output)
}

/// Get the full file content at a specific commit (for restore functionality)
#[tauri::command]
pub async fn git_show_file_content(file_path: String, commit_hash: String) -> Result<String, String> {
    // Find the git root by walking up directories
    let repo_root = find_git_root(&file_path).ok_or("NOT_IN_GIT_REPO".to_string())?;
    let repo_path = repo_root.as_str();
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("Invalid relative path: {}", e))?;
    let git_path = to_git_path(relative_path);

    // Get the full file content at the given commit
    // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
    let output = run_git_no_trim(
        repo_path,
        &[
            "show",
            &format!("{}:{}", commit_hash, git_path),
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
    let repo_root = find_git_root(&file_path).ok_or("NOT_IN_GIT_REPO".to_string())?;
    let repo_path = repo_root.as_str();
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.invalidRelativePath"), e))?;
    let git_path = to_git_path(relative_path);

    // Check if remote exists
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(repo_path)?;
    if remote_url.is_none() {
        return Err("NO_REMOTE".to_string());
    }

    // Fetch from remote
    run_git(repo_path, &["fetch"]).map_err(|e| {
        if is_auth_error(&e) {
            format!("AUTH_REQUIRED:{}", e)
        } else {
            format!("{}: {}", i18n::t("backend.git.fetchFailed"), e)
        }
    })?;

    // Get the current branch name
    let branch = super::branch::get_branch(repo_path)?;

    // Get the file content from the remote branch (origin/<branch>)
    // G-16 修复：使用 run_git_no_trim 保留文件原始末尾换行
    let remote_ref = format!("origin/{}:{}", branch, git_path);
    let output = run_git_no_trim(
        repo_path,
        &["show", "--no-color", &remote_ref],
    )?;

    // UI 文案已明确告知用户"强制覆盖本地文件，本地未提交的修改将丢失"，
    // 因此这里直接执行 checkout，不再因为本地有改动而拒绝。
    run_git(repo_path, &["checkout", &format!("origin/{}", branch), "--", &git_path])
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.checkoutFileFailed"), e))?;

    Ok(output)
}

/// 检查本地是否有未推送到远端的 commit。
/// 通过 `git rev-list --count @{upstream}..HEAD` 判断本地领先远端的 commit 数,
/// 返回 Ok(true) 表示有未推送的本地 commit,Ok(false) 表示本地与远端同步。
/// @{upstream} 在未设置 upstream 或 detached HEAD 时会失败,此时返回 Ok(true)
/// 以让调用方继续走 push 流程(由 push 本身的错误来反馈真实状态)。
fn is_local_ahead_of_remote(repo_path: &str) -> Result<bool, String> {
    let output = run_git(repo_path, &["rev-list", "--count", "@{upstream}..HEAD"]);
    match output {
        Ok(s) => {
            let count: usize = s.trim().parse().unwrap_or(0);
            Ok(count > 0)
        }
        Err(_) => {
            // @{upstream} 解析失败(未设置 upstream 或 detached HEAD),保守返回 true
            // 让调用方继续 push,由 push 命令本身的成功/失败决定最终结果。
            Ok(true)
        }
    }
}

/// Force upload a single file to remote: stage, commit, and force push.
/// This overwrites the remote version with the local version.
#[tauri::command]
pub async fn git_force_upload_file(file_path: String) -> Result<(), String> {
    // Find the git root by walking up directories
    let repo_root = find_git_root(&file_path).ok_or("NOT_IN_GIT_REPO".to_string())?;
    let repo_path = repo_root.as_str();
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_path)
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.invalidRelativePath"), e))?;
    let git_path = to_git_path(relative_path);

    // Check if remote exists
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(repo_path)?;
    if remote_url.is_none() {
        return Err("NO_REMOTE".to_string());
    }

    // Stage the file using the relative path to avoid issues with absolute Windows paths
    run_git(repo_path, &["add", &git_path])
        .map_err(|e| format!("Failed to stage file: {}", e))?;

    // Commit
    let commit_message = format!("Force upload: {}", git_path);
    let mut had_new_commit = false;
    match run_git(repo_path, &["commit", "-m", &commit_message]) {
        Ok(_) => {
            had_new_commit = true;
        }
        Err(e) => {
            // If nothing to commit, we still want to force push existing commits
            if !e.contains("nothing to commit") && !e.contains("working tree clean") && !e.contains("no changes added to commit") {
                return Err(format!("Failed to commit: {}", e));
            }
        }
    }

    // 如果本次没有新 commit 产生,检查本地是否领先于远端。
    // 本地与远端同步时,无需 push,返回 ALREADY_UP_TO_DATE 提示用户"已提交,无须重复操作"。
    if !had_new_commit {
        let local_ahead = is_local_ahead_of_remote(repo_path)?;
        if !local_ahead {
            return Err("ALREADY_UP_TO_DATE".to_string());
        }
    }

    // Force push (with detached HEAD handling)
    let result = run_git(repo_path, &["push", "--force"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            // detached HEAD 时 `git push --force` 没有上游分支，会报
            // "fatal: You are not currently on a branch"。此时改为
            // `push --force origin HEAD:refs/heads/<branch>` 显式指定目标分支。
            let err_lower = e.to_lowercase();
            if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                if let Some(branch) = resolve_push_target_branch(repo_path) {
                    debug!("[INFO] git_force_upload_file: detached HEAD, pushing HEAD:refs/heads/{}", branch);
                    let retry = run_git(
                        repo_path,
                        &["push", "--force", "origin", &format!("HEAD:refs/heads/{}", branch)],
                    );
                    return match retry {
                        Ok(_) => Ok(()),
                        Err(retry_err) => {
                            if is_auth_error(&retry_err) {
                                Err(format!("AUTH_REQUIRED:{}", retry_err))
                            } else {
                                Err(format!("Failed to force push: {}", retry_err))
                            }
                        }
                    };
                }
                return Err(format!(
                    "Failed to force push: repository is in detached HEAD state and no target branch could be resolved: {}",
                    e
                ));
            }
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to force push: {}", e))
            }
        }
    }
}
