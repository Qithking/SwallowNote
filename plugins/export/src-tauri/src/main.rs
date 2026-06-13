/**
 * SwallowNote Export Plugin — Backend binary
 *
 * Implements the JSON-RPC over stdin/stdout protocol that the host's
 * `invoke_plugin` command expects. Each line on stdin is a JSON-RPC
 * request; each line on stdout is a JSON-RPC response.
 *
 * Supported methods:
 *   - "markdown_to_docx" — params: { "markdown": string }
 *     Returns: { "result": "<base64-encoded-docx>" }
 *   - "markdown_to_html"  — params: { "markdown": string }
 *     Returns: { "result": "<html-string>" }
 */
mod convert;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

/// JSON-RPC 2.0 request
#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC 2.0 success response
#[derive(Serialize)]
struct JsonRpcSuccess {
    jsonrpc: &'static str,
    id: u64,
    result: Value,
}

/// JSON-RPC 2.0 error response
#[derive(Serialize)]
struct JsonRpcError {
    jsonrpc: &'static str,
    id: u64,
    error: JsonRpcErrorDetail,
}

#[derive(Serialize)]
struct JsonRpcErrorDetail {
    code: i64,
    message: String,
}

fn main() {
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
                    id: 0,
                    error: JsonRpcErrorDetail {
                        code: -32700,
                        message: format!("Parse error: {}", e),
                    },
                };
                let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        let response = handle_request(&req);
        let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
        let _ = stdout.flush();
    }
}

fn handle_request(req: &JsonRpcRequest) -> Value {
    match req.method.as_str() {
        "markdown_to_docx" => {
            let markdown = req
                .params
                .get("markdown")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match convert::markdown_to_docx(markdown.to_string()) {
                Ok(b64) => {
                    let resp = JsonRpcSuccess {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: Value::String(b64),
                    };
                    serde_json::to_value(resp).unwrap()
                }
                Err(e) => {
                    let resp = JsonRpcError {
                        jsonrpc: "2.0",
                        id: req.id,
                        error: JsonRpcErrorDetail {
                            code: -1,
                            message: e.to_string(),
                        },
                    };
                    serde_json::to_value(resp).unwrap()
                }
            }
        }
        "markdown_to_html" => {
            let markdown = req
                .params
                .get("markdown")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match convert::markdown_to_html(markdown.to_string()) {
                Ok(html) => {
                    let resp = JsonRpcSuccess {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: Value::String(html),
                    };
                    serde_json::to_value(resp).unwrap()
                }
                Err(e) => {
                    let resp = JsonRpcError {
                        jsonrpc: "2.0",
                        id: req.id,
                        error: JsonRpcErrorDetail {
                            code: -1,
                            message: e.to_string(),
                        },
                    };
                    serde_json::to_value(resp).unwrap()
                }
            }
        }
        _ => {
            let resp = JsonRpcError {
                jsonrpc: "2.0",
                id: req.id,
                error: JsonRpcErrorDetail {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                },
            };
            serde_json::to_value(resp).unwrap()
        }
    }
}
