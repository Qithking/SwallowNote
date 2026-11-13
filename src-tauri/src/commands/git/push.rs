use super::with_repo_lock;
use super::runner::{run_git, run_git_with_env, run_git_blocking};
use super::branch::{is_rebase_or_merge_in_progress, has_real_conflicts, cleanup_stale_rebase_state, fix_detached_head, resolve_push_target_branch, is_diverged_error};
use super::askpass::{create_askpass_script, build_askpass_env};
use super::errors::is_auth_error;
use log::debug;

/// detached HEAD 重试共享 helper（Q9）：
/// `git push` 在 detached HEAD 下没有上游分支，会报
/// "fatal: You are not currently on a branch"。此时解析目标分支并改用
/// `push [--force] origin HEAD:refs/heads/<branch>` 显式重试。
///
/// 返回：
/// - `None`：错误不是 detached HEAD 引起，调用方继续走通用错误映射
/// - `Some(Ok(()))`：重试成功
/// - `Some(Err(..))`：重试失败，或无法解析目标分支
fn retry_push_on_detached_head(
    path: &str,
    force: bool,
    creds: Option<(&str, &str)>,
    original_error: &str,
) -> Option<Result<(), String>> {
    let err_lower = original_error.to_lowercase();
    if !(err_lower.contains("not currently on a branch") || err_lower.contains("detached head")) {
        return None;
    }
    // 从 rebase 状态、HEAD、远程默认分支（origin/HEAD）解析推送目标
    let branch = match resolve_push_target_branch(path) {
        Some(b) => b,
        None => {
            return Some(Err(
                "Cannot push: repository is in detached HEAD state and no branch info found"
                    .to_string(),
            ));
        }
    };
    debug!("[INFO] git push: detached HEAD, retrying with HEAD:refs/heads/{}", branch);
    let head_ref = format!("HEAD:refs/heads/{}", branch);
    let args: Vec<&str> = if force {
        vec!["push", "--force", "origin", &head_ref]
    } else {
        vec!["push", "origin", &head_ref]
    };
    // 有凭证时重建 askpass 脚本（首次调用的脚本已随命令结束被删除）
    let result = if let Some((u, p)) = creds {
        match create_askpass_script("askpass", u, p) {
            Ok((askpass_path, _guard)) => {
                let env_vars = build_askpass_env(&askpass_path, u, p);
                let r = run_git_with_env(path, &args, &env_vars);
                // 用后立即删除临时脚本
                let _ = std::fs::remove_file(&askpass_path);
                r
            }
            Err(e) => Err(e),
        }
    } else {
        run_git(path, &args)
    };
    let label = if force { "force push" } else { "push" };
    Some(match result {
        Ok(_) => Ok(()),
        Err(retry_err) => {
            if is_auth_error(&retry_err) {
                Err(format!("AUTH_REQUIRED:{}", retry_err))
            } else {
                Err(format!("Failed to {}: {}", label, retry_err))
            }
        }
    })
}

/// Push commits to remote.
/// username/password 同时提供时使用临时 GIT_ASKPASS 脚本提供凭证；
/// detached HEAD 时自动改用 HEAD:<branch> 格式重试（见 retry_push_on_detached_head）。
#[tauri::command]
pub async fn git_push(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // P1#2：run_git 同步阻塞（网络命令最长 120s），移入 blocking 线程池避免卡死 tokio worker
    run_git_blocking(move || {
        // F2 per-repo 互斥：同一仓库的同步类命令串行执行（先克隆锁键，规避借用与 move 冲突）
        let lock_key = path.clone();
        with_repo_lock(&lock_key, || git_push_impl(path, username, password))
    })
    .await
}

fn git_push_impl(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // Check if we're in a rebase/merge state
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress. Please resolve conflicts first.".to_string());
        }
        // Stale state files - clean up before proceeding
        cleanup_stale_rebase_state(&path);
    }

    // 凭证可选：同时提供时创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 读环境变量）
    let creds = username.as_deref().zip(password.as_deref());
    let result = match creds {
        Some((u, p)) => {
            let (askpass_path, _askpass_guard) = create_askpass_script("askpass", u, p)?;
            let env_vars = build_askpass_env(&askpass_path, u, p);
            let r = run_git_with_env(&path, &["push"], &env_vars);
            // Clean up the askpass script immediately
            let _ = std::fs::remove_file(&askpass_path);
            r
        }
        None => run_git(&path, &["push"]),
    };

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            // If detached HEAD, try pushing with HEAD:<branch> format
            if let Some(retry_result) = retry_push_on_detached_head(&path, false, creds, &e) {
                return retry_result;
            }
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to push: {}", e))
            }
        }
    }
}

/// Force push commits to remote (overwrites remote history)
/// 推送前先 commit 未提交的改动，确保本地改动被包含在推送中。
#[tauri::command]
pub async fn git_force_push(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // P1#2：移入 blocking 线程池（同 git_push）
    run_git_blocking(move || {
        // F2 per-repo 互斥：同一仓库的同步类命令串行执行（先克隆锁键，规避借用与 move 冲突）
        let lock_key = path.clone();
        with_repo_lock(&lock_key, || git_force_push_impl(path, username, password))
    })
    .await
}

fn git_force_push_impl(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // 修复 detached HEAD（必须在 commit 之前，否则 commit 可能失败）
    if let Err(e) = fix_detached_head(&path) {
        // 分叉需用户决策，上抛前端弹框
        if is_diverged_error(&e) {
            return Err(e);
        }
        // P1#1 修复：修复失败时继续执行会把提交挂在 detached HEAD 上（切回分支即丢失），
        // 必须上抛错误而非静默假成功
        return Err(format!("Failed to fix detached HEAD before force push: {}", e));
    }

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

    // 凭证可选：同时提供时创建临时 askpass 脚本
    let creds = username.as_deref().zip(password.as_deref());
    let result = match creds {
        Some((u, p)) => {
            let (askpass_path, _askpass_guard) = create_askpass_script("force_push", u, p)?;
            let env_vars = build_askpass_env(&askpass_path, u, p);
            let r = run_git_with_env(&path, &["push", "--force"], &env_vars);
            let _ = std::fs::remove_file(&askpass_path);
            r
        }
        None => run_git(&path, &["push", "--force"]),
    };

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            // detached HEAD 时显式指定目标分支重试
            if let Some(retry_result) = retry_push_on_detached_head(&path, true, creds, &e) {
                return retry_result;
            }
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else {
                Err(format!("Failed to force push: {}", e))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_utils::git_cmd;

    /// 构建"工作仓库 + 裸远程"并让 HEAD 处于 detached 状态。
    /// 返回 (工作仓库 TempDir, 远程 TempDir, 工作仓库路径, detached 提交消息)。
    /// 注意：调用方必须持有两个 TempDir，避免目录被提前删除。
    /// 关键点：`remote set-head --auto` 创建 refs/remotes/origin/HEAD 符号引用，
    /// 使 resolve_push_target_branch 在 detached HEAD 下能解析出目标分支。
    fn setup_detached_repo() -> (tempfile::TempDir, tempfile::TempDir, String, String) {
        // 裸仓库作为远程
        let remote_tmp = tempfile::tempdir().unwrap();
        let remote_path = remote_tmp.path();
        git_cmd(remote_path, &["init", "--bare", "-q", "-b", "main"]);

        // 工作仓库并推送 main 到远程
        let work_tmp = tempfile::tempdir().unwrap();
        let work_repo = work_tmp.path();
        git_cmd(work_repo, &["init", "-q", "-b", "main"]);
        git_cmd(work_repo, &["config", "user.email", "test@example.com"]);
        git_cmd(work_repo, &["config", "user.name", "Test"]);
        std::fs::write(work_repo.join("file.txt"), "line1\n").unwrap();
        git_cmd(work_repo, &["add", "file.txt"]);
        git_cmd(work_repo, &["commit", "-q", "-m", "initial"]);
        git_cmd(work_repo, &["remote", "add", "origin", remote_path.to_str().unwrap()]);
        git_cmd(work_repo, &["push", "-q", "origin", "main"]);
        git_cmd(work_repo, &["branch", "--set-upstream-to=origin/main", "main"]);
        // 创建 origin/HEAD 符号引用，供 detached HEAD 时解析目标分支
        git_cmd(work_repo, &["remote", "set-head", "origin", "--auto"]);

        // 检出提交哈希进入 detached HEAD，并在其上追加新提交
        let out = std::process::Command::new("git")
            .current_dir(work_repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        let head_hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
        git_cmd(work_repo, &["checkout", "-q", &head_hash]);
        let commit_msg = "detached commit";
        std::fs::write(work_repo.join("file.txt"), "line1\nline2\n").unwrap();
        git_cmd(work_repo, &["add", "file.txt"]);
        git_cmd(work_repo, &["commit", "-q", "-m", commit_msg]);

        let work_path = work_repo.to_str().unwrap().to_string();
        (work_tmp, remote_tmp, work_path, commit_msg.to_string())
    }

    /// Q9 单测：detached HEAD 下 push 失败后，共享 helper 应解析目标分支
    /// 并用 HEAD:refs/heads/<branch> 显式重试成功，新提交到达远程。
    #[tokio::test]
    async fn test_git_push_retries_with_head_ref_on_detached_head() {
        let (_work_tmp, remote_tmp, work_path, commit_msg) = setup_detached_repo();
        let result = git_push(work_path, None, None).await;
        assert!(result.is_ok(), "detached HEAD push should succeed via HEAD:<branch> retry, got: {:?}",
            result.err());

        // 断言远程 main 包含 detached 提交上的新提交
        let out = std::process::Command::new("git")
            .current_dir(remote_tmp.path())
            .args(["log", "main", "--oneline"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&out.stdout);
        assert!(
            log.contains(&commit_msg),
            "remote main should contain the detached commit. log: {}",
            log
        );
    }

    /// 非 detached 错误不触发重试：helper 返回 None，由调用方走通用错误映射。
    #[tokio::test]
    async fn test_retry_helper_ignores_non_detached_errors() {
        let (work_tmp, _remote_tmp, work_path, _msg) = setup_detached_repo();
        let _ = work_tmp; // 持有 TempDir 防止目录被提前删除
        let result = retry_push_on_detached_head(&work_path, false, None, "Failed to fetch: network error");
        assert!(result.is_none(), "non-detached error should return None, got: {:?}", result);
    }
}
