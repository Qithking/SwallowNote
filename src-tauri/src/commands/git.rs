use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::io::{BufReader, Read};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use crate::i18n;

/// Information about the currently running git clone process.
/// Stored in Tauri managed state so it survives frontend page refreshes.
#[derive(Default, Serialize, Clone)]
pub struct CloneStateInfo {
    pub pid: Option<u32>,
    pub url: String,
    pub local_path: String,
}

/// Shared state to track the currently running git clone process.
/// This allows the frontend to cancel an in-progress clone and to query
/// whether a clone is still running after a page refresh.
pub type ClonePidState = Arc<Mutex<CloneStateInfo>>;

pub fn new_clone_pid_state() -> ClonePidState {
    Arc::new(Mutex::new(CloneStateInfo::default()))
}

/// Cancel an in-progress git clone by killing the child process.
#[tauri::command]
pub fn git_clone_cancel(pid_state: State<'_, ClonePidState>) -> Result<bool, String> {
    let pid = {
        let mut guard = pid_state.lock().map_err(|e| e.to_string())?;
        let pid = guard.pid.take();
        // Clear url/local_path as well so a stale status query doesn't
        // report a running clone after cancellation.
        guard.url.clear();
        guard.local_path.clear();
        pid
    };
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            // 先用信号 0 检查进程是否仍存在，避免 pid 复用导致误杀其他进程。
            // kill(pid, 0) 返回 0 表示进程存在；返回 -1 且 errno == ESRCH 表示进程不存在。
            let check = unsafe { libc::kill(pid as i32, 0) };
            if check == 0 {
                // 进程存在，发送 SIGTERM 到整个进程组（负 PID），
                // 同时终止 git 派生的子进程（git-remote-https、pack-objects 等）。
                let result = unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
                if result != 0 {
                    // 回退：仅 kill 进程本身
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                }
                Ok(true)
            } else {
                // 进程已不存在（ESRCH），跳过 kill，避免 pid 复用误杀
                eprintln!("[INFO] git_clone_cancel: pid {} no longer exists, skipping kill", pid);
                Ok(false)
            }
        }
        #[cfg(not(unix))]
        {
            // On Windows, use taskkill to terminate the process tree
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            Ok(true)
        }
    } else {
        Ok(false)
    }
}

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
#[allow(dead_code)]
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
    // 分支获取失败时返回空字符串，前端可据此判断获取失败（区别于 "unknown" 等真实分支名）
    let branch = get_branch(&path).unwrap_or_else(|_| "".to_string());
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
    run_git(&path, &["diff", "--", &file_path])
}

/// Stage all changes and commit
#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<(), String> {
    // Auto-fix detached HEAD before committing
    fix_detached_head(&path)?;

    // Stage all changes
    run_git(&path, &["add", "-A"]).map_err(|e| format!("Failed to stage: {}", e))?;

    // Commit
    match run_git(&path, &["commit", "-m", &message]) {
        Ok(_) => {}
        Err(e) => {
            let err_lower = e.to_lowercase();
            if !err_lower.contains("nothing to commit")
                && !err_lower.contains("working tree clean")
                && !err_lower.contains("no changes added to commit") {
                return Err(format!("Failed to commit: {}", e));
            }
        }
    }

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

    // 检查 rebase/merge 状态：有真实冲突则报错；仅 stale 状态则清理后继续。永不自动 resolve/continue。
    if is_rebase_or_merge_in_progress(&path) {
        if has_real_conflicts(&path) {
            // Real conflicts exist - require explicit user resolution
            return Err("REBASE_CONFLICT:Already in a conflict state. Please resolve conflicts first.".to_string());
        } else {
            // Stale rebase/merge state: clean up before proceeding with the pull.
            cleanup_stale_rebase_state(&path);
        }
    }

    let result = run_git(&path, &["pull", "--rebase"]);
    match result {
        Ok(_) => {
            // Fix detached HEAD if it occurred during pull
            let _ = fix_detached_head(&path);
            Ok(())
        },
        Err(e) => {
            if is_auth_error(&e) {
                Err(format!("AUTH_REQUIRED:{}", e))
            } else if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve
                // Restore conflicted files to local versions (remove conflict markers from working tree)
                restore_conflicted_files_to_local(&path);
                Err(format!("REBASE_CONFLICT:{}", e))
            } else {
                // Non-conflict error (network, zlib, etc.): clean up stale rebase state
                // that pull --rebase may have left behind
                cleanup_stale_rebase_state(&path);
                Err(format!("Failed to pull: {}", e))
            }
        }
    }
}

/// RAII 守卫：Drop 时删除临时 askpass 脚本，防止明文凭证残留磁盘。
/// 拥有 PathBuf 所有权，可在创建作用域之外（如 clone 流程的 if-let 块）存活至函数末尾，
/// 确保所有 return / `?` 提前返回路径都执行清理。
struct TempScriptGuard(std::path::PathBuf);

impl Drop for TempScriptGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// 清理临时目录中残留的 askpass 脚本。
/// 应用启动时调用，删除因崩溃等异常退出而残留的 `swallownote_*_askpass_*.sh`（Windows 为 `.bat`）文件。
/// 删除时忽略错误，避免因单个文件锁定等问题中断整个清理流程。
pub fn cleanup_stale_askpass_scripts() {
    let temp_dir = std::env::temp_dir();
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        // 匹配 swallownote_ 前缀且包含 _askpass_ 的脚本文件
        if !file_name.starts_with("swallownote_") || !file_name.contains("_askpass_") {
            continue;
        }
        // 平台相关的扩展名过滤
        #[cfg(target_os = "windows")]
        {
            if !file_name.ends_with(".bat") && !file_name.ends_with(".sh") {
                continue;
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if !file_name.ends_with(".sh") {
                continue;
            }
        }
        // 删除残留脚本，忽略错误
        let _ = std::fs::remove_file(&path);
    }
}

/// 创建临时 askpass 脚本并返回路径与 RAII 守卫。
/// - Unix: 脚本内嵌凭证，权限 0600，RAII 自动清理。
/// - Windows: 脚本不含凭证，从环境变量 GIT_USERNAME/GIT_PASSWORD 读取，RAII 自动清理。
///   即使脚本残留也不会泄露凭证。
fn create_askpass_script(
    prefix: &str,
    username: &str,
    password: &str,
) -> Result<(String, TempScriptGuard), String> {
    let temp_dir = std::env::temp_dir();
    let unique_id = uuid::Uuid::new_v4().to_string();

    #[cfg(not(target_os = "windows"))]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.sh", prefix, unique_id));
    #[cfg(target_os = "windows")]
    let askpass_script = temp_dir.join(format!("swallownote_{}_askpass_{}.bat", prefix, unique_id));

    #[cfg(not(target_os = "windows"))]
    let script_content = format!(
        "#!/bin/sh\nif echo \"$1\" | grep -qi 'username'; then\n  echo '{}'\nelse\n  echo '{}'\nfi",
        username.replace('\'', "'\\''"),
        password.replace('\'', "'\\''")
    );

    // Windows 下脚本不含凭证，从环境变量读取，残留也不泄露凭证
    #[cfg(target_os = "windows")]
    let script_content = "@echo off\nif echo %1 | findstr /i \"username\" >nul 2>&1 (\n  echo %GIT_USERNAME%\n) else (\n  echo %GIT_PASSWORD%\n)".to_string();

    std::fs::write(&askpass_script, &script_content)
        .map_err(|e| format!("Failed to create askpass script: {}", e))?;
    let guard = TempScriptGuard(askpass_script.clone());

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

    Ok((askpass_script.to_string_lossy().to_string(), guard))
}

/// 构建 askpass 相关环境变量。
/// Windows 下额外传入 GIT_USERNAME/GIT_PASSWORD，供通用 askpass 脚本读取。
fn build_askpass_env<'a>(
    askpass_path: &'a str,
    username: &'a str,
    password: &'a str,
) -> Vec<(&'a str, &'a str)> {
    // vars 仅在 Windows 下被 push，非 Windows 平台编译器会告警 unused_mut，故加 allow。
    #[allow(unused_mut)]
    let mut vars: Vec<(&'a str, &'a str)> = vec![
        ("GIT_ASKPASS", askpass_path),
        ("GIT_TERMINAL_PROMPT", "0"),
    ];
    #[cfg(target_os = "windows")]
    {
        vars.push(("GIT_USERNAME", username));
        vars.push(("GIT_PASSWORD", password));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (username, password);
    }
    vars
}

/// Pull changes from remote with provided credentials
#[tauri::command]
pub async fn git_pull_with_credentials(path: String, username: String, password: String) -> Result<(), String> {
    // 创建临时 askpass 脚本（Unix 内嵌凭证 0600；Windows 通用脚本读环境变量）
    let (askpass_path, _askpass_guard) = create_askpass_script("pull", &username, &password)?;
    let env_vars = build_askpass_env(&askpass_path, &username, &password);

    let result = run_git_with_env(&path, &["pull", "--rebase"], &env_vars);

    // Clean up the askpass script immediately
    let _ = std::fs::remove_file(&askpass_path);

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            if is_conflict_error(&e) {
                // Do NOT abort the rebase - preserve the conflict state for the UI to resolve
                // Restore conflicted files to local versions (remove conflict markers from working tree)
                restore_conflicted_files_to_local(&path);
                Err(format!("REBASE_CONFLICT:{}", e))
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
                eprintln!("[INFO] git_push: detached HEAD detected, trying HEAD:<branch> push");
                // Get the branch name from rebase state or HEAD
                if let Some(branch) = get_rebase_branch(&path) {
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

/// Force pull from remote (discard local changes and reset to remote)
/// This performs: git fetch + git reset --hard origin/<branch> + git clean -fd
#[tauri::command]
pub async fn git_force_pull(path: String) -> Result<(), String> {
    // Check if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_err() {
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
    // Check if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_err() {
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

/// Commit and push in one command
#[tauri::command]
pub async fn git_commit_and_push(path: String, message: String) -> Result<(), String> {
    // Auto-fix detached HEAD before committing
    fix_detached_head(&path)?;

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
                    if line.as_bytes().len() < 3 { return false; }
                    let entry_path = line[3..].trim().trim_matches('"');
                    submodule_paths.iter().any(|sp| sp == entry_path)
                })
            })
            .unwrap_or(false);

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
            // "nothing to commit" is not an error - continue to push in case there are unpushed commits
        }
    }

    // Push - only if remote exists
    let remote_url = get_remote_url(&path);
    if remote_url.is_ok() {
        // Check if already in a rebase/merge state before pulling
        if is_rebase_or_merge_in_progress(&path) {
            if has_real_conflicts(&path) {
                return Err("REBASE_CONFLICT:Cannot push while rebase/merge is in progress".to_string());
            }
            // Stale state files - clean up before proceeding
            cleanup_stale_rebase_state(&path);
        }

        // Pull --rebase first to integrate remote changes before pushing
        // This avoids non-fast-forward push failures
        let pull_result = run_git(&path, &["pull", "--rebase"]);
        if let Err(e) = pull_result {
            // If it's a conflict, do NOT abort - preserve conflict state for UI
            if is_conflict_error(&e) {
                // Restore conflicted files to local versions (remove conflict markers from working tree)
                restore_conflicted_files_to_local(&path);
                return Err(format!("REBASE_CONFLICT:{}", e));
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
        
        // Fix detached HEAD that rebase may have caused
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
            Ok(_) => {}
            Err(e) => {
                let err_lower = e.to_lowercase();
                // detached HEAD fallback
                if err_lower.contains("not currently on a branch") || err_lower.contains("detached head") {
                    if let Some(branch) = resolve_push_target_branch(&path) {
                        eprintln!("[INFO] git_commit_and_push: detached HEAD, pushing HEAD:refs/heads/{}", branch);
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

    Ok(())
}

fn commit_submodules(path: &str, message: &str) -> Result<(), String> {
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

    // Skip auto-commit if repo is in a rebase/merge conflict state
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        return Ok(()); // Skip silently during conflict resolution
    }

    // Auto-fix detached HEAD by switching back to the correct branch
    fix_detached_head(repo_path)?;

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

    let repo_path = current.to_str().ok_or(i18n::t("backend.git.invalidRepoPath"))?;
    let relative_path = Path::new(&file_path)
        .strip_prefix(current)
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.invalidRelativePath"), e))?;
    let relative_path_str = relative_path.to_str().ok_or(i18n::t("backend.git.invalidPathEncoding"))?;

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
            format!("{}: {}", i18n::t("backend.git.fetchFailed"), e)
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

    // 检测本地是否有未提交改动：git diff --quiet 退出码 0=无改动，1=有改动，其他（如 128 路径不存在）=错误。
    // 有改动时拒绝 checkout，避免静默覆盖用户本地修改。
    let diff_status = {
        let mut cmd = super::create_command("git");
        cmd.current_dir(repo_path)
            .args(["diff", "--quiet", "--", relative_path_str])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
    };
    match diff_status {
        Ok(status) if status.success() => { /* 无本地改动，可安全 checkout */ }
        // 仅退出码 1 视为"有改动"，拒绝覆盖（保留 LOCAL_CHANGES: 前缀供前端识别）
        Ok(status) if status.code() == Some(1) => {
            return Err(format!("LOCAL_CHANGES: {}", relative_path_str));
        }
        // 其他非零退出码（如 128 路径不存在）视为错误，避免误判为"有改动"
        Ok(status) => {
            let code = status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| i18n::t("backend.git.terminatedBySignal"));
            return Err(format!("{}: git diff exit code {}", i18n::t("backend.git.checkLocalChangesFailed"), code));
        }
        Err(e) => {
            return Err(format!("{}: {}", i18n::t("backend.git.checkLocalChangesFailed"), e));
        }
    }

    // Also checkout the file from remote to update the working tree
    run_git(repo_path, &["checkout", &format!("origin/{}", branch), "--", relative_path_str])
        .map_err(|e| format!("{}: {}", i18n::t("backend.git.checkoutFileFailed"), e))?;

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
                    eprintln!("[INFO] git_force_upload_file: detached HEAD, pushing HEAD:refs/heads/{}", branch);
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

/// 解析"应该把当前 HEAD 推送到哪个远程分支"。
/// 优先级：rebase 状态记录的分支 > 当前分支（已处理 detached HEAD）> 远程默认分支。
fn resolve_push_target_branch(repo_path: &str) -> Option<String> {
    if let Some(branch) = get_rebase_branch(repo_path) {
        if !branch.is_empty() && branch != "HEAD" {
            return Some(branch);
        }
    }
    if let Ok(branch) = get_branch(repo_path) {
        let trimmed = branch.trim();
        if !trimmed.is_empty() && trimmed != "HEAD" {
            return Some(trimmed.to_string());
        }
    }
    if let Ok(sym) = run_git(repo_path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let trimmed = sym.trim().trim_start_matches("origin/").to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    None
}

/// 获取当前分支名。
/// 注意：在 detached HEAD 状态下，`git rev-parse --abbrev-ref HEAD` 会返回字面量 "HEAD"，
/// 后续若拼成 `origin/HEAD:path` 会因 `origin/HEAD` 引用不存在而失败（Windows 上常见）。
/// 因此在 detached HEAD 时按以下顺序回退到真实分支名：
///   1. `refs/remotes/origin/HEAD` 符号引用（远程默认分支）
///   2. `init.defaultBranch` 配置
///   3. 兜底返回字符串 "HEAD"（保持向后兼容）
fn get_branch(path: &str) -> Result<String, String> {
    let raw = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if raw.trim() != "HEAD" {
        return Ok(raw);
    }
    // detached HEAD：尝试解析远程默认分支
    if let Ok(sym) = run_git(path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        // symbolic-ref 返回形如 "origin/main"，需剥离 "origin/" 前缀，
        // 否则后续 git_pull_file_latest 会拼出 "origin/origin/main:path" 必然失败。
        let trimmed = sym.trim().trim_start_matches("origin/");
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if let Ok(default_branch) = run_git(path, &["config", "--get", "init.defaultBranch"]) {
        let trimmed = default_branch.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Ok("HEAD".to_string())
}

/// Get the branch name that is being rebased, from the rebase state files
/// This works even when HEAD is detached during a rebase
fn get_rebase_branch(repo_path: &str) -> Option<String> {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");

    // For rebase-merge: read head-name file
    if rebase_merge.exists() {
        let head_name_path = rebase_merge.join("head-name");
        if let Ok(content) = std::fs::read_to_string(&head_name_path) {
            let branch = content.trim().strip_prefix("refs/heads/").unwrap_or(content.trim());
            if !branch.is_empty() && branch != "HEAD" {
                return Some(branch.to_string());
            }
        }
    }

    // For rebase-apply: read head-name file
    if rebase_apply.exists() {
        let head_name_path = rebase_apply.join("head-name");
        if let Ok(content) = std::fs::read_to_string(&head_name_path) {
            let branch = content.trim().strip_prefix("refs/heads/").unwrap_or(content.trim());
            if !branch.is_empty() && branch != "HEAD" {
                return Some(branch.to_string());
            }
        }
    }

    // Fallback: try reading ORIG_HEAD and checking if it matches a branch
    if let Ok(orig_head) = run_git(repo_path, &["rev-parse", "ORIG_HEAD"]) {
        if let Ok(branches) = run_git(repo_path, &["branch", "--format=%(refname:short)=%(objectname)"]) {
            for line in branches.lines() {
                let parts: Vec<&str> = line.splitn(2, '=').collect();
                if parts.len() == 2 && parts[1].trim() == orig_head.trim() {
                    return Some(parts[0].trim().to_string());
                }
            }
        }
    }

    None
}

/// Simple check if a rebase or merge is currently in progress
fn is_rebase_or_merge_in_progress(repo_path: &str) -> bool {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    rebase_merge.exists() || rebase_apply.exists() || merge_head.exists()
}

/// Check if the repository has REAL merge conflicts (not just stale state files).
/// Returns true only if there are actual unmerged files in the index or working tree.
/// This should be used instead of is_rebase_or_merge_in_progress() when deciding
/// whether to trigger the conflict resolution UI, to avoid false positives from
/// stale rebase/merge state files left behind by interrupted operations.
fn has_real_conflicts(repo_path: &str) -> bool {
    // Method 1: Check for unmerged files via diff-filter=U
    let diff_check = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false);
    if diff_check {
        return true;
    }

    // Method 2: Check for unmerged entries in the index via ls-files --unmerged
    let ls_check = run_git(repo_path, &["ls-files", "--unmerged"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false);
    if ls_check {
        return true;
    }

    // Method 3: Check porcelain status for conflict indicators (UU, AA, DU, UD, DD)
    if let Ok(status_output) = run_git(repo_path, &["status", "--porcelain"]) {
        for line in status_output.lines() {
            if line.len() >= 4 {
                let xy = &line[0..2];
                if xy.contains("U") || xy == "DD" || xy == "AA" {
                    return true;
                }
            }
        }
    }

    false
}

/// Clean up stale rebase/merge state files (when state files exist but no real conflicts).
/// This happens when an operation (pull --rebase, etc.) was interrupted (network error, crash)
/// but left behind .git/rebase-merge or .git/MERGE_HEAD files without actual unmerged files.
fn cleanup_stale_rebase_state(repo_path: &str) {
    eprintln!("[INFO] Cleaning up stale rebase/merge state in {}", repo_path);

    // 检查是否为交互式 rebase：rebase-merge/done 文件存在且非空说明用户正在进行交互式 rebase，
    // 不应自动 abort，以免丢失用户尚未完成的 rebase 进度。
    let rebase_merge_done = Path::new(&repo_path).join(".git/rebase-merge/done");
    if rebase_merge_done.exists() {
        if let Ok(content) = std::fs::read_to_string(&rebase_merge_done) {
            if !content.trim().is_empty() {
                eprintln!("[INFO] cleanup_stale_rebase_state: interactive rebase in progress (done file non-empty), skipping abort in {}", repo_path);
                return;
            }
        }
    }

    // 存在真实冲突文件时不 abort，避免丢失未解决的冲突状态
    if has_real_conflicts(repo_path) {
        eprintln!("[INFO] cleanup_stale_rebase_state: real conflicts exist, skipping abort in {}", repo_path);
        return;
    }

    let _ = run_git(repo_path, &["rebase", "--abort"]);
    let _ = run_git(repo_path, &["merge", "--abort"]);
}

/// Helper function to get conflict content for a specific side.
/// Handles the rebase ours/theirs swap correctly.
fn get_conflict_content(repo_path: &str, rel_path: &str, side: &str) -> Result<String, String> {
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let is_rebasing = rebase_merge.exists() || rebase_apply.exists();

    if side == "local" {
        if is_rebasing {
            // During rebase: REBASE_HEAD = our local commit, :3: = theirs = our local
            if let Ok(output) = run_git(repo_path, &["show", &format!("REBASE_HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        } else {
            // During merge: HEAD = our local branch, :2: = ours = our local
            if let Ok(output) = run_git(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        }
        Err(format!("Failed to get local content for {}", rel_path))
    } else if side == "remote" {
        if is_rebasing {
            // During rebase: HEAD = upstream/remote, :2: = ours = upstream/remote
            if let Ok(output) = run_git(repo_path, &["show", &format!("HEAD:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            if let Ok(output) = run_git(repo_path, &["show", &format!(":2:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
        } else {
            // During merge: :3: = theirs = remote, MERGE_HEAD = remote
            if let Ok(output) = run_git(repo_path, &["show", &format!(":3:{}", rel_path)]) {
                if !output.is_empty() { return Ok(output); }
            }
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                if let Ok(output) = run_git(repo_path, &["show", &format!("MERGE_HEAD:{}", rel_path)]) {
                    if !output.is_empty() { return Ok(output); }
                }
            }
        }
        Err(format!("Failed to get remote content for {}", rel_path))
    } else {
        Err(format!("Invalid side: {}", side))
    }
}

// rebase 冲突后恢复工作树文件到本地版本（去除冲突标记）。注意 rebase 中 --theirs 才是本地。
fn restore_conflicted_files_to_local(repo_path: &str) {
    eprintln!("[INFO] Restoring conflicted files to local versions in {}", repo_path);
    
    // Get all unmerged (conflicted) files
    if let Ok(output) = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"]) {
        for rel_path in output.lines() {
            let rel_path = rel_path.trim();
            if rel_path.is_empty() {
                continue;
            }
            // During rebase, --theirs = our local version (commits being rebased)
            // This removes conflict markers while keeping the rebase state intact
            let checkout_result = run_git(repo_path, &["checkout", "--theirs", "--", rel_path]);
            if checkout_result.is_ok() {
                eprintln!("[INFO] Restored conflicted file to local version: {}", rel_path);
            } else {
                // checkout --theirs 失败时用 git show 获取本地内容写入；仍失败则保持原样。
                eprintln!("[WARN] checkout --theirs failed for '{}', trying git show fallback", rel_path);
                let local_content = get_conflict_content(repo_path, rel_path, "local");
                match local_content {
                    Ok(content) => {
                        let abs_path = Path::new(repo_path).join(rel_path);
                        if let Err(e) = std::fs::write(&abs_path, &content) {
                            eprintln!("[ERROR] Failed to write local content to '{}': {}", abs_path.display(), e);
                        } else {
                            eprintln!("[INFO] Restored conflicted file via git show fallback: {}", rel_path);
                        }
                    }
                    Err(e) => {
                        // If even git show fails, the file truly doesn't have a local version
                        // (e.g., local deleted the file). Leave the working tree as-is.
                        eprintln!("[WARN] Could not get local content for '{}': {}. Leaving working tree as-is.", rel_path, e);
                    }
                }
            }
        }
    }
}

/// Fix detached HEAD state by switching back to the correct branch
/// This handles the case where a rebase completed but left the repo in detached HEAD
/// Only fixes if there's no active rebase/merge in progress
/// 返回 Err 表示检测到 detached HEAD 但切换分支失败；返回 Ok 表示无需修复或修复成功。
fn fix_detached_head(repo_path: &str) -> Result<(), String> {
    // Don't interfere with active rebase/merge
    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    if rebase_merge.exists() || rebase_apply.exists() || merge_head.exists() {
        return Ok(());
    }

    // Check if we're in detached HEAD state
    let branch = match run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(b) => b,
        Err(_) => return Ok(()),
    };

    if branch != "HEAD" {
        return Ok(()); // Not detached
    }

    eprintln!("[INFO] fix_detached_head: detected detached HEAD in {}", repo_path);

    // Try to find the correct branch to switch to
    if let Some(target_branch) = get_rebase_branch(repo_path) {
        eprintln!("[INFO] fix_detached_head: switching to branch {}", target_branch);
        run_git(repo_path, &["checkout", &target_branch])
            .map_err(|e| format!("Failed to fix detached HEAD: {}", e))?;
        eprintln!("[INFO] fix_detached_head: successfully switched to {}", target_branch);
        return Ok(());
    }

    // Fallback: try checking out the most recent local branch
    // Use git branch to find branches that point to current HEAD
    if let Ok(head_hash) = run_git(repo_path, &["rev-parse", "HEAD"]) {
        if let Ok(branches) = run_git(repo_path, &["branch", "--format=%(refname:short)=%(objectname)"]) {
            for line in branches.lines() {
                let parts: Vec<&str> = line.splitn(2, '=').collect();
                if parts.len() == 2 && parts[1].trim() == head_hash.trim() {
                    let target = parts[0].trim();
                    eprintln!("[INFO] fix_detached_head: found matching branch {}, switching", target);
                    match run_git(repo_path, &["checkout", target]) {
                        Ok(_) => {
                            eprintln!("[INFO] fix_detached_head: successfully switched to {}", target);
                            return Ok(());
                        }
                        Err(e) => {
                            eprintln!("[WARN] fix_detached_head: failed to switch to {}: {}", target, e);
                            continue;
                        }
                    }
                }
            }
        }
    }
    // 未找到匹配分支，不视为错误（仓库可能本就应在 detached HEAD 状态）
    eprintln!("[WARN] fix_detached_head: could not find a branch matching current HEAD in {}", repo_path);
    Ok(())
}

/// Scan directory for all git repositories
#[tauri::command]
pub async fn scan_git_repos(root_path: String) -> Result<Vec<GitRepositoryInfo>, String> {
    // 扫描涉及大量同步文件 I/O 与 git 子进程调用，放入 spawn_blocking 避免阻塞 tokio 工作线程。
    tokio::task::spawn_blocking(move || {
        let root = Path::new(&root_path);
        if !root.exists() {
            return Err(format!("Path does not exist: {}", root_path));
        }

        let mut repos = Vec::new();
        scan_dir_recursive(root, &mut repos, None)?;
        Ok(repos)
    })
    .await
    .map_err(|e| format!("Scan task panicked: {}", e))?
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

/// Parse .gitmodules file to extract submodule paths.
/// 使用 `git config -f` 解析，比手工分行匹配更健壮：可容忍 `path=value`、
/// `path = value`、`path\t=\tvalue` 等多种写法以及注释、引号等差异。
fn parse_gitmodules(gitmodules_path: &Path) -> Result<Vec<String>, String> {
    // .gitmodules 的父目录（仓库根）作为 git 命令的工作目录
    let dir = gitmodules_path
        .parent()
        .and_then(|p| p.to_str())
        .ok_or("Invalid .gitmodules path")?;
    let gitmodules_str = gitmodules_path
        .to_str()
        .ok_or("Invalid .gitmodules path encoding")?;
    // --get-regexp 匹配 key（形如 submodule.<name>.path），输出 "<key> <value>"
    match run_git(dir, &["config", "-f", gitmodules_str, "--get-regexp", r"submodule\..*\.path"]) {
        Ok(output) => {
            let mut paths = Vec::new();
            for line in output.lines() {
                // 输出格式：<key> <value>，例如 "submodule.foo.path modules/foo"
                // 取第一个空格之后的部分作为子模块路径
                if let Some(idx) = line.find(' ') {
                    let p = line[idx..].trim();
                    if !p.is_empty() {
                        paths.push(p.to_string());
                    }
                }
            }
            Ok(paths)
        }
        Err(_) => {
            // git config --get-regexp 在无匹配时退出码为 1（非真实错误），返回空列表。
            Ok(Vec::new())
        }
    }
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
        eprintln!("[INFO] git_get_conflict_files: no rebase/merge state found and no conflicts detected in {}", repo_path);
        return Ok(vec![]);
    }

    // If we have a state file but found NO actual conflict files via standard methods,
    // the rebase/merge may be in a special state (e.g. interactive rebase with empty todo).
    // Return empty list - the frontend should keep showing the conflict tab until user resolves it.
    if files.is_empty() {
        eprintln!("[INFO] git_get_conflict_files: rebase/merge state exists but no unmerged files found in {}", repo_path);
    }

    eprintln!("[INFO] git_get_conflict_files: found {} conflict files in {}", files.len(), repo_path);
    Ok(files)
}

// 获取冲突文件的本地版本。rebase 用 stage 3/REBASE_HEAD，merge 用 stage 2/HEAD。
#[tauri::command]
pub async fn git_get_conflict_local_content(repo_path: String, file_path: String) -> Result<String, String> {
    eprintln!("[INFO] git_get_conflict_local_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts
    if rel_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    eprintln!("[INFO] git_get_conflict_local_content: normalized rel_path='{}'", rel_path);

    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let is_rebasing = rebase_merge.exists() || rebase_apply.exists();

    if is_rebasing {
        // During rebase: REBASE_HEAD = our local commit being replayed
        let rebase_head_ref = format!("REBASE_HEAD:{}", rel_path);
        match run_git(&repo_path, &["show", &rebase_head_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_local_content: OK from REBASE_HEAD:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: REBASE_HEAD:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_local_content: REBASE_HEAD:{} failed: {}", rel_path, e),
        }

        // During rebase: stage 3 = theirs = our local version
        let stage3_ref = format!(":3:{}", rel_path);
        match run_git(&repo_path, &["show", &stage3_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_local_content: OK from :3:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: :3:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_local_content: :3:{} failed: {}", rel_path, e),
        }

        // cat-file with stage 3
        if let Ok(ls_output) = run_git(&repo_path, &["ls-files", "-s", "--", &rel_path]) {
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 && parts[1] == "3" {
                    let hash = parts[2];
                    if let Ok(content) = run_git(&repo_path, &["cat-file", "-p", hash]) {
                        if !content.is_empty() {
                            return Ok(content);
                        }
                    }
                }
            }
        }
    } else {
        // During merge: stage 2 = ours = our local version
        let stage2_ref = format!(":2:{}", rel_path);
        match run_git(&repo_path, &["show", &stage2_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_local_content: OK from :2:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: :2:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_local_content: :2:{} failed: {}", rel_path, e),
        }

        // HEAD: = our local branch during merge
        let head_ref = format!("HEAD:{}", rel_path);
        match run_git(&repo_path, &["show", &head_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_local_content: OK from HEAD:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_local_content: HEAD:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_local_content: HEAD:{} failed: {}", rel_path, e),
        }

        // cat-file with stage 2
        if let Ok(ls_output) = run_git(&repo_path, &["ls-files", "-s", "--", &rel_path]) {
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 && parts[1] == "2" {
                    let hash = parts[2];
                    if let Ok(content) = run_git(&repo_path, &["cat-file", "-p", hash]) {
                        if !content.is_empty() {
                            return Ok(content);
                        }
                    }
                }
            }
        }
    }

    // Fallback: if all git strategies failed, the file likely doesn't exist on this side
    // (e.g., delete/modify conflict where one side deleted the file).
    // Return empty string instead of reading the working tree, which would return
    // incorrect content (local content shown as "remote" or conflict markers as "local").
    eprintln!("[WARN] git_get_conflict_local_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
    Ok(String::new())
}

// 获取冲突文件的远程版本。rebase 用 stage 2/HEAD，merge 用 stage 3/MERGE_HEAD。
#[tauri::command]
pub async fn git_get_conflict_remote_content(repo_path: String, file_path: String) -> Result<String, String> {
    eprintln!("[INFO] git_get_conflict_remote_content: repo_path={}, file_path={}", repo_path, file_path);

    let rel_path = file_path.trim().trim_start_matches('/').trim_matches('"').to_string();
    // Validate: reject path traversal attempts
    if rel_path.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path));
    }
    eprintln!("[INFO] git_get_conflict_remote_content: normalized rel_path='{}'", rel_path);

    let rebase_merge = Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = Path::new(&repo_path).join(".git/rebase-apply");
    let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
    let is_rebasing = rebase_merge.exists() || rebase_apply.exists();

    if is_rebasing {
        // During rebase: HEAD = upstream/remote (the branch being rebased onto)
        let head_ref = format!("HEAD:{}", rel_path);
        match run_git(&repo_path, &["show", &head_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_remote_content: OK from HEAD:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: HEAD:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: HEAD:{} failed: {}", rel_path, e),
        }

        // During rebase: stage 2 = ours = upstream/remote version
        let stage2_ref = format!(":2:{}", rel_path);
        match run_git(&repo_path, &["show", &stage2_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_remote_content: OK from :2:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: :2:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: :2:{} failed: {}", rel_path, e),
        }

        // cat-file with stage 2
        if let Ok(ls_output) = run_git(&repo_path, &["ls-files", "-s", "--", &rel_path]) {
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 && parts[1] == "2" {
                    let hash = parts[2];
                    if let Ok(content) = run_git(&repo_path, &["cat-file", "-p", hash]) {
                        if !content.is_empty() {
                            return Ok(content);
                        }
                    }
                }
            }
        }
    } else {
        // During merge: stage 3 = theirs = remote version
        let stage3_ref = format!(":3:{}", rel_path);
        match run_git(&repo_path, &["show", &stage3_ref]) {
            Ok(output) if !output.is_empty() => {
                eprintln!("[INFO] git_get_conflict_remote_content: OK from :3:{} (len={})", rel_path, output.len());
                return Ok(output);
            }
            Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: :3:{} returned empty", rel_path),
            Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: :3:{} failed: {}", rel_path, e),
        }

        // MERGE_HEAD: = remote during merge
        if merge_head.exists() {
            let merge_head_ref = format!("MERGE_HEAD:{}", rel_path);
            match run_git(&repo_path, &["show", &merge_head_ref]) {
                Ok(output) if !output.is_empty() => {
                    eprintln!("[INFO] git_get_conflict_remote_content: OK from MERGE_HEAD:{} (len={})", rel_path, output.len());
                    return Ok(output);
                }
                Ok(_) => eprintln!("[WARN] git_get_conflict_remote_content: MERGE_HEAD:{} returned empty", rel_path),
                Err(e) => eprintln!("[WARN] git_get_conflict_remote_content: MERGE_HEAD:{} failed: {}", rel_path, e),
            }
        }

        // cat-file with stage 3
        if let Ok(ls_output) = run_git(&repo_path, &["ls-files", "-s", "--", &rel_path]) {
            for line in ls_output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 && parts[1] == "3" {
                    let hash = parts[2];
                    if let Ok(content) = run_git(&repo_path, &["cat-file", "-p", hash]) {
                        if !content.is_empty() {
                            return Ok(content);
                        }
                    }
                }
            }
        }
    }

    // Fallback: if all git strategies failed, the file likely doesn't exist on this side
    // (e.g., modify/delete conflict where the remote side deleted the file).
    // Return empty string instead of reading the working tree, which would return
    // incorrect content (local content shown as "remote").
    eprintln!("[WARN] git_get_conflict_remote_content: all git strategies failed for '{}' in {}, returning empty (file may not exist on this side)", rel_path, repo_path);
    Ok(String::new())
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
    let rel_path_str = rel_path.to_str().ok_or("Invalid path encoding")?;

    // Validate: reject path traversal attempts
    if rel_path_str.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path_str));
    }

    eprintln!("[INFO] git_resolve_conflict_file: repo_path={}, file_path={}, side={}", repo_path, file_path, side);

    // If side is "current", the user has already edited and saved the file via
    // git_save_conflict_file_content, so we just need to stage it.
    // If side is "local" or "remote", we overwrite with the chosen side's content.
    if side != "current" {
        let content = get_conflict_content(&repo_path, rel_path_str, &side)?;
        // 写入目标必须基于 repo_path + 相对路径，避免前端传入的 file_path
        // 指向仓库外（路径穿越）。
        let target_path = Path::new(&repo_path).join(rel_path_str);
        std::fs::write(&target_path, &content)
            .map_err(|e| format!("Failed to write file: {}", e))?;
    }

    // Stage the resolved file
    run_git(&repo_path, &["add", rel_path_str])?;

    check_and_continue_rebase(&repo_path)
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
            } else {
                // Rebase continued successfully - fix detached HEAD if needed
                let _ = fix_detached_head(repo_path);
            }
        } else {
            let merge_head = Path::new(&repo_path).join(".git/MERGE_HEAD");
            if merge_head.exists() {
                run_git(repo_path, &["commit", "--no-edit"])?;
                // Fix detached HEAD after merge commit
                let _ = fix_detached_head(repo_path);
            }
        }
    }
    Ok(())
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
    let rel_path_str = rel_path.to_str().ok_or("Invalid path encoding")?;

    // Validate: reject path traversal attempts
    if rel_path_str.contains("..") {
        return Err(format!("Invalid file path: path traversal detected in '{}'", rel_path_str));
    }

    eprintln!("[INFO] git_save_conflict_file_content: repo_path={}, file_path={}", repo_path, file_path);

    // Write the edited content back to the file
    // Do NOT run `git add` here — that would prematurely resolve the conflict.
    // Staging is done in `git_resolve_conflict_file` when the user explicitly resolves.
    // 写入目标基于 repo_path + 相对路径，避免前端传入的 file_path 指向仓库外（路径穿越）。
    let target_path = Path::new(&repo_path).join(rel_path_str);
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

/// Unescape git path output that may contain octal escape sequences like \346\210\221
/// Git uses these for non-ASCII filenames when core.quotepath is true (the default).
/// For example: "\346\210\221\347\232\204\345\267\245\344\275\234/test.md" -> "我的工作/test.md"
/// UTF-8 characters are encoded as multiple consecutive \NNN sequences (one per byte).
fn unescape_git_path(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut i = 0;
    let bytes = path.as_bytes();

    while i < bytes.len() {
        if bytes[i] == b'\\' {
            // 先处理 \\ 和 \" 反转义（必须在八进制转义之前判断，避免 \\\NNN 被误解析）
            if i + 1 < bytes.len() {
                if bytes[i + 1] == b'\\' {
                    // \\ → \
                    result.push('\\');
                    i += 2;
                    continue;
                }
                if bytes[i + 1] == b'"' {
                    // \" → "
                    result.push('"');
                    i += 2;
                    continue;
                }
            }
            // Try to parse octal escape: \NNN
            if i + 3 < bytes.len() {
                if let (Some(d1), Some(d2), Some(d3)) = (
                    char::from(bytes[i + 1]).to_digit(8),
                    char::from(bytes[i + 2]).to_digit(8),
                    char::from(bytes[i + 3]).to_digit(8),
                ) {
                    let byte_val = (d1 << 6 | d2 << 3 | d3) as u8;
                    // Collect consecutive escaped bytes to form valid UTF-8
                    let mut byte_buf = vec![byte_val];
                    let mut j = i + 4;
                    while j + 3 < bytes.len() && bytes[j] == b'\\' {
                        if let (Some(nd1), Some(nd2), Some(nd3)) = (
                            char::from(bytes[j + 1]).to_digit(8),
                            char::from(bytes[j + 2]).to_digit(8),
                            char::from(bytes[j + 3]).to_digit(8),
                        ) {
                            let next_byte = (nd1 << 6 | nd2 << 3 | nd3) as u8;
                            byte_buf.push(next_byte);
                            j += 4;
                        } else {
                            break;
                        }
                    }
                    // Decode the collected bytes as UTF-8
                    let decoded = String::from_utf8_lossy(&byte_buf);
                    result.push_str(&decoded);
                    i = j;
                    continue;
                }
            }
        }
        // Regular character
        if let Some(c) = path[i..].chars().next() {
            result.push(c);
            i += c.len_utf8();
        } else {
            i += 1;
        }
    }

    result
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
pub async fn git_clone(
    app: AppHandle,
    pid_state: State<'_, ClonePidState>,
    url: String,
    local_path: String,
) -> Result<String, String> {
    do_git_clone(&app, &pid_state, &url, &local_path, None, None).await
}

/// Clone a private git repository with credentials
#[tauri::command]
pub async fn git_clone_with_credentials(
    app: AppHandle,
    pid_state: State<'_, ClonePidState>,
    url: String,
    local_path: String,
    username: String,
    password: String,
) -> Result<String, String> {
    do_git_clone(&app, &pid_state, &url, &local_path, Some(&username), Some(&password)).await
}

/// Query the current git clone status.
/// Returns the clone info (pid/url/local_path) so the frontend can
/// recover state after a page refresh while a clone is still running.
#[tauri::command]
pub fn git_clone_status(pid_state: State<'_, ClonePidState>) -> Result<CloneStateInfo, String> {
    let guard = pid_state.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// Extract the last percentage value (e.g. "14%") from a git progress line.
/// Returns `None` if no percentage is found.
fn extract_percent(s: &str) -> Option<u32> {
    let bytes = s.as_bytes();
    let mut result = None;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i > 0 {
            let mut start = i;
            while start > 0 && bytes[start - 1].is_ascii_digit() {
                start -= 1;
            }
            if start < i {
                if let Ok(n) = s[start..i].parse::<u32>() {
                    result = Some(n);
                }
            }
        }
        i += 1;
    }
    result
}

async fn do_git_clone(
    app: &AppHandle,
    pid_state: &ClonePidState,
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

    // 并发 clone 防护：检查是否已有 clone 进行中，并在同一锁范围内设置 url/local_path，
    // 避免 check-then-set 竞态导致两个 clone 同时进入。
    // Store the URL and local_path in shared state *before* emitting the
    // started event, so a frontend page refresh can recover them via
    // `git_clone_status`.
    {
        let mut guard = pid_state.lock().map_err(|e| e.to_string())?;
        if guard.pid.is_some() {
            return Err("已有克隆任务正在进行中，请等待完成或取消后再试".to_string());
        }
        guard.url = url.to_string();
        guard.local_path = local_path.to_string();
    }

    // Send start event (include url + local_path so the frontend can
    // restore form fields even after a page refresh).
    let _ = app.emit("git-clone-progress", serde_json::json!({
        "status": "started",
        "message": i18n::t("backend.git.cloning"),
        "url": url,
        "local_path": local_path
    }));

    // If credentials provided, set up GIT_ASKPASS
    // RAII 守卫提前声明在外层作用域，使其存活至函数末尾：覆盖 spawn / wait 等所有失败路径。
    let mut _askpass_guard: Option<TempScriptGuard> = None;
    let askpass_script_path = if let (Some(username), Some(password)) = (username, password) {
        let (path, guard) = create_askpass_script("clone", username, password)?;
        _askpass_guard = Some(guard);
        Some(path)
    } else {
        None
    };

    let mut cmd = super::create_command("git");
    cmd.args(["clone", "--progress", url, local_path])
        // stdout is set to null: if piped but not consumed, the OS pipe buffer
        // (typically 64KB) fills up and causes git to block on write, making
        // the clone extremely slow or hanging indefinitely.
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    // Prevent git from prompting for credentials interactively (would hang in non-TTY)
    cmd.env("GIT_TERMINAL_PROMPT", "0");

    if let Some(ref askpass_path) = askpass_script_path {
        cmd.env("GIT_ASKPASS", askpass_path);
        // Windows 下通过环境变量传递凭证，供通用 askpass 脚本读取
        #[cfg(target_os = "windows")]
        {
            if let (Some(u), Some(p)) = (username, password) {
                cmd.env("GIT_USERNAME", u);
                cmd.env("GIT_PASSWORD", p);
            }
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to execute git clone: {}", e))?;

    // Store the child PID so the frontend can cancel the clone.
    let pid = child.id();
    {
        let mut guard = pid_state.lock().map_err(|e| e.to_string())?;
        guard.pid = Some(pid);
    }

    // Read stderr for progress in a separate thread to avoid blocking the async runtime.
    let stderr_handle = if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        Some(std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buf = [0u8; 4096];
            let mut pending = String::new();
            let mut progress_buffer = String::new();
            let mut last_emit_time = std::time::Instant::now();
            let mut last_percent: Option<u32> = None;
            const EMIT_INTERVAL_MS: u64 = 200;
            const BUFFER_MAX_SIZE: usize = 2000;

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        pending.push_str(&String::from_utf8_lossy(&buf[..n]));

                        // Split on \r or \n to capture individual progress updates.
                        // git uses \r for in-place progress updates (e.g.
                        // "Receiving objects:  14% (2996/21045), 8.90 MiB | 33.00 KiB/s")
                        // and \n for line-terminated messages.
                        // reader.lines() only splits on \n, so all \r-separated
                        // intermediate updates would be merged into one long line
                        // and the user would never see intermediate percentages.
                        while let Some(pos) = pending.find(|c| c == '\r' || c == '\n') {
                            let segment = pending[..pos].trim().to_string();
                            let delimiter_len = if pending[pos..].starts_with("\r\n") { 2 } else { 1 };
                            pending = pending[pos + delimiter_len..].to_string();

                            if segment.is_empty() {
                                continue;
                            }
                            progress_buffer.push_str(&segment);
                            progress_buffer.push('\n');

                            if let Some(pct) = extract_percent(&segment) {
                                last_percent = Some(pct);
                            }
                        }

                        if last_emit_time.elapsed().as_millis() >= EMIT_INTERVAL_MS as u128
                            || progress_buffer.len() > BUFFER_MAX_SIZE
                        {
                            let _ = app_clone.emit("git-clone-progress", serde_json::json!({
                                "status": "progress",
                                "message": progress_buffer.clone(),
                                "percent": last_percent
                            }));
                            progress_buffer.clear();
                            last_emit_time = std::time::Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }

            // Process any remaining pending data after EOF
            let segment = pending.trim();
            if !segment.is_empty() {
                progress_buffer.push_str(segment);
                progress_buffer.push('\n');
                if let Some(pct) = extract_percent(segment) {
                    last_percent = Some(pct);
                }
            }

            if !progress_buffer.is_empty() {
                let _ = app_clone.emit("git-clone-progress", serde_json::json!({
                    "status": "progress",
                    "message": progress_buffer,
                    "percent": last_percent
                }));
            }
        }))
    } else {
        None
    };

    // child.wait() is blocking and can last minutes for large repos.
    // Wrap it in spawn_blocking to avoid blocking the Tauri async runtime.
    let local_path_owned = local_path.to_string();
    let status = {
        tokio::task::spawn_blocking(move || {
            let status = child
                .wait()
                .map_err(|e| format!("Failed to wait for git clone: {}", e))?;
            if let Some(handle) = stderr_handle {
                let _ = handle.join();
            }
            Ok::<std::process::ExitStatus, String>(status)
        })
        .await
        .map_err(|e| format!("Clone task panicked: {}", e))?
    }?;

    // Clear the clone state — clone is no longer running.
    {
        let mut guard = pid_state.lock().map_err(|e| e.to_string())?;
        *guard = CloneStateInfo::default();
    }

    // Clean up askpass script
    if let Some(ref askpass_path) = askpass_script_path {
        let _ = std::fs::remove_file(askpass_path);
    }

    if status.success() {
        let _ = app.emit("git-clone-progress", serde_json::json!({
            "status": "completed",
            "message": i18n::t("backend.git.cloneCompleted")
        }));
        Ok(local_path_owned.replace('\\', "/"))
    } else {
        // Clean up partial clone directory on failure/cancel
        let _ = std::fs::remove_dir_all(&local_path_owned);
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

// ===================== Word Diff =====================

/// A single diff part returned by the word-level diff command.
/// Each part represents either unchanged text, text only in the old version,
/// or text only in the new version.
#[derive(Serialize, Deserialize, Clone)]
pub struct WordDiffPart {
    /// The text content of this diff part
    pub value: String,
    /// True if this text exists only in the old version (removed)
    pub removed: bool,
    /// True if this text exists only in the new version (added)
    pub added: bool,
}

/// Result of a word-level diff comparison between two texts.
/// Contains separate arrays for each side so the frontend can
/// independently render decorations on the left (remote) and right (local) panes.
#[derive(Serialize, Deserialize, Clone)]
pub struct WordDiffResult {
    /// Diff parts for the old (remote/left) side
    pub old_parts: Vec<WordDiffPart>,
    /// Diff parts for the new (local/right) side
    pub new_parts: Vec<WordDiffPart>,
}

/// Compute word-level diff between two text strings using the `similar` crate.
/// This performs a word-granularity diff (similar to `diffWords` in jsdiff),
/// then splits the result into separate arrays for the old and new sides.
///
/// Frontend usage:
/// - Left pane (remote/old): iterate `old_parts`, highlight parts where `removed == true`
/// - Right pane (local/new): iterate `new_parts`, highlight parts where `added == true`
#[tauri::command]
pub fn compute_word_diff(old_text: String, new_text: String) -> Result<WordDiffResult, String> {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_words(&old_text, &new_text);

    let mut old_parts: Vec<WordDiffPart> = Vec::new();
    let mut new_parts: Vec<WordDiffPart> = Vec::new();

    for change in diff.iter_all_changes() {
        // Use to_string_lossy() instead of to_string() — the Display impl of Change
        // auto-appends '\n' when the value doesn't end with a newline (for unified diff
        // output). This would corrupt the content and cause wrong position tracking in
        // the frontend. to_string_lossy() returns the raw value without the extra '\n'.
        let value = change.to_string_lossy().into_owned();
        match change.tag() {
            ChangeTag::Delete => {
                old_parts.push(WordDiffPart {
                    value,
                    removed: true,
                    added: false,
                });
            }
            ChangeTag::Insert => {
                new_parts.push(WordDiffPart {
                    value,
                    removed: false,
                    added: true,
                });
            }
            ChangeTag::Equal => {
                let part = WordDiffPart {
                    value,
                    removed: false,
                    added: false,
                };
                old_parts.push(part.clone());
                new_parts.push(part);
            }
        }
    }

    Ok(WordDiffResult {
        old_parts,
        new_parts,
    })
}

// ──────────────────────────────────────────────
// Conflict Repo Record Commands
// ──────────────────────────────────────────────

/// Get all conflict repo records from the database
#[tauri::command]
pub fn get_conflict_repo_records(db: tauri::State<'_, crate::db::Database>) -> Result<Vec<crate::db::conflict_repo::ConflictRepoRecord>, String> {
    crate::db::conflict_repo::get_all_conflict_repos(&db).map_err(|e| e.to_string())
}

/// Remove a conflict repo record (called when all conflicts in a repo are resolved)
#[tauri::command]
pub fn remove_conflict_repo_record(db: tauri::State<'_, crate::db::Database>, repo_path: String) -> Result<(), String> {
    crate::db::conflict_repo::remove_conflict_repo(&db, &repo_path).map_err(|e| e.to_string())
}

/// Sync conflict repo records: update the database with current conflict state
/// and return the final list. Called by the auto-sync task after pulling.
#[tauri::command]
pub async fn sync_conflict_repo_records(
    db: tauri::State<'_, crate::db::Database>,
    conflict_repos: Vec<(String, String, i64)>, // (repo_path, repo_name, file_count)
) -> Result<Vec<crate::db::conflict_repo::ConflictRepoRecord>, String> {
    crate::db::conflict_repo::sync_conflict_repos(&db, &conflict_repos).map_err(|e| e.to_string())
}

/// Check if a specific repo has conflicts and upsert the record.
/// Returns the conflict file count (0 means no conflicts, record will be removed).
#[tauri::command]
pub async fn check_and_update_conflict_repo(
    db: tauri::State<'_, crate::db::Database>,
    repo_path: String,
    repo_name: String,
) -> Result<i64, String> {
    // Check for actual conflict files
    let files = git_get_conflict_files(repo_path.clone()).await?;

    if files.is_empty() {
        // No conflicts — remove the record
        crate::db::conflict_repo::remove_conflict_repo(&db, &repo_path).map_err(|e| e.to_string())?;
        Ok(0)
    } else {
        // Has conflicts — upsert the record
        let count = files.len() as i64;
        crate::db::conflict_repo::upsert_conflict_repo(&db, &repo_path, &repo_name, count).map_err(|e| e.to_string())?;
        Ok(count)
    }
}

/// 前端可调用的清理残留 askpass 脚本命令
#[tauri::command]
pub fn cleanup_askpass_scripts() {
    cleanup_stale_askpass_scripts();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compute_word_diff_test(old_text: &str, new_text: &str) -> WordDiffResult {
        compute_word_diff(old_text.to_string(), new_text.to_string()).unwrap()
    }

    #[test]
    fn test_identical_text() {
        let result = compute_word_diff_test("hello world", "hello world");
        
        // old_parts should concatenate to old_text
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        
        assert_eq!(old_concatenated, "hello world", "old_parts should concatenate to old_text");
        assert_eq!(new_concatenated, "hello world", "new_parts should concatenate to new_text");
        
        // No parts should be marked as removed or added
        assert!(result.old_parts.iter().all(|p| !p.removed && !p.added), "No parts should be marked as changed for identical text");
        assert!(result.new_parts.iter().all(|p| !p.removed && !p.added), "No parts should be marked as changed for identical text");
    }

    #[test]
    fn test_different_text() {
        let result = compute_word_diff_test("hello world", "hello earth");
        
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        
        assert_eq!(old_concatenated, "hello world", "old_parts should concatenate to old_text");
        assert_eq!(new_concatenated, "hello earth", "new_parts should concatenate to new_text");
    }

    #[test]
    fn test_identical_multiline() {
        let text = "line1\nline2\nline3";
        let result = compute_word_diff_test(text, text);
        
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        
        assert_eq!(old_concatenated, text);
        assert_eq!(new_concatenated, text);
        
        // No parts should be marked as changed
        assert!(result.old_parts.iter().all(|p| !p.removed && !p.added));
        assert!(result.new_parts.iter().all(|p| !p.removed && !p.added));
    }

    #[test]
    fn test_different_multiline() {
        let result = compute_word_diff_test("line1\nline2\nline3", "line1\nmodified\nline3");
        
        let old_concatenated: String = result.old_parts.iter().map(|p| p.value.as_str()).collect();
        let new_concatenated: String = result.new_parts.iter().map(|p| p.value.as_str()).collect();
        
        assert_eq!(old_concatenated, "line1\nline2\nline3");
        assert_eq!(new_concatenated, "line1\nmodified\nline3");
        
        // Should have some removed parts in old and added parts in new
        assert!(result.old_parts.iter().any(|p| p.removed), "old should have removed parts");
        assert!(result.new_parts.iter().any(|p| p.added), "new should have added parts");
    }

    // ===== 纯函数单元测试 =====

    #[test]
    fn test_is_conflict_error_conflict_keywords() {
        assert!(is_conflict_error("CONFLICT (content): Merge conflict in file.txt"));
        assert!(is_conflict_error("error: could not apply abc123"));
        assert!(is_conflict_error("Auto-merging file.rs\nCONFLICT (content): Merge conflict"));
        assert!(is_conflict_error("Please resolve them and commit the result"));
        assert!(is_conflict_error("Fix conflicts and then commit the result"));
        assert!(is_conflict_error("After resolving the conflicts, run git rebase --continue"));
        assert!(is_conflict_error("Failed to merge in the changes"));
        assert!(is_conflict_error("Pull is not possible because you have unmerged files"));
    }

    #[test]
    fn test_is_conflict_error_non_conflict() {
        assert!(!is_conflict_error("Everything up-to-date"));
        assert!(!is_conflict_error("Successfully rebased"));
        assert!(!is_conflict_error("authentication failed"));
        assert!(!is_conflict_error("fatal: not a git repository"));
        assert!(!is_conflict_error(""));
    }

    #[test]
    fn test_is_conflict_error_rebase_uncommitted() {
        // "cannot rebase" + "uncommitted changes" 的组合才算冲突
        assert!(is_conflict_error("cannot rebase: you have uncommitted changes"));
        assert!(!is_conflict_error("cannot rebase onto main branch"));
        assert!(!is_conflict_error("uncommitted changes detected"));
    }

    #[test]
    fn test_is_auth_error_auth_keywords() {
        assert!(is_auth_error("Authentication failed for repo"));
        assert!(is_auth_error("fatal: could not read Username for 'https://github.com'"));
        assert!(is_auth_error("fatal: could not read Password for 'https://github.com'"));
        assert!(is_auth_error("Permission denied (publickey)"));
        assert!(is_auth_error("Permission denied (keyboard-interactive)"));
        assert!(is_auth_error("Access denied"));
        assert!(is_auth_error("fatal: could not read from remote repository"));
        assert!(is_auth_error("HTTP 403 Forbidden"));
        assert!(is_auth_error("Invalid username or password"));
        assert!(is_auth_error("Logon failed"));
        assert!(is_auth_error("Authentication required but no credential provided"));
    }

    #[test]
    fn test_is_auth_error_non_auth() {
        assert!(!is_auth_error("Everything up-to-date"));
        assert!(!is_auth_error("CONFLICT (content): Merge conflict"));
        assert!(!is_auth_error(""));
        assert!(!is_auth_error("fatal: not a git repository"));
    }

    #[test]
    fn test_is_auth_error_unable_to_access_with_403() {
        // "fatal: unable to access" + 403 才算认证错误
        assert!(is_auth_error("fatal: unable to access 'https://github.com/repo': The requested URL returned error: 403"));
        assert!(is_auth_error("fatal: unable to access: 401 Unauthorized"));
        assert!(is_auth_error("fatal: unable to access: authentication required"));
        assert!(is_auth_error("fatal: unable to access: credential helper error"));
        // 无 403/401/auth/credential 的 unable to access 不算认证错误
        assert!(!is_auth_error("fatal: unable to access: Connection timed out"));
    }

    #[test]
    fn test_unescape_git_path_plain() {
        // 普通路径不做转义处理
        assert_eq!(unescape_git_path("src/main.rs"), "src/main.rs");
        assert_eq!(unescape_git_path("path/to/file.txt"), "path/to/file.txt");
    }

    #[test]
    fn test_unescape_git_path_octal_utf8() {
        // 中文路径 \346\210\221 = "我" (3 字节 UTF-8)
        let escaped = "\\346\\210\\221.md";
        assert_eq!(unescape_git_path(escaped), "我.md");
    }

    #[test]
    fn test_unescape_git_path_backslash() {
        // \\ → \
        assert_eq!(unescape_git_path("path\\\\to\\\\file"), "path\\to\\file");
    }

    #[test]
    fn test_unescape_git_path_escaped_quote() {
        // \" → "
        let escaped = "\\\"quoted\\\".md";
        assert_eq!(unescape_git_path(escaped), "\"quoted\".md");
    }

    #[test]
    fn test_unescape_git_path_mixed() {
        // 混合转义：反斜杠 + 八进制 UTF-8
        let escaped = "path\\\\\\346\\210\\221.txt";
        assert_eq!(unescape_git_path(escaped), "path\\我.txt");
    }

    #[test]
    fn test_unescape_git_path_quoted_path() {
        // git quotepath 输出形如 "\346\210\221.md"，首尾引号由调用方 trim，
        // unescape_git_path 只负责转义还原
        let escaped = "\\346\\210\\221\\347\\232\\204\\347\\254\\224\\350\\256\\260.md";
        assert_eq!(unescape_git_path(escaped), "我的笔记.md");
    }

    #[test]
    fn test_unescape_git_path_trailing_backslash() {
        // 末尾单独的 \ 无后续字符，原样保留
        assert_eq!(unescape_git_path("path\\"), "path\\");
    }

    #[test]
    fn test_unescape_git_path_incomplete_octal() {
        // \NN 不够 3 位时不做八进制转义，原样保留
        assert_eq!(unescape_git_path("\\34"), "\\34");
    }
}
