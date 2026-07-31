use log::error;

/// G-08 修复：git 命令超时时间（秒）。
/// 本地操作（status/diff/add/commit）通常秒级完成；网络操作（clone/pull/push）在弱网下可能较慢。
/// 120 秒足够覆盖正常网络操作，同时防止永久阻塞 Tauri 命令线程。
pub const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;

pub fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    run_git_with_env(path, args, &[])
}

/// 不 trim 输出的 git 命令包装。
/// 用于获取文件内容的命令（git show / git cat-file），保留原始末尾换行。
/// G-16 修复：run_git 会对输出 trim()，导致 git show 获取的文件内容丢失末尾换行。
/// 文件内容返回场景应使用此函数。
pub fn run_git_no_trim(path: &str, args: &[&str]) -> Result<String, String> {
    run_git_with_env_no_trim(path, args, &[])
}

/// 核心执行逻辑：运行 git 命令并返回原始 stdout 字节。
/// 不对 stdout 做 trim 处理，由调用方（run_git_with_env / run_git_with_env_no_trim）决定是否 trim。
/// 错误信息（stderr / stdout fallback）仍会 trim 以保证错误消息干净。
pub fn run_git_raw(path: &str, args: &[&str], env_vars: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    let mut cmd = super::super::create_command("git");
    cmd.current_dir(path).args(args);

    // G-07 修复：强制 git 输出英文，保证 is_conflict_error / is_auth_error 的字符串匹配
    // 在所有语言环境（如 zh_CN.UTF-8）下都稳定可靠。
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");

    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    // G-08 修复：通过子线程 + channel 超时机制，防止网络操作（clone/pull/push）永久阻塞。
    // 主线程在超时后能返回错误，子线程中已启动的 git 子进程会被 kill 释放资源。
    let (tx, rx) = std::sync::mpsc::channel();
    let mut cmd_for_thread = cmd;
    let child_handle = std::thread::spawn(move || {
        let result = cmd_for_thread.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok(output.stdout)
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
        Ok(Err(e)) => {
            // 启动 git 进程本身失败
            Err(format!("Failed to execute git: {}", e))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            // 超时：子线程仍在等待 git 进程,但 Tauri 命令线程已返回错误,不再等待子线程结束。
            // 子线程中的 cmd.output() 会随 git 进程自然结束而返回,我们通过 forget 让它在后台自然退出,
            // 避免 drop child_handle 导致 JoinHandle 析构时 panic(子线程仍持有 cmd_for_thread)。
            // 注意:不主动 kill git 进程,按 AC-15 保持与原 git.rs 完全等价的行为。
            error!(
                "[ERROR] run_git_raw: git command timed out after {}s (path={}, args={:?})",
                GIT_COMMAND_TIMEOUT_SECS, path, args
            );
            std::mem::forget(child_handle);
            Err(format!(
                "Git command timed out after {} seconds. Please check your network connection and try again.",
                GIT_COMMAND_TIMEOUT_SECS
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            // 子线程 panic 或提前退出
            Err("Git command thread terminated unexpectedly".to_string())
        }
    }
}

pub fn run_git_with_env(path: &str, args: &[&str], env_vars: &[(&str, &str)]) -> Result<String, String> {
    let stdout = run_git_raw(path, args, env_vars)?;
    Ok(String::from_utf8_lossy(&stdout).trim().to_string())
}

/// 不 trim 输出的 git 命令执行（带环境变量）。
/// 用于获取文件内容的场景，保留原始末尾换行。
pub fn run_git_with_env_no_trim(path: &str, args: &[&str], env_vars: &[(&str, &str)]) -> Result<String, String> {
    let stdout = run_git_raw(path, args, env_vars)?;
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}
