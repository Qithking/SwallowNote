use super::runner::{run_git, run_git_with_env};
use super::branch::{should_use_rebase, is_detached_head, fix_detached_head, get_branch, is_rebase_or_merge_in_progress, has_real_conflicts, cleanup_stale_rebase_state};
use super::scan::get_remote_url;
use super::askpass::{create_askpass_script, build_askpass_env};
use super::errors::{is_conflict_error, is_auth_error};

/// Pull changes from remote with rebase by default
#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    // G-05 修复：区分"无远程配置"（Ok(None)）和"远程读取失败"（Err）
    let remote_url = get_remote_url(&path)?;
    if remote_url.is_none() {
        // 没有配置 origin 远程，跳过 pull（正常情况）
        return Ok(());
    }

    // 检查 rebase/merge 状态：有真实冲突则报错；仅 stale 状态则清理后继续。永不自动 resolve/continue。
    // 必须在 is_detached_head 检查之前执行：stale state 文件存在时 is_detached_head 返回 false，
    // 会导致 fix_detached_head 被跳过，pull 报 "You are not currently on a branch"。
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            // Real conflicts exist - require explicit user resolution
            return Err("REBASE_CONFLICT:Already in a conflict state. Please resolve conflicts first.".to_string());
        } else {
            // Stale rebase/merge state: clean up before proceeding with the pull.
            cleanup_stale_rebase_state(&path);
        }
    }

    // G-06 修复：detached HEAD 时 pull 会报 "You are not currently on a branch"。
    // 必须在 cleanup_stale_rebase_state 之后检查，否则 stale state 文件导致检测失效。
    if is_detached_head(&path) {
        fix_detached_head(&path).map_err(|e| format!("Failed to prepare pull: {}", e))?;
    }

    // G-13 修复：尊重用户 git 配置 pull.rebase，决定使用 rebase 还是 merge
    let use_rebase = should_use_rebase(&path);
    let pull_args: Vec<&str> = if use_rebase {
        vec!["pull", "--rebase"]
    } else {
        vec!["pull"]
    };
    let result = run_git(&path, &pull_args);
    match result {
        Ok(_) => {
            // Fix detached HEAD if it occurred during pull
            let _ = fix_detached_head(&path); // cleanup failure is non-fatal; continue best-effort
            Ok(())
        },
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve.
                // Keep conflict markers in the working tree so the user must resolve them in ConflictResolver.
                Err(format!("REBASE_CONFLICT:{} [Note: Conflict markers preserved in working tree. Use ConflictResolver to resolve.]", e))
            } else {
                // Non-conflict error (network, zlib, etc.): clean up stale rebase state
                // that pull --rebase may have left behind
                cleanup_stale_rebase_state(&path);
                Err(format!("Failed to pull: {}", e))
            }
        }
    }
}

/// Pull changes from remote with provided credentials
#[tauri::command]
pub async fn git_pull_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(&path)?;
    if remote_url.is_none() {
        return Ok(());
    }

    // 清理 stale rebase/merge 状态（必须在 is_detached_head 之前执行，
    // 否则 stale state 文件导致 is_detached_head 返回 false，fix_detached_head 被跳过）
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            return Err("REBASE_CONFLICT:Already in a conflict state. Please resolve conflicts first.".to_string());
        } else {
            cleanup_stale_rebase_state(&path);
        }
    }

    // G-06 修复：detached HEAD 时 pull 会报 "You are not currently on a branch"。
    // 必须在 cleanup_stale_rebase_state 之后检查。
    if is_detached_head(&path) {
        fix_detached_head(&path).map_err(|e| format!("Failed to prepare pull: {}", e))?;
    }

    // 创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 通用脚本读环境变量）
    let (askpass_path, _askpass_guard) = create_askpass_script("pull", &username, &password)?;
    let env_vars = build_askpass_env(&askpass_path, &username, &password);

    // G-13 修复：尊重用户 git 配置 pull.rebase
    let use_rebase = should_use_rebase(&path);
    let pull_args: Vec<&str> = if use_rebase {
        vec!["pull", "--rebase"]
    } else {
        vec!["pull"]
    };
    let result = run_git_with_env(&path, &pull_args, &env_vars);

    // Clean up the askpass script immediately
    let _ = std::fs::remove_file(&askpass_path);

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve.
                // Keep conflict markers in the working tree so the user must resolve them in ConflictResolver.
                Err(format!("REBASE_CONFLICT:{} [Note: Conflict markers preserved in working tree. Use ConflictResolver to resolve.]", e))
            } else if is_auth_error(&e) {
                // Auth failure — let the frontend prompt for credentials
                cleanup_stale_rebase_state(&path);
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                // Non-conflict error: clean up stale rebase state that pull --rebase may have left
                cleanup_stale_rebase_state(&path);
                Err(format!("Failed to pull: {}", e))
            }
        }
    }
}

/// Force pull from remote (discard local changes and reset to remote)
/// This performs: git fetch + git reset --hard origin/<branch> + git clean -fd
#[tauri::command]
pub async fn git_force_pull(path: String) -> Result<(), String> {
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(&path)?;
    if remote_url.is_none() {
        return Ok(()); // No remote, nothing to pull
    }

    // Fix detached HEAD before proceeding
    // 如果修复失败，后续 get_branch 可能返回 "HEAD" 导致 reset --hard origin/HEAD 失败
    fix_detached_head(&path).map_err(|e| format!("Failed to fix detached HEAD before force pull: {}", e))?;

    // Get current branch
    let branch = get_branch(&path)?;

    // Fetch from remote
    let fetch_result = run_git(&path, &["fetch", "origin"]);
    if let Err(e) = fetch_result {
        if is_auth_error(&e) {
            return Err(format!("AUTH_REQUIRED:{}", e));
        }
        return Err(format!("Failed to fetch: {}", e));
    }

    // Reset to remote branch, discarding all local changes
    let remote_ref = format!("origin/{}", branch);
    run_git(&path, &["reset", "--hard", &remote_ref])
        .map_err(|e| format!("Failed to reset: {}", e))?;

    // Clean untracked files and directories
    run_git(&path, &["clean", "-fd"]).map_err(|e| format!("Failed to clean: {}", e))?;

    Ok(())
}

/// Force pull (reset to remote) with provided credentials
#[tauri::command]
pub async fn git_force_pull_with_credentials(
    path: String,
    username: String,
    password: String,
) -> Result<(), String> {
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(&path)?;
    if remote_url.is_none() {
        return Ok(()); // No remote, nothing to pull
    }

    // Fix detached HEAD before proceeding
    // 如果修复失败，后续 get_branch 可能返回 "HEAD" 导致 reset --hard origin/HEAD 失败
    fix_detached_head(&path).map_err(|e| format!("Failed to fix detached HEAD before force pull: {}", e))?;

    // Get current branch
    let branch = get_branch(&path)?;

    // 创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 通用脚本读环境变量）
    let (askpass_path, _askpass_guard) = create_askpass_script("force_pull", &username, &password)?;
    let env_vars = build_askpass_env(&askpass_path, &username, &password);

    // Fetch from remote with credentials
    let fetch_result = run_git_with_env(&path, &["fetch", "origin"], &env_vars);
    let _ = std::fs::remove_file(&askpass_path);

    if let Err(e) = fetch_result {
        if is_auth_error(&e) {
            return Err(format!("AUTH_REQUIRED:{}", e));
        }
        return Err(format!("Failed to fetch: {}", e));
    }

    // Reset to remote branch, discarding all local changes
    let remote_ref = format!("origin/{}", branch);
    run_git(&path, &["reset", "--hard", &remote_ref])
        .map_err(|e| format!("Failed to reset: {}", e))?;

    // Clean untracked files and directories
    run_git(&path, &["clean", "-fd"]).map_err(|e| format!("Failed to clean: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_utils::git_cmd;

    /// Reproduces the user's bug: stale rebase state + detached HEAD causes
    /// git_pull to fail with "You are not currently on a branch".
    ///
    /// Root cause: is_detached_head is checked BEFORE cleanup_stale_rebase_state.
    /// When stale rebase state files exist, is_detached_head returns false,
    /// so fix_detached_head is skipped. After cleanup removes the state files,
    /// HEAD is still detached, and `git pull` fails.
    #[tokio::test]
    async fn test_git_pull_does_not_fail_with_stale_rebase_state_and_detached_head() {
        // Setup: bare repo as remote
        let remote_tmp = tempfile::tempdir().unwrap();
        let remote_path = remote_tmp.path();
        git_cmd(remote_path, &["init", "--bare", "-q", "-b", "main"]);

        // Setup: working repo with remote configured
        let work_tmp = tempfile::tempdir().unwrap();
        let work_repo = work_tmp.path();
        let work_str = work_repo.to_str().unwrap();
        git_cmd(work_repo, &["init", "-q", "-b", "main"]);
        git_cmd(work_repo, &["config", "user.email", "test@example.com"]);
        git_cmd(work_repo, &["config", "user.name", "Test"]);
        std::fs::write(work_repo.join("file.txt"), "line1\n").unwrap();
        git_cmd(work_repo, &["add", "file.txt"]);
        git_cmd(work_repo, &["commit", "-q", "-m", "initial"]);
        git_cmd(work_repo, &["remote", "add", "origin", remote_path.to_str().unwrap()]);
        git_cmd(work_repo, &["push", "-q", "origin", "main"]);
        git_cmd(work_repo, &["branch", "--set-upstream-to=origin/main", "main"]);

        // Detach HEAD by checking out the commit hash directly
        let head_hash = std::process::Command::new("git")
            .current_dir(work_repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        let head_hash = String::from_utf8_lossy(&head_hash.stdout).trim().to_string();
        git_cmd(work_repo, &["checkout", "-q", &head_hash]);

        // Simulate stale rebase state (crashed/interrupted rebase left state files)
        let rebase_merge_dir = work_repo.join(".git/rebase-merge");
        std::fs::create_dir_all(&rebase_merge_dir).unwrap();
        std::fs::write(rebase_merge_dir.join("head-name"), "refs/heads/main\n").unwrap();

        // Call git_pull
        let result = git_pull(work_str.to_string()).await;

        // Assert: no "not currently on a branch" error
        match result {
            Ok(_) => {} // Pull succeeded — detached HEAD was fixed
            Err(e) => {
                let err_lower = e.to_lowercase();
                assert!(
                    !err_lower.contains("not currently on a branch"),
                    "git_pull should not fail with 'not currently on a branch' when stale rebase state is cleaned up. Got error: {}",
                    e
                );
            }
        }
    }
}
