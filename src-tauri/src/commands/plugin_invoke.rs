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
use tauri::ipc::Channel;
use log::{info, warn, error};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

/// Default per-call timeout for a plugin backend invocation.
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);

/// 流式调用默认首块超时（推理模型首 token 常超 30s；可经 firstChunkTimeoutSecs 覆盖）。
const STREAM_FIRST_CHUNK_TIMEOUT: Duration = Duration::from_secs(90);

/// 流式调用的块间空闲超时（任意事件到达即刷新；无总时长上限）。
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

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

/// 后端流式通知帧：`{"jsonrpc":"2.0","method":"swallow/stream",
/// "params":{"requestId":<请求id>,"event":"chunk"|"done"|"error","data":...}}`。
/// 与响应帧同管道交错，按 `requestId`（即该次请求的 JSON-RPC `id`）路由。
#[derive(Debug)]
struct StreamNotification {
    /// 归属请求的 JSON-RPC `id`（宿主生成），据此路由到对应流。
    request_id: u64,
    event: StreamEventKind,
    /// 增量载荷；done/error 事件可省略（默认 Null）。
    data: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamEventKind {
    Chunk,
    Done,
    Error,
}

impl StreamEventKind {
    fn as_str(self) -> &'static str {
        match self {
            StreamEventKind::Chunk => "chunk",
            StreamEventKind::Done => "done",
            StreamEventKind::Error => "error",
        }
    }
}

/// 经 Tauri Channel 推送到前端的流式事件载荷（requestId 仅经 start 事件
/// 下发一次，供插件前端实现停止；chunk/done/error 的路由 id 已被宿主消化）。
/// Deserialize 供 Tauri command 参数机制满足 `Channel<T>: CommandArg` 的 bound。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct StreamEvent {
    event: String,
    data: Value,
}

/// 读循环帧分类：响应帧（有 `id`+`result`/`error`）终止一次 invoke；
/// 通知帧（有 `method`）为流式增量，按 requestId 路由到对应 Channel。
#[derive(Debug)]
enum JsonRpcFrame {
    Response(JsonRpcResponse),
    Notification(StreamNotification),
}

impl JsonRpcFrame {
    /// 流式通知帧保留的 method 名；未知 method 一律丢弃。
    const STREAM_METHOD: &'static str = "swallow/stream";

    fn parse(line: &str) -> Option<Self> {
        let v: Value = serde_json::from_str(line).ok()?;
        // 通知帧优先判定：响应帧永远没有 method 字段。
        if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
            if method != Self::STREAM_METHOD {
                return None;
            }
            let params = v.get("params")?;
            let request_id = params.get("requestId")?.as_u64()?;
            let kind = match params.get("event")?.as_str()? {
                "chunk" => StreamEventKind::Chunk,
                "done" => StreamEventKind::Done,
                "error" => StreamEventKind::Error,
                _ => return None,
            };
            return Some(Self::Notification(StreamNotification {
                request_id,
                event: kind,
                data: params.get("data").cloned().unwrap_or(Value::Null),
            }));
        }
        JsonRpcResponse::parse(line).map(Self::Response)
    }
}

/// 一路进行中的流式调用：通知帧按 requestId 命中后经 channel 推送到前端；
/// activity 计数器（watch）供 invoke 循环感知「有新块到达」以刷新空闲超时。
struct StreamChannel {
    channel: Channel<StreamEvent>,
    activity: watch::Sender<u64>,
}

/// 并发流式路由表：requestId（JSON-RPC 请求 id）→ 流通道。
type StreamsMap = Arc<Mutex<HashMap<u64, StreamChannel>>>;

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
    /// 进行中的流式调用，按 requestId 路由通知帧。
    streams: StreamsMap,
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
                    info!(
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
    let streams: StreamsMap = Arc::new(Mutex::new(HashMap::new()));

    // Reader task: read line-delimited JSON, classify each frame, and
    // route: response → pending oneshot; notification → stream channel.
    let pending_for_reader = Arc::clone(&pending);
    let streams_for_reader = Arc::clone(&streams);
    let plugin_id_for_reader = plugin_id.clone();
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.is_empty() {
                        continue;
                    }
                    match JsonRpcFrame::parse(&line) {
                        Some(JsonRpcFrame::Response(resp)) => {
                            let mut map = pending_for_reader.lock().await;
                            if let Some(tx) = map.remove(&resp.id) {
                                // receiver 可能已因超时 drop，send 静默失败。
                                let _ = tx.send(resp);
                            } else {
                                warn!(
                                    "[plugin-host] response with no pending request from '{}': id={}",
                                    plugin_id_for_reader, resp.id
                                );
                            }
                        }
                        Some(JsonRpcFrame::Notification(n)) => {
                            let mut streams = streams_for_reader.lock().await;
                            if let Some(sc) = streams.get(&n.request_id) {
                                // 推送到前端 Tauri Channel；activity 计数唤醒
                                // invoke 循环刷新空闲超时（send_modify 即通知）。
                                let _ = sc.channel.send(StreamEvent {
                                    event: n.event.as_str().to_string(),
                                    data: n.data,
                                });
                                let _ = sc.activity.send_modify(|c| *c += 1);
                            } else {
                                warn!(
                                    "[plugin-host] stream notification with no channel from '{}': requestId={}",
                                    plugin_id_for_reader, n.request_id
                                );
                            }
                        }
                        None => {
                            error!(
                                "[plugin-host] malformed frame from '{}': {}",
                                plugin_id_for_reader,
                                &line[..line.len().min(256)]
                            );
                        }
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
                    drop(map);
                    // 未完成的流以 error 事件收尾（前端展示为流中断）。
                    let mut streams = streams_for_reader.lock().await;
                    for (_, sc) in streams.drain() {
                        let _ = sc.channel.send(StreamEvent {
                            event: "error".to_string(),
                            data: serde_json::json!({
                                "message": "plugin backend exited unexpectedly",
                            }),
                        });
                    }
                    break;
                }
                Err(e) => {
                    error!(
                        "[plugin-host] stdout read error from '{}': {}",
                        plugin_id_for_reader, e
                    );
                    break;
                }
            }
        }
    });

    // Stderr task: tee the child's stderr to the host's log via the
    // `log` crate so plugin output respects the configured log level.
    let plugin_id_for_stderr = plugin_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            info!("[plugin:{}] {}", plugin_id_for_stderr, line);
        }
    });

    Ok(Arc::new(PluginProcess {
        plugin_id,
        stdin: Arc::new(Mutex::new(Some(stdin))),
        child: Arc::new(Mutex::new(Some(child))),
        next_id: AtomicU64::new(1),
        timeout_count: AtomicU32::new(0),
        pending,
        streams,
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

/// invoke 公共前置：校验 → 取/拉起进程 → 刷新 last_used → 分配 id →
/// 注册 pending（流式时同时注册流路由表项）→ 写请求。
/// 返回 (proc, id, rx, activity_rx)；activity_rx 仅流式调用为 Some，
/// 供流式等待循环感知「有事件到达」以刷新空闲超时。
async fn write_request(
    state: &SharedPluginProcessState,
    app_data_dir: &Path,
    plugin_id: &str,
    command: &str,
    args: Option<Value>,
    stream: Option<Channel<StreamEvent>>,
) -> Result<
    (
        Arc<PluginProcess>,
        u64,
        oneshot::Receiver<JsonRpcResponse>,
        Option<watch::Receiver<u64>>,
    ),
    PluginError,
> {
    if plugin_id.is_empty() {
        return Err(PluginError::InvalidInput("plugin_id is required".to_string()));
    }
    if command.is_empty() {
        return Err(PluginError::InvalidInput("command is required".to_string()));
    }

    let proc = get_or_spawn(state, plugin_id, app_data_dir).await?;

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

    // 流式调用：创建 activity watch 并准备流路由表项。
    let (stream_channel, activity_rx) = match stream {
        Some(ch) => {
            let (tx, rx) = watch::channel(0u64);
            (Some(StreamChannel { channel: ch, activity: tx }), Some(rx))
        }
        None => (None, None),
    };

    // Register the pending oneshot before writing so the reader task
    // is guaranteed to find a receiver when the response arrives.
    // 流路由表项同样先注册，保证后端早期通知帧不丢失。
    let (tx, rx) = oneshot::channel::<JsonRpcResponse>();
    {
        let mut pending = proc.pending.lock().await;
        pending.insert(id, tx);
    }
    if let Some(sc) = stream_channel {
        // 通用停止通道（P2.4）：start 事件把宿主生成的 requestId 下发给插件
        // 前端，使其可调用后端自身的取消命令（如 AI 插件 stopStream）实现
        // 流式中断。下发先于路由表注册；通道已关闭等失败可安全忽略。
        let _ = sc.channel.send(StreamEvent {
            event: "start".to_string(),
            data: serde_json::json!({ "requestId": id }),
        });
        proc.streams.lock().await.insert(id, sc);
    }

    // Write the request. If the writer is missing (e.g. the child
    // died between spawn and now), we recover by evicting the entry
    // and returning a clear error.
    let write_result = async {
        let mut stdin_guard = proc.stdin.lock().await;
        let s = match stdin_guard.as_mut() {
            Some(s) => s,
            None => {
                return Err(PluginError::Process(format!(
                    "plugin backend stdin closed (plugin_id={})",
                    proc.plugin_id
                )));
            }
        };
        s.write_all(serialized.as_bytes())
            .await
            .map_err(|e| PluginError::Process(format!("failed to write to plugin stdin: {}", e)))?;
        s.flush()
            .await
            .map_err(|e| PluginError::Process(format!("failed to flush plugin stdin: {}", e)))?;
        Ok(())
    }
    .await;

    if let Err(e) = write_result {
        // 写失败：清理 pending + streams；reader EOF 会兜底扫尾。
        proc.pending.lock().await.remove(&id);
        if activity_rx.is_some() {
            proc.streams.lock().await.remove(&id);
        }
        return Err(e);
    }

    Ok((proc, id, rx, activity_rx))
}

// Tauri 命令：在 plugin_id 后端调用 command（非流式：30s 总超时 + 连续超时熔断）。
#[tauri::command]
pub async fn invoke_plugin(
    app_handle: AppHandle,
    state: State<'_, SharedPluginProcessState>,
    plugin_id: String,
    command: String,
    args: Option<Value>,
) -> Result<Value, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to resolve app data dir: {}", e)))?;

    let (proc, id, rx, _activity_rx) =
        write_request(state.inner(), &app_data_dir, &plugin_id, &command, args, None).await?;

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
            warn!(
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
                warn!(
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

/// 流式 invoke：与 invoke_plugin 共用后端管道，但携带 Tauri Channel 接收
/// `swallow/stream` 通知帧；响应帧仍负责终结调用并返回最终结果。
/// 超时三态：首块超时可配（默认 90s），此后任意事件到达刷新 60s 空闲
/// deadline（无总时长上限）；流式超时不计入连续超时熔断。
#[tauri::command]
pub async fn invoke_plugin_stream(
    app_handle: AppHandle,
    state: State<'_, SharedPluginProcessState>,
    plugin_id: String,
    command: String,
    args: Option<Value>,
    stream: Channel<StreamEvent>,
    first_chunk_timeout_secs: Option<u64>,
) -> Result<Value, PluginError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to resolve app data dir: {}", e)))?;

    // 首块超时可经 first_chunk_timeout_secs 覆盖；最小 1s 防误配为 0。
    let first_chunk = Duration::from_secs(
        first_chunk_timeout_secs
            .unwrap_or(STREAM_FIRST_CHUNK_TIMEOUT.as_secs())
            .max(1),
    );

    let (proc, id, mut rx, activity_rx) =
        write_request(state.inner(), &app_data_dir, &plugin_id, &command, args, Some(stream))
            .await?;
    let mut activity_rx = activity_rx.expect("streaming call must have an activity receiver");

    // 首块阶段用 first_chunk；首个事件到达后进入空闲模式（60s 滚动续期）。
    let mut current_timeout = first_chunk;
    let mut deadline = tokio::time::Instant::now() + current_timeout;
    let response = loop {
        tokio::select! {
            resp = &mut rx => {
                match resp {
                    Ok(resp) => {
                        // 响应帧终结调用；正常返回同样重置连续超时计数。
                        proc.timeout_count.store(0, Ordering::Relaxed);
                        break resp;
                    }
                    Err(_canceled) => {
                        // reader 持有的 tx 已消失：异常路径兜底。
                        proc.streams.lock().await.remove(&id);
                        return Err(PluginError::JsonRpc(
                            "plugin response channel closed".to_string(),
                        ));
                    }
                }
            }
            changed = activity_rx.changed() => {
                if changed.is_ok() {
                    // 任意流事件（chunk/done/error）到达：刷新空闲 deadline。
                    current_timeout = STREAM_IDLE_TIMEOUT;
                    deadline = tokio::time::Instant::now() + current_timeout;
                }
                // Err：发送端已随流表项清理（EOF/kill 收尾），继续等 rx 或超时兜底。
            }
            _ = tokio::time::sleep_until(deadline) => {
                // 流式超时：清理 pending + streams。不计入连续超时熔断——
                // 流式调用生命周期长（长推理模型），熔断会误杀正常插件。
                proc.pending.lock().await.remove(&id);
                proc.streams.lock().await.remove(&id);
                warn!(
                    "[plugin_invoke] plugin '{}' stream '{}' timed out (no stream event within {}s)",
                    proc.plugin_id, command, current_timeout.as_secs()
                );
                return Err(PluginError::Timeout {
                    secs: current_timeout.as_secs(),
                    plugin_id: proc.plugin_id.clone(),
                    command,
                });
            }
        }
    };

    // 调用结束（无论成败）：移除流路由表项；迟到的通知帧将因查表失败
    // 记录 warn（后端协议违规可观测），不再推给前端。
    proc.streams.lock().await.remove(&id);

    response.body
}

/// 预热插件后端进程（P1.4 面板请求管道）：仅 get_or_spawn 拉起进程并刷新
/// last_used_at，不发送任何 JSON-RPC 请求。供前端打开插件面板时调用，
/// 避免首次对话请求叠加进程冷启动延迟。失败不阻塞面板打开（前端静默兜底）。
#[tauri::command]
pub async fn prewarm_plugin(
    app_handle: AppHandle,
    state: State<'_, SharedPluginProcessState>,
    plugin_id: String,
) -> Result<(), PluginError> {
    // 防路径遍历：与 kill_plugin_backend 同一校验入口
    super::plugin::validate_plugin_id(&plugin_id)?;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PluginError::Io(format!("Failed to resolve app data dir: {}", e)))?;
    get_or_spawn(state.inner(), &plugin_id, &app_data_dir).await?;
    Ok(())
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
    drop(pending);
    // 未完成的流以 error 事件收尾（前端展示为流中断）。
    let mut streams = proc.streams.lock().await;
    for (_, sc) in streams.drain() {
        let _ = sc.channel.send(StreamEvent {
            event: "error".to_string(),
            data: serde_json::json!({ "message": "plugin backend killed" }),
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

    #[test]
    fn frame_parse_notification() {
        let line = r#"{"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":7,"event":"chunk","data":{"text":"你"}}}"#;
        match JsonRpcFrame::parse(line).expect("parse") {
            JsonRpcFrame::Notification(n) => {
                assert_eq!(n.request_id, 7);
                assert_eq!(n.event, StreamEventKind::Chunk);
                assert_eq!(n.data, serde_json::json!({"text": "你"}));
            }
            _ => panic!("expected notification"),
        }
    }

    #[test]
    fn frame_parse_notification_done_without_data() {
        let line = r#"{"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":3,"event":"done"}}"#;
        match JsonRpcFrame::parse(line).expect("parse") {
            JsonRpcFrame::Notification(n) => {
                assert_eq!(n.request_id, 3);
                assert_eq!(n.event, StreamEventKind::Done);
                assert_eq!(n.data, Value::Null);
            }
            _ => panic!("expected notification"),
        }
    }

    #[test]
    fn frame_parse_unknown_method_or_event_dropped() {
        // 未知 method / 未知 event / 缺 requestId / 缺 event：一律丢弃。
        assert!(JsonRpcFrame::parse(r#"{"jsonrpc":"2.0","method":"other/method","params":{}}"#).is_none());
        assert!(JsonRpcFrame::parse(
            r#"{"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":1,"event":"bogus"}}"#
        )
        .is_none());
        assert!(JsonRpcFrame::parse(
            r#"{"jsonrpc":"2.0","method":"swallow/stream","params":{"event":"chunk"}}"#
        )
        .is_none());
        assert!(JsonRpcFrame::parse(
            r#"{"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":1}}"#
        )
        .is_none());
    }

    #[test]
    fn frame_parse_response_still_routes_as_response() {
        let line = r#"{"jsonrpc":"2.0","id":42,"result":{"ok":true}}"#;
        match JsonRpcFrame::parse(line).expect("parse") {
            JsonRpcFrame::Response(r) => assert_eq!(r.id, 42),
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn frame_parse_1mb_chunk_line() {
        // 超长单行（≥1MB chunk）必须完整解析，不得截断/丢弃。
        let big_text = "x".repeat(1024 * 1024);
        let line = format!(
            r#"{{"jsonrpc":"2.0","method":"swallow/stream","params":{{"requestId":9,"event":"chunk","data":{{"text":"{}"}}}}}}"#,
            big_text
        );
        assert!(line.len() > 1024 * 1024);
        match JsonRpcFrame::parse(&line).expect("parse") {
            JsonRpcFrame::Notification(n) => {
                assert_eq!(n.request_id, 9);
                assert_eq!(n.data["text"].as_str().unwrap().len(), 1024 * 1024);
            }
            _ => panic!("expected notification"),
        }
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

    // 假后端（python3）：读两行 JSON-RPC 请求，按 id 升序标记 A/B 两路，
    // 交错发 chunk 通知帧（A0 B0 A1 B1 A2 B2）再各回响应帧。
    // 宿主端流路由必须按 requestId 严格分流——这正是被测行为。
    const STREAM_ECHO_BACKEND: &str = r#"#!/usr/bin/env python3
import sys, json

def main():
    reqs = []
    while len(reqs) < 2:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if line:
            reqs.append(json.loads(line))
    reqs.sort(key=lambda r: r["id"])
    for i in range(3):
        for idx, req in enumerate(reqs):
            frame = {
                "jsonrpc": "2.0",
                "method": "swallow/stream",
                "params": {
                    "requestId": req["id"],
                    "event": "chunk",
                    "data": {"text": "%s%d" % ("AB"[idx], i)},
                },
            }
            sys.stdout.write(json.dumps(frame) + "\n")
            sys.stdout.flush()
    for idx, req in enumerate(reqs):
        sys.stdout.write(json.dumps({
            "jsonrpc": "2.0",
            "id": req["id"],
            "result": {"echo": "AB"[idx], "method": req.get("method")},
        }) + "\n")
        sys.stdout.flush()

main()
"#;

    // 并发两路流端到端（Phase 1 验收）：真实子进程 + 真实管道，
    // 验证同插件两路流式调用的 chunk 帧按 requestId 路由、互不串扰。
    // reader task 按行序同步调用 Channel 回调，故「收到响应帧」即保证
    // 该次调用的全部 chunk 已入缓冲，断言无需 sleep/轮询。
    #[cfg(unix)]
    #[tokio::test]
    async fn concurrent_streams_route_without_crosstalk() {
        use tauri::ipc::InvokeResponseBody;
        use std::os::unix::fs::PermissionsExt;

        // 布局假插件：active_version_dir 无 symlink/marker 时扫 .versions/ 目录。
        let root = tempdir();
        let backend_dir = root.join("plugins/echo-test/.versions/1.0.0/backend");
        std::fs::create_dir_all(&backend_dir).unwrap();
        let backend = backend_dir.join("plugin_echo-test");
        std::fs::write(&backend, STREAM_ECHO_BACKEND).unwrap();
        std::fs::set_permissions(&backend, std::fs::Permissions::from_mode(0o755)).unwrap();

        let state = new_shared_plugin_process_state();

        // 两路 Channel：回调同步解析 StreamEvent 并 push 到各自缓冲。
        let collect = |buf: Arc<std::sync::Mutex<Vec<StreamEvent>>>| {
            Channel::<StreamEvent>::new(move |body| {
                if let InvokeResponseBody::Json(s) = body {
                    let ev: StreamEvent = serde_json::from_str(&s).expect("decode StreamEvent");
                    buf.lock().unwrap().push(ev);
                }
                Ok(())
            })
        };
        let buf_a = Arc::new(std::sync::Mutex::new(Vec::new()));
        let buf_b = Arc::new(std::sync::Mutex::new(Vec::new()));
        let channel_a = collect(Arc::clone(&buf_a));
        let channel_b = collect(Arc::clone(&buf_b));

        // 并发两路流式调用：同插件共享同一后端进程，id 由 AtomicU64 分配。
        let (ra, rb) = tokio::join!(
            write_request(&state, &root, "echo-test", "streamChat",
                          Some(serde_json::json!({"q": "A"})), Some(channel_a)),
            write_request(&state, &root, "echo-test", "streamChat",
                          Some(serde_json::json!({"q": "B"})), Some(channel_b)),
        );
        let (_, id_a, rx_a, _) = ra.expect("write_request A");
        let (_, id_b, rx_b, _) = rb.expect("write_request B");

        // 响应帧终结调用；30s 兜底防后端异常挂死测试。
        let resp_a = tokio::time::timeout(Duration::from_secs(30), rx_a)
            .await.expect("timeout waiting A").expect("rx A closed");
        let resp_b = tokio::time::timeout(Duration::from_secs(30), rx_b)
            .await.expect("timeout waiting B").expect("rx B closed");
        let body_a = resp_a.body.expect("A response ok");
        let body_b = resp_b.body.expect("B response ok");
        assert_eq!(body_a["echo"].as_str(), Some("A"));
        assert_eq!(body_b["echo"].as_str(), Some("B"));

        // start 事件：每路各一条，携带宿主分配的 requestId（通用停止通道，
        // 插件前端据此调用后端自身的取消命令）。
        let start_ids = |buf: &Arc<std::sync::Mutex<Vec<StreamEvent>>>| {
            buf.lock().unwrap().iter()
                .filter(|e| e.event == "start")
                .map(|e| e.data["requestId"].as_u64().expect("requestId u64"))
                .collect::<Vec<_>>()
        };
        assert_eq!(start_ids(&buf_a), vec![id_a]);
        assert_eq!(start_ids(&buf_b), vec![id_b]);

        // 断言：chunk 严格按路分流且顺序保持（A 不见 B 帧，反之亦然）。
        let texts = |buf: &Arc<std::sync::Mutex<Vec<StreamEvent>>>| {
            buf.lock().unwrap().iter()
                .filter(|e| e.event == "chunk")
                .map(|e| e.data["text"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(texts(&buf_a), vec!["A0", "A1", "A2"]);
        assert_eq!(texts(&buf_b), vec!["B0", "B1", "B2"]);
    }
}
