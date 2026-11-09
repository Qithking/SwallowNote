//! AI 插件后端入口。
//!
//! 实现 JSON-RPC over stdin/stdout 协议，与宿主的 `invoke_plugin` 命令对接。
//! 每行 stdin 是一个 JSON-RPC 请求，每行 stdout 是一个 JSON-RPC 响应。
//!
//! 骨架阶段仅实现 `ping` 存活探测；LLM Provider 适配在 P2.2 实现。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

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

        let response = dispatch(&req);
        let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
        let _ = stdout.flush();
    }
}

/// 命令分发：根据 `method` 路由到对应的命令处理函数。
fn dispatch(req: &JsonRpcRequest) -> Value {
    let result = match req.method.as_str() {
        // 存活探测：骨架阶段唯一方法
        "ping" => Ok(serde_json::json!({ "pong": true })),
        _ => Err(format!("未知方法: {}", req.method)),
    };

    match result {
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
    }
}
