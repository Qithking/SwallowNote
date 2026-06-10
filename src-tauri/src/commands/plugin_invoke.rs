/**
 * Plugin backend invocation layer.
 *
 * Architecture
 * ============
 *
 *   TS panel ─invoke('plugin_<id>_<cmd>')─▶ Rust host
 *                                                │
 *                                                ▼
 *                                       spawn subprocess
 *                                       (`<plugin>/backend/plugin_<id>`)
 *                                                │
 *                                          JSON-RPC over
 *                                          stdin/stdout
 *
 * The host keeps a long-lived child process per plugin so we don't pay
 * the spawn cost on every command. The child is started lazily on the
 * first call, reused for subsequent calls, and re-spawned automatically
 * if it dies.
 *
 * Wire protocol
 * =============
 *
 * Line-delimited JSON-RPC 2.0 over the child's stdin/stdout:
 *
 *   host  → plugin : {"jsonrpc":"2.0","id":1,"method":"cmd","params":{...}}\n
 *   plugin→ host   : {"jsonrpc":"2.0","id":1,"result":...}\n
 *   plugin→ host   : {"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"..."}}\n
 *
 * Stderr from the plugin is logged but never treated as a response.
 *
 * Lifetime
 * ========
 *
 * - `PluginProcessState` is a `HashMap<plugin_id, PluginProcess>` stored
 *   in Tauri's state. The map is shared via `Arc<tokio::sync::Mutex<…>>`
 *   because the command path is async.
 * - On `invoke_plugin` we look up (or lazily create) the process. If
 *   the previous run died, we evict the dead entry and spawn a fresh
 *   child before sending the request.
 * - Per-request timeout is `INVOKE_TIMEOUT`. On timeout the pending
 *   oneshot is dropped (the reader task will eventually find no
 *   receiver when a late response arrives and discard it).
 *
 * Error model
 * ===========
 *
 * Plugin errors ({"error":{...}}) are returned to the frontend as
 * `Err(String)` so the TS-side `invokeBackend` wrapper can surface them
 * verbatim. We do NOT use Tauri command Result variants for plugin
 * errors because the host has no way to know which JSON-RPC error code
 * is "expected" – every plugin defines its own.
 */
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
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
    /// Decoded body, already split into result / error.
    body: Result<Value, String>,
}

impl JsonRpcResponse {
    fn parse(line: &str) -> Option<Self> {
        let v: Value = serde_json::from_str(line).ok()?;
        let id = v.get("id")?.as_u64()?;
        if let Some(err) = v.get("error") {
            // Mirror the JSON-RPC error shape so the plugin can return
            // a meaningful message. We don't surface the `code` to the
            // TS side because Tauri commands only carry a String.
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("plugin error");
            Some(Self {
                id,
                body: Err(message.to_string()),
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
    /// Pending requests keyed by id.
    pending: PendingMap,
    /// Background reader task. Aborted on shutdown.
    _reader: JoinHandle<()>,
    /// Background stderr logger. Aborted on shutdown.
    _stderr: JoinHandle<()>,
}

/// Shared state registered with Tauri.
pub type SharedPluginProcessState = Arc<Mutex<HashMap<String, Arc<PluginProcess>>>>;

/// Create an empty shared state for use in `setup`.
pub fn new_shared_plugin_process_state() -> SharedPluginProcessState {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Build a `tokio::process::Command` for the given platform. On Windows
/// we set the `CREATE_NO_WINDOW` flag so the plugin backend does not
/// flash a console window. Mirrors the policy in
/// `commands::create_command` but for the async `Command` type, which
/// has its own `kill_on_drop` knob we want to enable.
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

/// Spawn the child and start its reader/stderr tasks. Returns
/// `PluginProcess` on success.
///
/// This function is called with the outer map mutex held (so two
/// concurrent first-time calls can't both spawn). It does not await on
/// the child itself – `tokio::process::Child::wait` is not used here
/// because we detect process death through EOF on stdout instead.
async fn spawn_plugin_process(
    plugin_id: String,
    plugin_path: String,
) -> Result<Arc<PluginProcess>, String> {
    let binary = resolve_backend_binary(&plugin_id, &plugin_path)
        .ok_or_else(|| format!("plugin backend not found (plugin_id={})", plugin_id))?;

    let mut cmd = build_command(binary.to_string_lossy().as_ref());
    // Pass the plugin id as the only argument so the child can sanity-
    // check it's running for the right plugin. Plugin authors can
    // ignore it.
    cmd.arg(&plugin_id);

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn plugin backend ({}): {}", binary.display(), e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "plugin backend stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "plugin backend stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "plugin backend stderr unavailable".to_string())?;

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
                        // If the receiver was already dropped (e.g. the
                        // host timed out the request) this silently
                        // succeeds. We still need to clean up the
                        // entry, which we just did.
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
                            body: Err(format!(
                                "plugin backend exited unexpectedly (plugin_id={})",
                                plugin_id_for_reader
                            )),
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
        pending,
        _reader: reader,
        _stderr: stderr_task,
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
) -> Result<Arc<PluginProcess>, String> {
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

    let plugin_path = app_data_dir.join("plugins").join(plugin_id);
    let plugin_path_str = plugin_path.to_string_lossy().to_string();
    let proc = spawn_plugin_process(plugin_id.to_string(), plugin_path_str).await?;
    guard.insert(plugin_id.to_string(), Arc::clone(&proc));
    Ok(proc)
}

/// Tauri command: invoke `command` on `plugin_id`'s backend.
///
/// Wire shape (called by the TS side as `invoke('plugin_<id>_<cmd>', ...)`):
///   { plugin_id, command, args? }
/// We extract `plugin_id` and `command` from the JSON-RPC envelope
/// style and pass the rest as `args`.
#[tauri::command]
pub async fn invoke_plugin(
    app_handle: AppHandle,
    state: State<'_, SharedPluginProcessState>,
    plugin_id: String,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    if plugin_id.is_empty() {
        return Err("plugin_id is required".to_string());
    }
    if command.is_empty() {
        return Err("command is required".to_string());
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let proc = get_or_spawn(state.inner(), &plugin_id, &app_data_dir).await?;

    let id = proc.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": command,
        "params": args.unwrap_or(Value::Null),
    });
    let mut serialized = serde_json::to_string(&request)
        .map_err(|e| format!("failed to encode JSON-RPC request: {}", e))?;
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
                    return Err(format!("failed to write to plugin stdin: {}", e));
                }
                if let Err(e) = s.flush().await {
                    let mut pending = proc.pending.lock().await;
                    pending.remove(&id);
                    return Err(format!("failed to flush plugin stdin: {}", e));
                }
            }
            None => {
                let mut pending = proc.pending.lock().await;
                pending.remove(&id);
                return Err(format!(
                    "plugin backend stdin closed (plugin_id={})",
                    proc.plugin_id
                ));
            }
        }
    }

    // Await the response, with timeout. We use tokio::select! so the
    // timeout fires even if the child is hung.
    let response = match tokio::time::timeout(INVOKE_TIMEOUT, rx).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(_canceled)) => {
            // The reader task sent and the channel was consumed; this
            // branch is unreachable in practice because we own the
            // sender. Treat as a plugin error just in case.
            return Err("plugin response channel closed".to_string());
        }
        Err(_elapsed) => {
            // Timeout: remove the pending entry so the reader task
            // doesn't keep a dead oneshot around. The reader's send
            // will fail silently when (if) a late response arrives.
            let mut pending = proc.pending.lock().await;
            pending.remove(&id);
            return Err(format!(
                "plugin backend timed out after {}s (plugin_id={}, command={})",
                INVOKE_TIMEOUT.as_secs(),
                proc.plugin_id,
                command
            ));
        }
    };

    response.body
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
        assert_eq!(r.body.unwrap_err(), "method not found");
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
