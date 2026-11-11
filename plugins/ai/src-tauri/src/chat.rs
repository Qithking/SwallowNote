//! streamChat 命令编排：上下文截断 → 载荷构造 → 重试请求 → SSE 解析 → 通知帧输出。
//!
//! 可测的决策逻辑（状态码分类、三家 SSE 增量提取）为纯函数并配单测；
//! 网络与线程编排由 P2.7 真实 Provider 手测矩阵覆盖。

use crate::context::{self, ChatMessage};
use crate::provider::{self, BuiltRequest, ProviderConfig};
use crate::retry::{self, Attempt};
use crate::sse::{SseError, SseItem, SseParser};
use serde_json::{json, Value};
use std::io::{BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};

/// 上游 HTTP 状态码 → 重试分类：2xx 成功；5xx / 429 可重试；其余（4xx 等）不可重试。
pub fn classify_status(status: u16) -> Attempt<()> {
    if (200..300).contains(&status) {
        Attempt::Success(())
    } else if status >= 500 || status == 429 {
        Attempt::Retryable(status.to_string())
    } else {
        Attempt::Fatal(status.to_string())
    }
}

/// 一条上游 SSE data 载荷的解析结果（SSE→通知帧转换的决策核心）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamTick {
    /// 增量文本 → 发 chunk 通知帧 {"text": ...}
    Delta(String),
    /// 上游正常终止 → 发 done 通知帧并收尾
    Finish,
    /// 上游错误 → 发 error 通知帧并终止
    Error(String),
    /// 心跳 / message_start 等无关事件
    Ignore,
}

/// 把一条 SSE data 载荷解析为流决策（三家协议，自主应用 handlers.rs 平移）。
pub fn parse_sse_data(provider: &str, data: &str) -> StreamTick {
    // OpenAI 兼容分支的流终止标记
    if data.trim() == "[DONE]" {
        return StreamTick::Finish;
    }
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => return StreamTick::Error(format!("解析上游数据失败: {}", e)),
    };
    match provider {
        "anthropic" => parse_anthropic(&v),
        "google" => parse_google(&v),
        _ => parse_openai(&v),
    }
}

/// Anthropic 事件流：content_block_delta 增量、message_stop/message_delta 终止、error 上报。
fn parse_anthropic(v: &Value) -> StreamTick {
    match v.get("type").and_then(|t| t.as_str()) {
        Some("content_block_delta") => {
            let text = v
                .pointer("/delta/text")
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if text.is_empty() {
                StreamTick::Ignore
            } else {
                StreamTick::Delta(text.to_string())
            }
        }
        Some("message_delta") | Some("message_stop") => StreamTick::Finish,
        Some("error") => {
            let m = v
                .pointer("/error/message")
                .and_then(|m| m.as_str())
                .unwrap_or("上游返回错误");
            StreamTick::Error(m.to_string())
        }
        _ => StreamTick::Ignore,
    }
}

/// Google 事件流：candidates[0].content.parts[].text 拼接增量、finishReason 终止。
fn parse_google(v: &Value) -> StreamTick {
    let candidate = v.get("candidates").and_then(|c| c.get(0));
    let text = candidate
        .and_then(|c| c.pointer("/content/parts"))
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<String>()
        })
        .unwrap_or_default();
    if !text.is_empty() {
        return StreamTick::Delta(text);
    }
    if candidate
        .and_then(|c| c.get("finishReason"))
        .is_some()
    {
        return StreamTick::Finish;
    }
    StreamTick::Ignore
}

/// OpenAI 兼容事件流：choices[0].delta.content 增量、finish_reason 终止。
fn parse_openai(v: &Value) -> StreamTick {
    let choice = v.get("choices").and_then(|c| c.get(0));
    if choice
        .and_then(|c| c.get("finish_reason"))
        .map(|r| r.is_string())
        .unwrap_or(false)
    {
        return StreamTick::Finish;
    }
    match choice.and_then(|c| c.pointer("/delta/content")).and_then(|t| t.as_str()) {
        Some(t) if !t.is_empty() => StreamTick::Delta(t.to_string()),
        _ => StreamTick::Ignore,
    }
}

/// streamChat 已解析参数（P2.4：provider/base_url/context_window 由 main.rs 按
/// modelId 从 ai_models 表读取——配置单一权威源；api_key 由插件前端从宿主
/// secureStorage 读出过境，后端进程无法访问 secureStorage）。
#[derive(Debug)]
pub struct StreamParams {
    pub provider: String,
    pub model_id: String,
    pub base_url: String,
    pub api_key: String,
    pub context_window: u64,
    pub messages: Vec<ChatMessage>,
    /// 角色动作 roleKey（P2.5 通道就绪；P2.6 在此基础上由后端拼装双层提示词）
    pub role_key: Option<String>,
}

/// context_window 为 0/负值（用户未配置）时的缺省窗口。
pub const DEFAULT_CONTEXT_WINDOW: u64 = 128_000;

/// 停止语义：cancel 置位后统一转换为 stopped-done（不发 error 帧）。
pub const STOPPED: &str = "已停止";

/// 流式对话编排（§6.9 截断 + 重试 + SSE→通知帧）。
///
/// `emit` 为通知帧发送器（event ∈ chunk|done|error）；
/// `cancel` 为停止标志（B7：stopStream 置位后尽快收尾）；
/// 返回值为 JSON-RPC 响应帧的 result（成功）或错误消息（失败）。
pub fn stream_chat(
    params: &StreamParams,
    emit: &mut dyn FnMut(&str, Value),
    cancel: &AtomicBool,
) -> Result<Value, String> {
    // §6.9：上下文估算与截断
    let trim = context::trim_messages(&params.messages, params.context_window);
    let msg_values: Vec<Value> = trim
        .kept
        .iter()
        .map(|m| json!({"role": m.role, "content": m.content}))
        .collect();
    let cfg = ProviderConfig {
        provider: params.provider.clone(),
        model_id: params.model_id.clone(),
        base_url: params.base_url.clone(),
        api_key: params.api_key.clone(),
    };
    let built = provider::build_request(&cfg, &msg_values);

    // 有限重试：连接错误/5xx/429 重试；读流中的错误归 Fatal（首块已到达，不重试）
    let result = retry::with_retry(
        |_| {
            // 每次尝试前检查停止标志（含重试间隙后）
            if cancel.load(Ordering::Relaxed) {
                return Attempt::Fatal(STOPPED.to_string());
            }
            attempt_stream(&built, &params.provider, emit, cancel)
        },
        retry::MAX_RETRIES,
        &retry::BACKOFFS,
        &mut std::thread::sleep,
    );

    // B7：停止优先于错误/正常结束 —— 统一发 stopped-done，响应为成功停止
    if cancel.load(Ordering::Relaxed) {
        emit("done", json!({ "stopped": true }));
        return Ok(json!({ "ok": true, "stopped": true }));
    }

    match result {
        Ok(()) => {
            // done 帧 data 附带省略计数，供前端提示「已省略 N 条早期消息」
            let data = json!({ "omitted": trim.omitted });
            emit("done", data.clone());
            Ok(json!({ "ok": true, "omitted": trim.omitted }))
        }
        Err(e) => {
            emit("error", json!({ "message": e }));
            Err(e)
        }
    }
}

/// 等待响应头（首字节 TTFB）上限（秒）：思考型模型生成首 token 前可静默
/// 数十秒。ureq 2.x 仅支持 agent 级 timeout_read（无 per-request / reader
/// 分离 API），该值同时是读循环的唤醒间隔——停止响应性由读循环每个
/// chunk 到达后的 cancel 检查兜底（见 attempt_stream）。
const TTFB_TIMEOUT_SECS: u64 = 60;

/// 单次流式尝试：建连 → 响应分类 → 读循环（SSE 解析 + 通知帧输出）。
/// 成功返回后由 with_retry 判定；读循环内任何错误都是 Fatal（不可重试）。
fn attempt_stream(
    built: &BuiltRequest,
    provider_name: &str,
    emit: &mut dyn FnMut(&str, Value),
    cancel: &AtomicBool,
) -> Attempt<()> {
    if cancel.load(Ordering::Relaxed) {
        return Attempt::Fatal(STOPPED.to_string());
    }
    // 读超时双职责（ureq 2.x 仅 agent 级 timeout_read，无法分离两段）：既是
    // 等待响应头（TTFB）上限，也是读循环唤醒间隔。旧值 1s 会把思考型模型
    // 的首字节静默误判为连接失败并触发重试（2026-11-11 回归）。
    let agent = ureq::AgentBuilder::new()
        .timeout_read(std::time::Duration::from_secs(TTFB_TIMEOUT_SECS))
        .build();
    let mut request = agent.post(&built.url);
    for (k, v) in &built.headers {
        request = request.set(k, v);
    }
    let resp = match request.send_string(&built.body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            // 读完 body 释放连接后按状态码分类
            let _ = r.into_string();
            return classify_status(code);
        }
        Err(e) => return Attempt::Retryable(format!("连接失败: {}", e)),
    };

    // 响应头已 OK：进入读循环，此后错误一律 Fatal
    let mut reader = BufReader::new(resp.into_reader());
    let mut parser = SseParser::new();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            // 上游正常关流 = 流结束
            Ok(0) => return Attempt::Success(()),
            Ok(n) => match parser.feed(&buf[..n]) {
                Ok(items) => {
                    for item in items {
                        let SseItem::Data(data) = item;
                        match parse_sse_data(provider_name, &data) {
                            StreamTick::Delta(text) => emit("chunk", json!({ "text": text })),
                            StreamTick::Finish => return Attempt::Success(()),
                            StreamTick::Error(m) => return Attempt::Fatal(m),
                            StreamTick::Ignore => {}
                        }
                    }
                    // 有数据到达说明流活跃：此处检查停止标志使停止即时生效，
                    // 不再依赖读超时唤醒（TTFB_TIMEOUT_SECS 间隔过长）
                    if cancel.load(Ordering::Relaxed) {
                        return Attempt::Fatal(STOPPED.to_string());
                    }
                }
                // 64KB 上限：该行已丢弃，自愈后继续读（与内置实现语义一致）
                Err(SseError::Overflow) => {
                    emit("error", json!({ "message": "上游单行响应超过 64KB 上限，已丢弃该行" }));
                }
            },
            // 读超时唤醒：检查停止标志后继续读（SSE 解析器状态保持，不丢数据）
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                if cancel.load(Ordering::Relaxed) {
                    return Attempt::Fatal(STOPPED.to_string());
                }
                continue;
            }
            Err(e) => return Attempt::Fatal(format!("读取上游响应失败: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_status_matrix() {
        assert_eq!(classify_status(200), Attempt::Success(()));
        assert_eq!(classify_status(201), Attempt::Success(()));
        assert_eq!(classify_status(500), Attempt::Retryable("500".into()));
        assert_eq!(classify_status(502), Attempt::Retryable("502".into()));
        assert_eq!(classify_status(503), Attempt::Retryable("503".into()));
        assert_eq!(classify_status(429), Attempt::Retryable("429".into()));
        assert_eq!(classify_status(400), Attempt::Fatal("400".into()));
        assert_eq!(classify_status(401), Attempt::Fatal("401".into()));
        assert_eq!(classify_status(404), Attempt::Fatal("404".into()));
    }

    #[test]
    fn openai_ticks() {
        assert_eq!(parse_sse_data("openai", "[DONE]"), StreamTick::Finish);
        assert_eq!(
            parse_sse_data("openai", r#"{"choices":[{"delta":{"content":"你好"}}]}"#),
            StreamTick::Delta("你好".into())
        );
        assert_eq!(
            parse_sse_data("openai", r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#),
            StreamTick::Finish
        );
        // 心跳/其他载荷
        assert_eq!(
            parse_sse_data("openai", r#"{"choices":[{"delta":{"role":"assistant"}}]}"#),
            StreamTick::Ignore
        );
    }

    #[test]
    fn anthropic_ticks() {
        assert_eq!(
            parse_sse_data(
                "anthropic",
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"世"}} "#,
            ),
            StreamTick::Delta("世".into())
        );
        assert_eq!(
            parse_sse_data("anthropic", r#"{"type":"message_stop"}"#),
            StreamTick::Finish
        );
        assert_eq!(
            parse_sse_data("anthropic", r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#),
            StreamTick::Finish
        );
        assert_eq!(
            parse_sse_data(
                "anthropic",
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            ),
            StreamTick::Error("Overloaded".into())
        );
        // message_start / ping / content_block_start 等忽略
        assert_eq!(
            parse_sse_data("anthropic", r#"{"type":"ping"}"#),
            StreamTick::Ignore
        );
    }

    #[test]
    fn google_ticks() {
        assert_eq!(
            parse_sse_data(
                "google",
                r#"{"candidates":[{"content":{"parts":[{"text":"早上"}]}}]}"#,
            ),
            StreamTick::Delta("早上".into())
        );
        // 同候选多 parts 拼接
        assert_eq!(
            parse_sse_data(
                "google",
                r#"{"candidates":[{"content":{"parts":[{"text":"早"},{"text":"上"}]}}]}"#,
            ),
            StreamTick::Delta("早上".into())
        );
        assert_eq!(
            parse_sse_data("google", r#"{"candidates":[{"finishReason":"STOP"}]}"#),
            StreamTick::Finish
        );
        assert_eq!(parse_sse_data("google", "{}"), StreamTick::Ignore);
    }

    /// 非法 JSON 载荷 → Error 决策（编排层据此发 error 帧终止）。
    #[test]
    fn malformed_payload_becomes_error_tick() {
        assert!(matches!(
            parse_sse_data("openai", "{not json"),
            StreamTick::Error(_)
        ));
    }

    /// 慢 TTFB mock 上游：收到请求后延迟 `delay` 才返回 status line + SSE 流
    /// （模拟思考型模型「首字节前长时间静默」）。
    fn spawn_slow_ttfb_server(delay: std::time::Duration) -> String {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            // 单次尝试：accept 一次即可（重试在外层 with_retry）
            let (mut sock, _) = listener.accept().expect("accept");
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf); // 读掉请求头（不解析）
            std::thread::sleep(delay);
            let body = concat!(
                r#"data: {"choices":[{"delta":{"content":"早"}}]}"#,
                "\n\n",
                "data: [DONE]\n\n"
            );
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n{body}");
            let _ = sock.write_all(resp.as_bytes());
        });
        format!("http://{addr}")
    }

    /// 回归（2026-11-11）：等待响应头（首字节）不得被读唤醒间隔约束。
    /// TTFB 2.5s（> 旧 1s 读超时）必须仍能成功收流，而不是误报「连接失败」。
    #[test]
    fn slow_ttfb_stream_still_succeeds() {
        let base = spawn_slow_ttfb_server(std::time::Duration::from_millis(2500));
        let cfg = ProviderConfig {
            provider: "openai".into(),
            model_id: "test-model".into(),
            base_url: base,
            api_key: "k".into(),
        };
        let built = provider::build_request(&cfg, &[json!({"role": "user", "content": "hi"})]);
        let mut chunks: Vec<String> = Vec::new();
        let mut emit = |_event: &str, v: Value| {
            if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                chunks.push(t.to_string());
            }
        };
        let cancel = AtomicBool::new(false);
        let result = attempt_stream(&built, "openai", &mut emit, &cancel);
        assert!(
            matches!(result, Attempt::Success(())),
            "慢 TTFB 不应导致流失败: {result:?}"
        );
        assert_eq!(chunks, vec!["早".to_string()]);
    }
}
