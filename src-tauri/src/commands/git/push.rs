use super::runner::{run_git, run_git_with_env};
use super::branch::{is_rebase_or_merge_in_progress, has_real_conflicts, cleanup_stale_rebase_state, fix_detached_head, get_rebase_branch, resolve_push_target_branch};
use super::askpass::{create_askpass_script, build_askpass_env};
use super::errors::is_auth_error;

/// Push commits to remote
/// Handles detached HEAD state by using HEAD:<branch> format
#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    // Check if we're in a rebase/merge state
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress. Please resolve conflicts first.".to_string());
        }
        // Stale state files - clean up before proceeding
        cleanup_stale_rebase_state(&path);
    }

    // Try normal push first
    let result = run_git(&path, &["push"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let err_str = e.to_lowercase();
            // If detached HEAD, try pushing with HEAD:<branch> format
            if err_str.contains("not currently on a branch") || err_str.contains("detached head") {
                #[cfg(debug_assertions)]
                eprintln!("[INFO] git_push: detached HEAD detected, trying HEAD:<branch> push");
                // Get the branch name from rebase state or HEAD
                if let Some(branch) = get_rebase_branch(&path) {
                    #[cfg(debug_assertions)]
                    eprintln!("[INFO] git_push: pushing HEAD:refs/heads/{}", branch);
                    let push_result = run_git(&path, &["push", "origin", &format!("HEAD:refs/heads/{}", branch)]);
                    match push_result {
                        Ok(_) => return Ok(()),
                        Err(push_err) => return Err(format!("Failed to push: {}", push_err)),
                    }
                } else {
                    return Err("Cannot push: repository is in detached HEAD state and no branch info found".to_string());
                }
            }
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
    // Check if we're in a rebase/merge state
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress. Please resolve conflicts first.".to_string());
        }
        // Stale state files - clean up before proceeding
        cleanup_stale_rebase_state(&path);
    }

    // 创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 通用脚本读环境变量）
    let (askpass_path, _askpass_guard) = create_askpass_script("askpass", &username, &password)?;
    let env_vars = build_askpass_env(&askpass_path, &username, &password);

    let result = run_git_with_env(&path, &["push"], &env_vars);

    // Clean up the askpass script immediately
    let _ = std::fs::remove_file(&askpass_path);

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let err_lower = e.to_lowercase();
            // detached HEAD 时 `git push` 没有上游分支，会报
            // "fatal: You are not currently on a branch"。此时改为
            // `push origin HEAD:refs/heads/<branch>` 显式指定目标分支。
            if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                if let Some(branch) = resolve_push_target_branch(&path) {
                    #[cfg(debug_assertions)]
                    eprintln!("[INFO] git_push_with_credentials: detached HEAD, pushing HEAD:refs/heads/{}", branch);
                    // Recreate askpass script for the retry
                    let (retry_path, _retry_guard) = create_askpass_script("askpass", &username, &password)?;
                    let retry_env = build_askpass_env(&retry_path, &username, &password);
                    let retry = run_git_with_env(
                        &path,
                        &["push", "origin", &format!("HEAD:refs/heads/{}", branch)],
                        &retry_env,
                    );
                    let _ = std::fs::remove_file(&retry_path);
                    return match retry {
                        Ok(_) => Ok(()),
                        Err(retry_err) => Err(format!("Failed to push: {}", retry_err)),
                    };
                }
            }
            Err(format!("Failed to push: {}", e))
        }
    }
}

/// Force push commits to remote (overwrites remote history)
/// 推送前先 commit 未提交的改动，确保本地改动被包含在推送中。
#[tauri::command]
pub async fn git_force_push(path: String) -> Result<(), String> {
    // 修复 detached HEAD（必须在 commit 之前，否则 commit 可能失败）
    fix_detached_head(&path)?;

    // 检查是否有未提交的改动，有则先 commit
    let status_output = run_git(&path, &["status", "--porcelain"])?;
    if !status_output.trim().is_empty() {
        run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;
        let commit_result = run_git(&path, &["commit", "-m", "Force sync"]);
        if let Err(e) = commit_result {
            let err_msg = e.to_lowercase();
            // "nothing to commit" 不是错误，继续推送
            if !err_msg.contains("nothing to commit")
                && !err_msg.contains("working tree clean")
                && !err_msg.contains("no changes added to commit")
            {
                return Err(format!("Failed to commit before force push: {}", e));
            }
        }
    }

    let result = run_git(&path, &["push", "--force"]);
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let err_lower = e.to_lowercase();
            // detached HEAD 时 `git push --force` 没有上游分支，会报
            // "fatal: You are not currently on a branch"。此时改为
            // `push --force origin HEAD:refs/heads/<branch>` 显式指定目标分支。
            if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                if let Some(branch) = resolve_push_target_branch(&path) {
                    #[cfg(debug_assertions)]
                    eprintln!("[INFO] git_force_push: detached HEAD, pushing HEAD:refs/heads/{}", branch);
                    let retry = run_git(
                        &path,
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

/// Force push with provided credentials (username and password/token)
/// 推送前先 commit 未提交的改动，确保本地改动被包含在推送中。
#[tauri::command]
pub async fn git_force_push_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    // 修复 detached HEAD（必须在 commit 之前）
    fix_detached_head(&path)?;

    // 检查是否有未提交的改动，有则先 commit
    let status_output = run_git(&path, &["status", "--porcelain"])?;
    if !status_output.trim().is_empty() {
        run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;
        let commit_result = run_git(&path, &["commit", "-m", "Force sync"]);
        if let Err(e) = commit_result {
            let err_msg = e.to_lowercase();
            if !err_msg.contains("nothing to commit")
                && !err_msg.contains("working tree clean")
                && !err_msg.contains("no changes added to commit")
            {
                return Err(format!("Failed to commit before force push: {}", e));
            }
        }
    }

    // 创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 通用脚本读环境变量）
    let (askpass_path, _askpass_guard) = create_askpass_script("force_push", &username, &password)?;
    let env_vars = build_askpass_env(&askpass_path, &username, &password);

    let result = run_git_with_env(&path, &["push", "--force"], &env_vars);

    let _ = std::fs::remove_file(&askpass_path);

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let err_lower = e.to_lowercase();
            // detached HEAD 时 `git push --force` 没有上游分支，会报
            // "fatal: You are not currently on a branch"。此时改为
            // `push --force origin HEAD:refs/heads/<branch>` 显式指定目标分支。
            if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                if let Some(branch) = resolve_push_target_branch(&path) {
                    #[cfg(debug_assertions)]
                    eprintln!("[INFO] git_force_push_with_credentials: detached HEAD, pushing HEAD:refs/heads/{}", branch);
                    // Recreate askpass script for the retry
                    let (retry_path, _retry_guard) = create_askpass_script("force_push", &username, &password)?;
                    let retry_env = build_askpass_env(&retry_path, &username, &password);
                    let retry = run_git_with_env(
                        &path,
                        &["push", "--force", "origin", &format!("HEAD:refs/heads/{}", branch)],
                        &retry_env,
                    );
                    let _ = std::fs::remove_file(&retry_path);
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
