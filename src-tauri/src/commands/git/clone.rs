use std::path::Path;
use std::process::Stdio;
use std::io::{BufReader, Read};
use tauri::{AppHandle, Emitter, State};
use super::models::{CloneStateInfo, ClonePidState};
use super::askpass::{TempScriptGuard, create_askpass_script};
use crate::i18n;
#[cfg(unix)]
use log::debug;

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
                debug!("[INFO] git_clone_cancel: pid {} no longer exists, skipping kill", pid);
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

    let mut cmd = super::super::create_command("git");
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

    // G-17 修复：在 Unix 上为 git clone 子进程创建新进程组（setsid），
    // 这样 git_clone_cancel 中的 kill(-pid) 只会终止 git 及其子进程
    // （git-remote-https、pack-objects 等），不会误杀 Tauri 主进程组。
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
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
                        while let Some(pos) = pending.find(['\r', '\n']) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_percent_patterns() {
        // Valid percentage patterns — returns the parsed number
        assert_eq!(extract_percent("Receiving objects: 14%"), Some(14));
        assert_eq!(extract_percent("Resolving deltas: 100%"), Some(100));
        assert_eq!(extract_percent("Receiving objects: 0%"), Some(0));
        // A realistic git progress line with a single percentage
        assert_eq!(
            extract_percent("Receiving objects: 14% (2996/21045), 8.90 MiB | 33.00 KiB/s"),
            Some(14)
        );
        // Multiple percentages in one line — returns the LAST one found
        assert_eq!(extract_percent("14% 50% 100%"), Some(100));
        // No percentage — returns None
        assert_eq!(extract_percent("No progress here"), None);
        assert_eq!(extract_percent(""), None);
        // '%' without preceding digits — returns None
        assert_eq!(extract_percent("hello%"), None);
        // '%' at position 0 (no preceding char) — returns None
        assert_eq!(extract_percent("%"), None);
        // Digits not immediately before '%' are not captured
        assert_eq!(extract_percent("50 items done, no percent"), None);
    }
}
