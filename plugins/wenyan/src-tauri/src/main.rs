/**
 * SwallowNote Wenyan Plugin — Backend binary
 *
 * Implements the JSON-RPC over stdin/stdout protocol that the host's
 * `invoke_plugin` command expects. Each line on stdin is a JSON-RPC
 * request; each line on stdout is a JSON-RPC response.
 *
 * Supported methods:
 *   - "push_to_gzh" — params: { app_id, app_secret, title, content, ... }
 *     Returns: { "media_id": "<draft-media-id>" }
 *
 * The `id` field is typed as `serde_json::Value` (rather than `u64`) so
 * we accept the full JSON-RPC 2.0 id space: numeric ids, string ids
 * (`"req-1"`), and `null` (notifications). The value is echoed verbatim
 * into every response so a caller can always correlate request and reply
 * regardless of the id type.
 */
mod gzh;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

/// JSON-RPC 2.0 request. `id` is typed as `serde_json::Value` for
/// spec compliance (accepts number / string / null per JSON-RPC 2.0).
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
        "push_to_gzh" => handle_push_to_gzh(req),
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

/// Extract push params from the JSON-RPC `params` object, call the
/// WeChat API, and return `{ media_id }` on success.
fn handle_push_to_gzh(req: &JsonRpcRequest) -> Value {
    let p = &req.params;

    let app_id = p
        .get("app_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let app_secret = p
        .get("app_secret")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title = p
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let content = p
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if app_id.is_empty() || app_secret.is_empty() {
        return error_response(req, gzh::ERR_ACCESS_TOKEN, "app_id 或 app_secret 为空");
    }
    if title.is_empty() {
        return error_response(req, gzh::ERR_ADD_DRAFT, "title 为空");
    }
    if content.is_empty() {
        return error_response(req, gzh::ERR_ADD_DRAFT, "content 为空");
    }

    let params = gzh::PushParams {
        app_id,
        app_secret,
        title,
        content,
        author: p
            .get("author")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        digest: p
            .get("digest")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        thumb_media_id: p
            .get("thumb_media_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        content_source_url: p
            .get("content_source_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        need_open_comment: p
            .get("need_open_comment")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        only_fans_can_comment: p
            .get("only_fans_can_comment")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        api_base_url: p
            .get("api_base_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };

    match gzh::push_to_gzh(params) {
        Ok(media_id) => {
            let result = serde_json::json!({ "media_id": media_id });
            let resp = JsonRpcSuccess {
                jsonrpc: "2.0",
                id: req.id.clone(),
                result,
            };
            serde_json::to_value(resp).unwrap()
        }
        Err(e) => error_response(req, e.code(), &e.display_with_code()),
    }
}

fn error_response(req: &JsonRpcRequest, code: i64, message: &str) -> Value {
    let resp = JsonRpcError {
        jsonrpc: "2.0",
        id: req.id.clone(),
        error: JsonRpcErrorDetail {
            code,
            message: message.to_string(),
        },
    };
    serde_json::to_value(resp).unwrap()
}
