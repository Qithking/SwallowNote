//! Plugin backend invocation: 长驻子进程 + JSON-RPC over stdin/stdout。错误统一走 PluginError。
use crate::commands::error::PluginError;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Default per-call timeout for a plugin backend invocation.
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);

/// A single pending JSON-RPC request awaiting a response from the child.
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>;

/// One line of JSON-RPC response from the plugin child.
#[derive(Debug)]
struct JsonRpcResponse {
    /// JSON-RPC `id` so we can route to the right oneshot.
    id: u64,
    /// Decoded body, already split into result / error. Wrapped in
    /// `PluginError` so the categorical type matches what
    /// `invoke_plugin` returns to the frontend.
    body: Result<Value, PluginError>,
}

impl JsonRpcResponse {
    fn parse(line: &str) -> Option<Self> {
        let v: Value = serde_json::from_str(line).ok()?;
        let id = v.get("id")?.as_u64()?;
        if let Some(err) = v.get("error") {
            // Mirror the JSON-RPC error shape so the plugin can return
            // a meaningful message. We don't surface the `code` to the
            // TS side because the IPC layer only carries a string.
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("plugin error");
            Some(Self {
                id,
                body: Err(PluginError::JsonRpc(message.to_string())),
            })
        } else if v.get("result").is_some() {
            // A JSON-RPC response must have exactly one of `result`
            // or `error`; we only treat `result` as success here so
            // malformed shapes fall through to None.
            let result = v.get("result").cloned().unwrap_or(Value::Null);
            Some(Self {
                id,
                body: Ok(result),
            })
        } else {
            None
        }
    }
}

/// Long-lived handle to a single plugin's backend child process.
///
/// Cloning is cheap: every field is an `Arc` (or atomic) so each
/// `invoke_plugin` call gets an independent reference without going
/// through the outer map mutex on every access.
pub(crate) struct PluginProcess {
    plugin_id: String,
    /// stdin writer. We split this out of the Child at spawn time so
    /// multiple concurrent `invoke_plugin` calls share one writer.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    /// The child process itself, kept around so we can `kill()` it on
    /// shutdown. None means "already exited, await next call to
    /// respawn".
    child: Arc<Mutex<Option<Child>>>,
    /// JSON-RPC id counter (monotonic, per-process).
    next_id: AtomicU64,
    /// 连续超时计数：达到阈值后熔断该插件后端，避免僵尸进程长期占用 CPU/内存。
    /// 调用成功时会归零，因此统计的是「连续超时」次数。
    timeout_count: AtomicU32,
    /// Pending requests keyed by id.
    pending: PendingMap,
    /// Background reader task. Aborted on shutdown.
    _reader: JoinHandle<()>,
    /// Background stderr logger. Aborted on shutdown.
    _stderr: JoinHandle<()>,
    /// 最后一次调用时间，供空闲回收定时器判断是否 kill（超过 10 分钟未用则回收）
    last_used_at: std::sync::Mutex<Instant>,
}

/// Shared state registered with Tauri.
pub type SharedPluginProcessState = Arc<Mutex<HashMap<String, Arc<PluginProcess>>>>;

/// Create an empty shared state for use in `setup`.
pub fn new_shared_plugin_process_state() -> SharedPluginProcessState {
    Arc::new(Mutex::new(HashMap::new()))
}

/// 启动后台定时器：每 5 分钟扫描一次插件子进程，kill 超过 10 分钟未使用的进程并从 map 移除。
/// 在 Tauri setup 中调用（tauri::async_runtime::spawn 确保在 runtime 内执行）。
pub fn start_idle_reaper(state: SharedPluginProcessState) {
    tauri::async_runtime::spawn(async move {
        // 每 5 分钟扫描一次
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        // 空闲阈值：10 分钟未使用则回收
        let idle_threshold = Duration::from_secs(600);
        loop {
            interval.tick().await;
            // 先收集需要回收的 plugin_id，再释放 map 锁后逐个 kill，避免持锁调用 kill_plugin_backend 导致死锁
            let mut to_reap: Vec<String> = Vec::new();
            {
                let map = state.lock().await;
                for (plugin_id, proc) in map.iter() {
                    // mutex 中毒时优雅降级，避免后台定时任务 panic 静默退出
                    let last_used = *proc.last_used_at.lock().unwrap_or_else(|e| e.into_inner());
                    if last_used.elapsed() > idle_threshold {
                        to_reap.push(plugin_id.clone());
                    }
                }
            }
            for plugin_id in to_reap {
                // 二次检查：重新获取 state 锁，确认该进程仍超时空闲，并原子地 remove，
                // 显著缩小竞态窗口。残留窗口：invoke_plugin 在 get_or_spawn 拿到 proc 后、
                // pending.insert 前，reaper 恰好 remove + drain pending，新插入的 tx 无人唤醒，
                // 调用方将等待完整 INVOKE_TIMEOUT（30s）超时。该窗口极窄（reaper 每 5 分钟
                // 触发、仅对 10 分钟未用进程生效），且有 30s 超时兜底，不会死锁。
                // 此外 reader 任务在 child stdout EOF 时也会 drain pending（二次兜底），
                // 因此真正孤立需 reader 已退出，实际命中概率更低。
                // 持锁仅做「检查 + remove」，不调用 kill_plugin_backend，避免 map 锁嵌套死锁；
                // 实际 kill 在锁外由 kill_removed_proc 完成。
                let proc_to_kill = {
                    let mut map = state.lock().await;
                    if let Some(proc) = map.get(&plugin_id) {
                        // mutex 中毒时优雅降级，避免后台定时任务 panic 静默退出
                        let last_used = *proc.last_used_at.lock().unwrap_or_else(|e| e.into_inner());
                        if last_used.elapsed() > idle_threshold {
                            // 仍超时：原子 remove，拿出 proc 供锁外 kill
                            map.remove(&plugin_id)
                        } else {
                            // 已被重新使用（elapsed <= 600s），跳过 kill
                            None
                        }
                    } else {
                        // 已被其他路径 remove，跳过
                        None
                    }
                };
                if let Some(proc) = proc_to_kill {
                    kill_removed_proc(&proc, &plugin_id).await;
                    eprintln!(
                        "[plugin_invoke] idle plugin backend reaped (plugin_id={})",
                        plugin_id
                    );
                }
            }
        }
    });
}

// 构建 async Command；Windows 设 CREATE_NO_WINDOW，启用 kill_on_drop。
fn build_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    cmd
}

/// Resolve the backend binary path for a plugin. Tries, in order:
/// 1. `<plugin_path>/backend/plugin_<id>` (+ `.exe` on Windows)
/// 2. `<plugin_path>/backend/<id>`       (+ `.exe` on Windows)
///
/// Returns `None` if no candidate exists; the caller is responsible
/// for surfacing a user-friendly "backend not found" error.
fn resolve_backend_binary(plugin_id: &str, plugin_path: &str) -> Option<PathBuf> {
    let backend_dir = Path::new(plugin_path).join("backend");
    if !backend_dir.is_dir() {
        return None;
    }

    let exe_suffix = std::env::consts::EXE_SUFFIX;

    let primary = backend_dir.join(format!("plugin_{}{}", plugin_id, exe_suffix));
    if primary.is_file() {
        return Some(primary);
    }

    let fallback = backend_dir.join(format!("{}{}", plugin_id, exe_suffix));
    if fallback.is_file() {
        return Some(fallback);
    }

    None
}

// 在持有外层 map mutex 时 spawn 子进程；进程死亡通过 stdout EOF 检测。
async fn spawn_plugin_process(
    plugin_id: String,
    plugin_path: String,
    app_data_dir: &std::path::Path,
) -> Result<Arc<PluginProcess>, PluginError> {
    let binary = resolve_backend_binary(&plugin_id, &plugin_path)
        .ok_or_else(|| PluginError::NotFound(format!("plugin backend not found (plugin_id={})", plugin_id)))?;

    let mut cmd = build_command(binary.to_string_lossy().as_ref());
    // Pass the plugin id as the only argument so the child can sanity-
    // check it's running for the right plugin. Plugin authors can
    // ignore it.
    cmd.arg(&plugin_id);
    // Pass the app data directory via env var so the plugin backend can
    // store persistent data in a location separate from the plugin
    // installation directory (which gets deleted on uninstall).
    cmd.env("SWALLOWNOTE_APP_DATA_DIR", app_data_dir);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| PluginError::Process(format!("failed to spawn plugin backend ({}): {}", binary.display(), e)))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| PluginError::Process("plugin backend stdin unavailable".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| PluginError::Process("plugin backend stdout unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| PluginError::Process("plugin backend stderr unavailable".to_string()))?;

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    // Reader task: read line-delimited JSON, route to pending senders.
    let pending_for_reader = Arc::clone(&pending);
    let plugin_id_for_reader = plugin_id.clone();
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.is_empty() {
                        continue;
                    }
                    let Some(resp) = JsonRpcResponse::parse(&line) else {
                        eprintln!(
                            "[plugin-host] malformed response from '{}': {}",
                            plugin_id_for_reader, line
                        );
                        continue;
                    };
                    let mut map = pending_for_reader.lock().await;
                    if let Some(tx) = map.remove(&resp.id) {
                        // receiver 可能已因超时 drop，send 静默失败。
                        let _ = tx.send(resp);
                    } else {
                        eprintln!(
                            "[plugin-host] response with no pending request from '{}': id={}",
                            plugin_id_for_reader, resp.id
                        );
                    }
                }
                Ok(None) => {
                    // EOF: child closed stdout. Reject all pending
                    // requests with a clear error and exit the task.
                    let mut map = pending_for_reader.lock().await;
                    for (_, tx) in map.drain() {
                        let _ = tx.send(JsonRpcResponse {
                            id: 0,
                            body: Err(PluginError::Process(format!(
                                "plugin backend exited unexpectedly (plugin_id={})",
                                plugin_id_for_reader
                            ))),
                        });
                    }
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[plugin-host] stdout read error from '{}': {}",
                        plugin_id_for_reader, e
                    );
                    break;
                }
            }
        }
    });

    // Stderr task: tee the child's stderr to the host's log. We use
    // eprintln! rather than the `log` crate because the rest of the
    // codebase does too (no tracing dependency in src-tauri).
    let plugin_id_for_stderr = plugin_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[plugin:{}] {}", plugin_id_for_stderr, line);
        }
    });

    Ok(Arc::new(PluginProcess {
        plugin_id,
        stdin: Arc::new(Mutex::new(Some(stdin))),
        child: Arc::new(Mutex::new(Some(child))),
        next_id: AtomicU64::new(1),
        timeout_count: AtomicU32::new(0),
        pending,
        _reader: reader,
        _stderr: stderr_task,
        last_used_at: std::sync::Mutex::new(Instant::now()),
    }))
}

/// Look up the process for `plugin_id` from the shared map, spawning a
/// fresh one on first use. The map mutex is held for the duration of
/// the lookup + spawn (cheap) and released before the request is
/// actually written.
async fn get_or_spawn(
    state: &SharedPluginProcessState,
    plugin_id: &str,
    app_data_dir: &Path,
) -> Result<Arc<PluginProcess>, PluginError> {
    let mut guard = state.lock().await;
    if let Some(existing) = guard.get(plugin_id).cloned() {
        // If the child is already dead (try_wait returns Some status
        // or an error), evict and fall through to a fresh spawn.
        let still_alive = {
            let mut child_guard = existing.child.lock().await;
            match child_guard.as_mut() {
                Some(c) => matches!(c.try_wait(), Ok(None)),
                None => false,
            }
        };
        if still_alive {
            return Ok(existing);
        }
        guard.remove(plugin_id);
    }

    let plugins_root = app_data_dir.join("plugins");
    let plugin_root = super::plugin::resolve_plugin_dir(&plugins_root, plugin_id)
        .ok_or_else(|| PluginError::NotFound(format!("plugin directory not found (plugin_id={})", plugin_id)))?;
    let plugin_path = super::plugin::active_version_dir(&plugin_root)
        .ok_or_else(|| PluginError::NotFound(format!("plugin version directory not found (plugin_id={})", plugin_id)))?;
    let plugin_path_str = plugin_path.to_string_lossy().to_string();
    let proc = spawn_plugin_process(plugin_id.to_string(), plugin_path_str, app_data_dir).await?;
    guard.insert(plugin_id.to_string(), Arc::clone(&proc));
    Ok(proc)
}

// Tauri 命令：在 plugin_id 后端调用 command。返回 Result<Value, PluginError>。
#[tauri::command]
pub async fn invoke_plugin(
    app_handle: AppHandle,
    state: State<'_, SharedPluginProcessState>,
    plugin_id: String,
    command: String,
    args: Option<Value>,
) -> Result<Value, PluginError> {
    if plugin_id.is_empty() {
        return Err(PluginError::InvalidInput("plugin_id is required".to_string()));
    }
    if command.is_empty() {
        return Err(PluginError::InvalidInput("command is required".to_string()));
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to resolve app data dir: {}", e)))?;

    let proc = get_or_spawn(state.inner(), &plugin_id, &app_data_dir).await?;

    // 更新最后使用时间，供空闲回收定时器判断（新 spawn 的进程已是 now，此处覆盖也无妨）
    // mutex 中毒时优雅降级，与 start_idle_reaper 保持一致
    *proc.last_used_at.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();

    let id = proc.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": command,
        "params": args.unwrap_or(Value::Null),
    });
    let mut serialized = serde_json::to_string(&request)
        .map_err(|e| PluginError::JsonRpc(format!("failed to encode JSON-RPC request: {}", e)))?;
    serialized.push('\n');

    // Register the pending oneshot before writing so the reader task
    // is guaranteed to find a receiver when the response arrives.
    let (tx, rx) = oneshot::channel::<JsonRpcResponse>();
    {
        let mut pending = proc.pending.lock().await;
        pending.insert(id, tx);
    }

    // Write the request. If the writer is missing (e.g. the child
    // died between spawn and now), we recover by evicting the entry
    // and returning a clear error.
    {
        let mut stdin_guard = proc.stdin.lock().await;
        match stdin_guard.as_mut() {
            Some(s) => {
                if let Err(e) = s.write_all(serialized.as_bytes()).await {
                    // Drop the pending entry; reader EOF will sweep
                    // anything else left behind.
                    let mut pending = proc.pending.lock().await;
                    pending.remove(&id);
                    return Err(PluginError::Process(format!("failed to write to plugin stdin: {}", e)));
                }
                if let Err(e) = s.flush().await {
                    let mut pending = proc.pending.lock().await;
                    pending.remove(&id);
                    return Err(PluginError::Process(format!("failed to flush plugin stdin: {}", e)));
                }
            }
            None => {
                let mut pending = proc.pending.lock().await;
                pending.remove(&id);
                return Err(PluginError::Process(format!(
                    "plugin backend stdin closed (plugin_id={})",
                    proc.plugin_id
                )));
            }
        }
    }

    // Await the response, with timeout. We use tokio::select! so the
    // timeout fires even if the child is hung.
    let response = match tokio::time::timeout(INVOKE_TIMEOUT, rx).await {
        Ok(Ok(resp)) => {
            // 调用成功，重置连续超时计数，保证统计的是「连续」超时而非历史累计。
            proc.timeout_count.store(0, Ordering::Relaxed);
            resp
        }
        Ok(Err(_canceled)) => {
            // The reader task sent and the channel was consumed; this
            // branch is unreachable in practice because we own the
            // sender. Treat as a plugin error just in case.
            return Err(PluginError::JsonRpc("plugin response channel closed".to_string()));
        }
        Err(_elapsed) => {
            // Timeout: remove the pending entry so the reader task
            // doesn't keep a dead oneshot around. The reader's send
            // will fail silently when (if) a late response arrives.
            let mut pending = proc.pending.lock().await;
            pending.remove(&id);
            drop(pending);
            // 超时诊断日志：便于定位是哪个插件/命令卡住。
            let prev = proc.timeout_count.fetch_add(1, Ordering::Relaxed);
            eprintln!(
                "[plugin_invoke] plugin '{}' command '{}' timed out after {}s (consecutive timeout #{})",
                proc.plugin_id,
                command,
                INVOKE_TIMEOUT.as_secs(),
                prev + 1
            );
            // 熔断策略：连续超时达到阈值时主动 kill 后端进程，回收 CPU/内存，
            // 避免频繁超时的插件累积僵尸进程；下一次调用会由 get_or_spawn 重新拉起。
            const TIMEOUT_THRESHOLD: u32 = 3;
            if prev + 1 >= TIMEOUT_THRESHOLD {
                eprintln!(
                    "[plugin_invoke] plugin '{}' reached consecutive timeout threshold ({}), killing backend to reclaim resources",
                    proc.plugin_id, TIMEOUT_THRESHOLD
                );
                proc.timeout_count.store(0, Ordering::Relaxed);
                let _ = kill_plugin_backend(state.inner(), &proc.plugin_id).await;
            }
            return Err(PluginError::Timeout {
                secs: INVOKE_TIMEOUT.as_secs(),
                plugin_id: proc.plugin_id.clone(),
                command,
            });
        }
    };

    response.body
}

/// 对已从 state map 中 remove 出来的进程执行实际 kill + 唤醒 pending。
/// 不再操作 state map，避免与 kill_plugin_backend / idle_reaper 的 map 锁嵌套。
/// 抽出此函数是为了让 idle_reaper 能在锁内原子地「二次检查 last_used_at + remove」，
/// 然后释放锁再调用本函数执行 kill，真正消除「二次检查通过后、kill 前被 invoke_plugin 复用」的竞态。
async fn kill_removed_proc(proc: &Arc<PluginProcess>, plugin_id: &str) {
    // 取出 child 以便 start_kill + 等待退出，确保 fd 释放。
    let child_arc = proc.child.clone();
    let mut guard = child_arc.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
        // Give the child a brief grace period to release any
        // open file handles on the plugin dir; bounded so we
        // don't block uninstall indefinitely on a wedged process.
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
    // Also wake any pending oneshots with a "process killed" error
    // so callers blocked on `invoke_plugin` unblock instead of
    // hitting their full 30s timeout.
    let mut pending = proc.pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(JsonRpcResponse {
            id: 0,
            body: Err(PluginError::Process(format!(
                "plugin backend killed (plugin_id={})",
                plugin_id
            ))),
        });
    }
}

// Kill 并移除 plugin_id 的后端进程。返回 true 表示杀掉了存活进程。
pub async fn kill_plugin_backend(
    state: &SharedPluginProcessState,
    plugin_id: &str,
) -> Result<bool, PluginError> {
    // 此层也校验 id，防止未来 Rust 侧调用方绕过路径遍历防护。
    if plugin_id.is_empty() || plugin_id.len() > 128
        || plugin_id == "." || plugin_id == ".."
    {
        return Err(PluginError::InvalidInput(format!(
            "plugin id {:?} is invalid",
            plugin_id
        )));
    }
    for c in plugin_id.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !ok {
            return Err(PluginError::InvalidInput(format!(
                "plugin id {:?} contains illegal character {:?}",
                plugin_id, c
            )));
        }
    }

    // 锁内仅做 remove，锁外调用 kill_removed_proc 执行实际 kill，
    // 避免 map 锁与 child/pending 锁嵌套。
    let proc = {
        let mut map = state.lock().await;
        map.remove(plugin_id)
    };
    if let Some(proc) = proc {
        kill_removed_proc(&proc, plugin_id).await;
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonrpc_parse_result() {
        let r = JsonRpcResponse::parse(r#"{"jsonrpc":"2.0","id":42,"result":{"ok":true}}"#)
            .expect("parse");
        assert_eq!(r.id, 42);
        assert_eq!(r.body.unwrap(), serde_json::json!({"ok": true}));
    }

    #[test]
    fn jsonrpc_parse_error() {
        let r = JsonRpcResponse::parse(
            r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"method not found"}}"#,
        )
        .expect("parse");
        assert_eq!(r.id, 7);
        assert_eq!(r.body.unwrap_err().to_string(), "method not found");
    }

    #[test]
    fn jsonrpc_parse_garbage_returns_none() {
        assert!(JsonRpcResponse::parse("not json").is_none());
        assert!(JsonRpcResponse::parse(r#"{"id":1}"#).is_none());
        assert!(JsonRpcResponse::parse(r#"{"id":"not-a-number","result":null}"#).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_backend_binary_picks_primary() {
        let dir = tempdir();
        let backend = dir.join("backend");
        std::fs::create_dir_all(&backend).unwrap();
        let bin = backend.join(format!("plugin_demo{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&bin, "").unwrap();
        let resolved =
            resolve_backend_binary("demo", dir.to_str().unwrap()).expect("resolve");
        assert_eq!(resolved.file_name(), bin.file_name());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_backend_binary_falls_back_to_id() {
        let dir = tempdir();
        let backend = dir.join("backend");
        std::fs::create_dir_all(&backend).unwrap();
        let bin = backend.join(format!("demo{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&bin, "").unwrap();
        let resolved =
            resolve_backend_binary("demo", dir.to_str().unwrap()).expect("resolve");
        assert_eq!(resolved.file_name(), bin.file_name());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_backend_binary_missing_returns_none() {
        let dir = tempdir();
        assert!(resolve_backend_binary("demo", dir.to_str().unwrap()).is_none());
    }

    /// Tiny helper to create a unique temp dir under the system temp
    /// directory, auto-cleaned on drop.
    fn tempdir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering as AOrd};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let id = SEQ.fetch_add(1, AOrd::Relaxed);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!(
            "swallownote-plugin-invoke-test-{}-{}",
            pid, id
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}
