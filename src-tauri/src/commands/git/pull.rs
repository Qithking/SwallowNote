use super::with_repo_lock;
use super::runner::{run_git, run_git_with_env, run_git_blocking};
use super::branch::{should_use_rebase, is_detached_head, fix_detached_head, get_branch, is_rebase_or_merge_in_progress, has_real_conflicts, cleanup_stale_rebase_state, is_diverged_error};
use super::scan::get_remote_url;
use super::askpass::{create_askpass_script, build_askpass_env};
use super::errors::{is_conflict_error, is_auth_error, is_local_changes_overwrite_error, is_divergent_branches_error};
use log::{debug, warn};

/// Pull changes from remote with rebase by default.
/// username/password 同时提供时使用临时 GIT_ASKPASS 脚本提供凭证。
#[tauri::command]
pub async fn git_pull(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // P1#2：run_git 同步阻塞（网络命令最长 120s），移入 blocking 线程池避免卡死 tokio worker
    run_git_blocking(move || {
        // F2 per-repo 互斥：同一仓库的同步类命令串行执行（先克隆锁键，规避借用与 move 冲突）
        let lock_key = path.clone();
        with_repo_lock(&lock_key, || git_pull_impl(path, username, password))
    })
    .await
}

fn git_pull_impl(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
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
        if let Err(e) = fix_detached_head(&path) {
            // 分叉需用户决策，上抛前端弹框
            if is_diverged_error(&e) {
                return Err(e);
            }
            // P1#1 修复：非分叉失败也必须上抛——detached HEAD 未修复时 pull 必然
            // 报 "not currently on a branch"，静默 return Ok 会让前端误报同步成功
            return Err(format!("Failed to fix detached HEAD before pull: {}", e));
        }
    }

    // G-13 修复：尊重用户 git 配置 pull.rebase，决定使用 rebase 还是 merge
    let use_rebase = should_use_rebase(&path);
    let pull_args: Vec<&str> = if use_rebase {
        vec!["pull", "--rebase"]
    } else {
        vec!["pull"]
    };

    // 凭证可选：同时提供时创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 读环境变量）
    let creds = username.as_deref().zip(password.as_deref());
    let mut result = execute_pull(&path, &pull_args, creds);

    // git ≥2.27 分叉自愈：pull.rebase 未设置且本地/远端历史分叉时，裸 `git pull`
    // 拒绝执行（exit 128，"Need to specify how to reconcile divergent branches"）。
    // 按设计约定默认 merge，显式 `pull --no-rebase` 重试一次；若合并产生冲突，
    // 由下方 is_conflict_error 路径上抛 REBASE_CONFLICT 交给冲突面板。
    if result.is_err() && !use_rebase && is_divergent_branches_error(result.as_ref().unwrap_err()) {
        debug!("[INFO] git_pull: divergent branches detected, retrying with explicit merge (--no-rebase)");
        result = execute_pull(&path, &["pull", "--no-rebase"], creds);
    }

    match result {
        Ok(_) => {
            // Fix detached HEAD if it occurred during pull
            // P1#1 修复：pull 已成功，此处为 best-effort 清理，失败不影响结果，
            // 但需留 warn 日志避免静默吞掉（下次同步可能因残留 detached HEAD 失败）
            if let Err(e) = fix_detached_head(&path) {
                warn!("[WARN] git_pull: post-pull fix_detached_head failed ({}), will retry on next sync", e);
            }
            Ok(())
        },
        Err(e) => {
            // 错误判断顺序统一为 auth 先、conflict 后（对偶版本归一）
            if is_auth_error(&e) {
                cleanup_stale_rebase_state(&path);
                Err(format!("AUTH_REQUIRED:{}", e))
            } else if is_local_changes_overwrite_error(&e) {
                // S-26：本地未提交改动会被 merge 覆盖——归类独立错误码，前端
                // 提示"提交或暂存本地改动"（此前降级为通用失败，用户难定位）
                Err(format!("LOCAL_CHANGES_OVERWRITE:{}", e))
            } else if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve.
                // Keep conflict markers in the working tree so the user must resolve them in ConflictResolver.
                // S-21 决策：merge 冲突（pull.rebase=false）也复用 REBASE_CONFLICT 前缀——
                // 前端错误码契约绑定该前缀（GitErrorCode.RebaseConflict），语义偏差无实际影响
                // （两种场景都要求用户经冲突面板解决），改动需同步前端多处，维持现状。
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

/// 执行一次 pull（凭证可选：同时提供时经临时 askpass 脚本提供凭证）。
/// run_git_with_env 返回 stdout 内容，此处只关心成败，映射为 ()。
fn execute_pull(path: &str, args: &[&str], creds: Option<(&str, &str)>) -> Result<(), String> {
    match creds {
        Some((u, p)) => {
            let (askpass_path, _askpass_guard) = create_askpass_script("pull", u, p)?;
            let env_vars = build_askpass_env(&askpass_path, u, p);
            let r = run_git_with_env(path, args, &env_vars).map(|_| ());
            // Clean up the askpass script immediately
            let _ = std::fs::remove_file(&askpass_path);
            r
        }
        None => run_git(path, args).map(|_| ()),
    }
}

/// Force pull from remote (discard local changes and reset to remote)
/// This performs: git fetch + git reset --hard origin/<branch> + git clean -fd
#[tauri::command]
pub async fn git_force_pull(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // P1#2：移入 blocking 线程池（同 git_pull）
    run_git_blocking(move || {
        // F2 per-repo 互斥：同一仓库的同步类命令串行执行（先克隆锁键，规避借用与 move 冲突）
        let lock_key = path.clone();
        with_repo_lock(&lock_key, || git_force_pull_impl(path, username, password))
    })
    .await
}

fn git_force_pull_impl(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    // G-05 修复：区分"无远程配置"和"远程读取失败"
    let remote_url = get_remote_url(&path)?;
    if remote_url.is_none() {
        return Ok(()); // No remote, nothing to pull
    }

    // Fix detached HEAD before proceeding
    // 如果修复失败，后续 get_branch 可能返回 "HEAD" 导致 reset --hard origin/HEAD 失败
    if let Err(e) = fix_detached_head(&path) {
        // 分叉需用户决策，上抛前端弹框
        if is_diverged_error(&e) {
            return Err(e);
        }
        // P1#1 修复：修复失败时 get_branch 可能返回 "HEAD" 导致 reset 失败，
        // 上抛错误而非静默假成功
        return Err(format!("Failed to fix detached HEAD before force pull: {}", e));
    }

    // Get current branch
    let branch = get_branch(&path)?;

    // Fetch from remote（凭证可选：同时提供时创建临时 askpass 脚本）
    let creds = username.as_deref().zip(password.as_deref());
    let fetch_result = match creds {
        Some((u, p)) => {
            let (askpass_path, _askpass_guard) = create_askpass_script("force_pull", u, p)?;
            let env_vars = build_askpass_env(&askpass_path, u, p);
            let r = run_git_with_env(&path, &["fetch", "origin"], &env_vars);
            let _ = std::fs::remove_file(&askpass_path);
            r
        }
        None => run_git(&path, &["fetch", "origin"]),
    };
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
    use super::super::test_utils::{git_cmd, setup_conflict_repo};

    /// 构造双向分叉仓库（双方均有新提交，pull.rebase 未设置）：
    /// bare origin ← work 已推送 base；第二个克隆向远端前进一个提交（模拟另一台设备），
    /// work 本地前进一个提交。复现 git ≥2.27 裸 `git pull` 分叉时 exit 128 的场景。
    fn setup_divergent_branches_repo() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        tempfile::TempDir,
        std::path::PathBuf,
    ) {
        let remote_tmp = tempfile::tempdir().unwrap();
        git_cmd(remote_tmp.path(), &["init", "--bare", "-q", "-b", "main"]);

        let work_tmp = setup_conflict_repo();
        let work_repo = work_tmp.path().to_path_buf();
        git_cmd(&work_repo, &["remote", "add", "origin", remote_tmp.path().to_str().unwrap()]);
        git_cmd(&work_repo, &["push", "-q", "origin", "main"]);
        git_cmd(&work_repo, &["branch", "--set-upstream-to=origin/main", "main"]);

        // 第二个克隆：向远端前进一个提交
        let clone_tmp = tempfile::tempdir().unwrap();
        let clone_repo = clone_tmp.path().join("clone");
        git_cmd(clone_tmp.path(), &["clone", "-q", remote_tmp.path().to_str().unwrap(), clone_repo.to_str().unwrap()]);
        git_cmd(&clone_repo, &["config", "user.email", "other@example.com"]);
        git_cmd(&clone_repo, &["config", "user.name", "Other"]);
        std::fs::write(clone_repo.join("remote_only.txt"), "remote\n").unwrap();
        git_cmd(&clone_repo, &["add", "remote_only.txt"]);
        git_cmd(&clone_repo, &["commit", "-q", "-m", "remote-only"]);
        git_cmd(&clone_repo, &["push", "-q", "origin", "main"]);

        // work 仓库：本地前进一个提交 → 双方分叉
        std::fs::write(work_repo.join("local_only.txt"), "local\n").unwrap();
        git_cmd(&work_repo, &["add", "local_only.txt"]);
        git_cmd(&work_repo, &["commit", "-q", "-m", "local-only"]);

        (remote_tmp, clone_tmp, work_tmp, work_repo)
    }

    /// 分叉且 pull.rebase 未设置（默认 merge）时，git_pull 必须显式按 merge 策略整合，
    /// 不能报 "Failed to pull: ... divergent branches"（git ≥2.27 裸 pull 拒绝分叉）。
    #[tokio::test]
    async fn test_git_pull_recovers_from_divergent_branches() {
        let (_remote, _clone, _work, repo) = setup_divergent_branches_repo();
        let repo_str = repo.to_str().unwrap();

        if let Err(e) = git_pull(repo_str.to_string(), None, None).await {
            panic!("git_pull should recover from divergent branches, got error: {}", e);
        }

        // merge 完成：origin/main 已是本地 main 的祖先（远端提交被整合），且包含远端独有的提交
        let out = std::process::Command::new("git")
            .current_dir(&repo)
            .args(["merge-base", "--is-ancestor", "origin/main", "main"])
            .status()
            .unwrap();
        assert!(
            out.success(),
            "pull must integrate remote commits (origin/main should be ancestor of main)"
        );
        assert!(
            repo.join("remote_only.txt").exists(),
            "merge must bring remote-only commit into working tree"
        );
    }

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
        let result = git_pull(work_str.to_string(), None, None).await;

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
