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
 *
 * The `id` field is typed as `serde_json::Value` (rather than
 * `u64`) so we accept the full JSON-RPC 2.0 id space: numeric
 * ids, string ids (`"req-1"`), and `null` (notifications). The
 * value is echoed verbatim into every response so a caller can
 * always correlate request and reply regardless of the id type.
 */
mod convert;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

/// JSON-RPC 2.0 request. `id` is typed as `serde_json::Value` for
/// spec compliance (accepts number / string / null per JSON-RPC
/// 2.0). The host's `invoke_plugin` currently only emits numeric
/// ids (it uses `Arc<AtomicU64>` for correlation; see
/// [`plugin_invoke.rs`](file:///Users/thking/code/codeBuddy/SwallowNote/src-tauri/src/commands/plugin_invoke.rs)),
/// so in practice we always receive a number. The `Value` pass
/// is a no-op safety net for future host changes — it costs
/// nothing today and means we don't have to revisit this code if
/// the host broadens its id type.
#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC 2.0 success response. `id` mirrors the request — its
/// type (number / string / null) is preserved end-to-end.
#[derive(Serialize)]
struct JsonRpcSuccess {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

/// JSON-RPC 2.0 error response. `id` is `Value::Null` for
/// parse-error responses (we never saw a request to echo).
#[derive(Serialize)]
struct JsonRpcError {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcErrorDetail,
}

#[derive(Serialize)]
struct JsonRpcErrorDetail {
    /// Standard JSON-RPC 2.0 codes for transport-level errors
    /// (-32700 parse, -32601 method-not-found), or our own
    /// application codes (1001 markdown too large, 1002 docx
    /// generation failed, 1003 html generation failed).
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
                    id: Value::Null,
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
                        id: req.id.clone(),
                        result: Value::String(b64),
                    };
                    serde_json::to_value(resp).unwrap()
                }
                Err(e) => {
                    let resp = JsonRpcError {
                        jsonrpc: "2.0",
                        id: req.id.clone(),
                        error: JsonRpcErrorDetail {
                            code: e.code(),
                            // The host drops `code` and only
                            // forwards `message` to the IPC layer,
                            // so we embed the code in the message
                            // string for the frontend to extract.
                            message: e.display_with_code(),
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
                        id: req.id.clone(),
                        result: Value::String(html),
                    };
                    serde_json::to_value(resp).unwrap()
                }
                Err(e) => {
                    let resp = JsonRpcError {
                        jsonrpc: "2.0",
                        id: req.id.clone(),
                        error: JsonRpcErrorDetail {
                            code: e.code(),
                            message: e.display_with_code(),
                        },
                    };
                    serde_json::to_value(resp).unwrap()
                }
            }
        }
        _ => {
            let resp = JsonRpcError {
                jsonrpc: "2.0",
                id: req.id.clone(),
                error: JsonRpcErrorDetail {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                },
            };
            serde_json::to_value(resp).unwrap()
        }
    }
}
