use log::{error, warn};
use std::io::Read;
use std::process::{Child, Output, Stdio};
use std::sync::{Arc, Mutex};

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
    // 手动拆解 output() 内部行为：spawn 后由两个后台线程持续读取 stdout/stderr
    // （避免管道缓冲区填满导致 git 写入阻塞），随后轮询 try_wait 等待退出。
    // Child 以 Arc<Mutex> 共享给主线程：超时后主线程主动 kill 卡死的 git 进程释放资源。
    let (tx, rx) = std::sync::mpsc::channel::<std::io::Result<Output>>();
    let (child_tx, child_rx) = std::sync::mpsc::channel::<Arc<Mutex<Child>>>();
    let mut cmd_for_thread = cmd;
    let child_handle = std::thread::spawn(move || {
        // 与 output() 内部行为对齐：stdin 关闭、stdout/stderr 用管道捕获。
        // spawn() 默认 stdio 是 inherit，不显式设置会导致 stdout.take() 为 None、输出恒为空。
        cmd_for_thread
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = match cmd_for_thread.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(e));
                return;
            }
        };
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let stdout_reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = stdout_pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });
        let stderr_reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = stderr_pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });
        let shared = Arc::new(Mutex::new(child));
        let _ = child_tx.send(Arc::clone(&shared));
        // 轮询 try_wait 而非持锁 wait()：锁只被瞬间持有，超时分支的 kill 不会被阻塞
        let status_result = loop {
            match shared.lock().unwrap().try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(e) => break Err(e),
            }
        };
        let stdout = stdout_reader.join().unwrap_or_default();
        let stderr = stderr_reader.join().unwrap_or_default();
        let _ = tx.send(status_result.map(|status| Output { status, stdout, stderr }));
    });

    match rx.recv_timeout(std::time::Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok(output.stdout)
            } else {
                // 附加 exit code 方便诊断（如 [exit 128]），上层匹配均为 contains，前缀不影响
                let exit_code = output.status.code().unwrap_or(-1);
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    // 如果 stderr 为空，尝试从 stdout 获取错误信息
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !stdout.is_empty() {
                        Err(format!("[exit {}] {}", exit_code, stdout))
                    } else {
                        Err(format!("[exit {}] Git command failed with no output", exit_code))
                    }
                } else {
                    Err(format!("[exit {}] {}", exit_code, stderr))
                }
            }
        }
        Ok(Err(e)) => {
            // 启动 git 进程本身失败
            Err(format!("Failed to execute git: {}", e))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            // 超时：主动 kill git 子进程释放资源（子线程读管道收到 EOF、try_wait 返回后自然结束）。
            // child_rx 中没有共享句柄有两种情况：
            // - 尚未 spawn 成功（进程不存在），无需 kill；
            // - 极小概率已 spawn 成功但尚未 send（亚毫秒窗口恰好撞上超时），此时不 kill，
            //   子线程会持有 Child 轮询直到进程自然退出，warn 记录供排查。
            error!(
                "[ERROR] run_git_raw: git command timed out after {}s (path={}, args={:?})",
                GIT_COMMAND_TIMEOUT_SECS, path, args
            );
            match child_rx.try_recv() {
                Ok(child) => {
                    if let Ok(mut c) = child.lock() {
                        let _ = c.kill();
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    warn!(
                        "run_git_raw: timeout hit before child handle was shared; \
                         git process may keep running until it exits on its own \
                         (path={}, args={:?})",
                        path, args
                    );
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    // 子线程已结束（spawn 失败或 panic），无进程可 kill
                }
            }
            // 不等待子线程结束，JoinHandle 通过 forget 丢弃
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
