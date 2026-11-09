//! AI 插件后端入口。
//!
//! 实现 JSON-RPC over stdin/stdout 协议，与宿主的 `invoke_plugin` 命令对接。
//! 每行 stdin 是一个 JSON-RPC 请求，每行 stdout 是一个 JSON-RPC 响应。
//!
//! 骨架阶段仅实现 `ping` 存活探测；LLM Provider 适配在 P2.2 实现。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

mod chat;
mod context;
mod provider;
mod retry;
mod sse;

/// JSON-RPC 2.0 请求。`id` 为 `Value` 以支持数字/字符串/null。
#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Value,
    method: String,
    // P2.2 起各命令会读取 params，骨架阶段暂未使用
    #[serde(default)]
    #[allow(dead_code)]
    params: Value,
}

/// JSON-RPC 2.0 成功响应。
#[derive(Serialize)]
struct JsonRpcSuccess {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

/// JSON-RPC 2.0 错误响应。
#[derive(Serialize)]
struct JsonRpcError {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcErrorDetail,
}

#[derive(Serialize)]
struct JsonRpcErrorDetail {
    code: i64,
    message: String,
}

fn main() {
    // JSON-RPC 主循环：逐行读取请求、写回响应
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                let resp = JsonRpcError {
                    jsonrpc: "2.0",
                    id: Value::Null,
                    error: JsonRpcErrorDetail {
                        code: -32700,
                        message: format!("解析错误: {}", e),
                    },
                };
                let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        // 流式命令返回 None：响应帧由 worker 线程异步写出
        if let Some(response) = dispatch(&req) {
            let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
            let _ = stdout.flush();
        }
    }
}

/// 命令分发：同步命令返回响应帧；流式命令 spawn worker 线程后返回 None，
/// 主循环继续读 stdin（支撑并发请求，为后续 stop 等命令留出通道）。
fn dispatch(req: &JsonRpcRequest) -> Option<Value> {
    let result = match req.method.as_str() {
        // 存活探测
        "ping" => Ok(serde_json::json!({ "pong": true })),
        // 流式对话（P2.2）：通知帧 + 响应帧均由 worker 写出
        "streamChat" => {
            let params = req.params.clone();
            let id = req.id.clone();
            std::thread::spawn(move || run_stream(&params, &id));
            return None;
        }
        m => Err(format!("未知方法: {}", m)),
    };

    let response = match result {
        Ok(value) => serde_json::to_value(JsonRpcSuccess {
            jsonrpc: "2.0",
            id: req.id.clone(),
            result: value,
        })
        .unwrap(),
        Err(msg) => {
            // 错误日志输出到 stderr，便于宿主侧诊断
            eprintln!("[ai-backend] {}: {}", req.method, msg);
            serde_json::to_value(JsonRpcError {
                jsonrpc: "2.0",
                id: req.id.clone(),
                error: JsonRpcErrorDetail {
                    code: -32000,
                    message: msg,
                },
            })
            .unwrap()
        }
    };
    Some(response)
}

/// 通知帧发送器（P1.1 协议）：宿主按 requestId 路由到对应的流式 Channel。
fn make_emit(id: &Value) -> impl FnMut(&str, Value) {
    let id = id.clone();
    move |event: &str, data: Value| {
        let frame = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "swallow/stream",
            "params": { "requestId": id, "event": event, "data": data },
        });
        let mut stdout = io::stdout();
        let _ = writeln!(stdout, "{}", serde_json::to_string(&frame).unwrap());
        let _ = stdout.flush();
    }
}

/// streamChat worker：截断 → 载荷 → 重试请求 → SSE 解析 → 通知帧，最后写终结响应帧。
fn run_stream(params: &Value, id: &Value) {
    let response = match serde_json::from_value::<chat::StreamParams>(params.clone()) {
        Ok(p) => {
            let mut emit = make_emit(id);
            match chat::stream_chat(&p, &mut emit) {
                Ok(result) => serde_json::to_value(JsonRpcSuccess {
                    jsonrpc: "2.0",
                    id: id.clone(),
                    result,
                })
                .unwrap(),
                Err(msg) => serde_json::to_value(JsonRpcError {
                    jsonrpc: "2.0",
                    id: id.clone(),
                    error: JsonRpcErrorDetail {
                        code: -32000,
                        message: msg,
                    },
                })
                .unwrap(),
            }
        }
        Err(e) => serde_json::to_value(JsonRpcError {
            jsonrpc: "2.0",
            id: id.clone(),
            error: JsonRpcErrorDetail {
                code: -32602,
                message: format!("参数错误: {}", e),
            },
        })
        .unwrap(),
    };
    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
    let _ = stdout.flush();
}
