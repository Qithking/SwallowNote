// Rust 后端示例：stdin/stdout JSON-RPC 2.0 长驻子进程
//
// 通信约定（见 docs/plugin-system/backend.md）：
//  - stdin：宿主按行写入 JSON-RPC 请求，每行一个 JSON 对象
//    例如：{"jsonrpc":"2.0","id":1,"method":"count_words","params":{"text":"hello world"}}
//  - stdout：子进程按行返回 JSON-RPC 响应
//    例如：{"jsonrpc":"2.0","id":1,"result":4}
//  - stderr：日志输出，宿主自动加 [plugin:<id>] 前缀转发
//
// 支持的命令：
//  - count_words({ text }) -> number   统计单词数
//  - parse_json({ data })  -> object   解析 JSON 字符串，返回解析结果
//
// 生命周期：宿主首次调用时按需 spawn，之后长驻内存；空闲 10 分钟被 idle_reaper 回收。

use std::io::{self, BufRead, Write};

fn main() {
    eprintln!(
        "[backend] starting up, plugin_id={}",
        std::env::args().nth(1).unwrap_or_default()
    );

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    // 按行读取 stdin：每行是一个 JSON-RPC 请求
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        // 解析 JSON-RPC 请求
        let req: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                // 解析失败：返回 JSON-RPC parse error（id 为 null）
                let err = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": {"code": -32700, "message": format!("parse error: {}", e)}
                });
                writeln!(out, "{}", err).unwrap();
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(serde_json::Value::Null);

        // 分发到对应的处理函数
        let result = match method {
            "count_words" => {
                // 统计单词数：按空白字符切分后计数
                let text = params.get("text").and_then(|t| t.as_str()).unwrap_or("");
                serde_json::json!(text.split_whitespace().count())
            }
            "parse_json" => {
                // 解析 JSON 字符串：成功返回解析结果，失败返回 JSON-RPC error
                let data = params.get("data").and_then(|t| t.as_str()).unwrap_or("");
                match serde_json::from_str::<serde_json::Value>(data) {
                    Ok(v) => v,
                    Err(e) => {
                        // 解析失败：返回 internal error（-32603）
                        if let Some(id) = &id {
                            let err = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {"code": -32603, "message": format!("parse failed: {}", e)}
                            });
                            writeln!(out, "{}", err).unwrap();
                        }
                        continue;
                    }
                }
            }
            _ => {
                // 未知方法：返回 method not found（-32601）
                if let Some(id) = &id {
                    let err = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {"code": -32601, "message": format!("method '{}' not found", method)}
                    });
                    writeln!(out, "{}", err).unwrap();
                }
                continue;
            }
        };

        // 有 id 的是请求，需要返回响应；无 id 的是通知，忽略即可
        if let Some(id) = id {
            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result
            });
            writeln!(out, "{}", resp).unwrap();
        }
    }

    eprintln!("[backend] stdin EOF, exiting");
}
