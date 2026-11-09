//! AI 插件后端入口。
//!
//! 实现 JSON-RPC over stdin/stdout 协议，与宿主的 `invoke_plugin` 命令对接。
//! 每行 stdin 是一个 JSON-RPC 请求，每行 stdout 是一个 JSON-RPC 响应。
//!
//! 骨架阶段仅实现 `ping` 存活探测；LLM Provider 适配在 P2.2 实现。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::sync::atomic::AtomicBool;
use std::sync::OnceLock;

mod attachment;
mod chat;
mod context;
mod db;
mod import;
mod provider;
mod registry;
mod retry;
mod sse;

/// 进行中流式请求的注册表（B7：stopStream 取消 + 并发上限）。
static STREAMS: OnceLock<registry::StreamRegistry> = OnceLock::new();

fn streams() -> &'static registry::StreamRegistry {
    STREAMS.get_or_init(registry::StreamRegistry::new)
}

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
            let id = req.id.clone();
            // B7：登记流并获取取消标志；并发满或 id 重复时拒绝
            let cancel = match streams().register(&id.to_string()) {
                Ok(flag) => flag,
                Err(msg) => return Some(error_response(&req.id, msg)),
            };
            let params = req.params.clone();
            std::thread::spawn(move || {
                run_stream(&params, &id, &cancel);
                // 无论成功/失败/停止都注销，释放并发名额
                streams().unregister(&id.to_string());
            });
            return None;
        }
        // B7：请求停止进行中的流；cancelled=false 表示该流不存在或已结束
        "stopStream" => {
            let request_id = req.params.get("requestId").cloned().unwrap_or(Value::Null);
            Ok(serde_json::json!({ "cancelled": streams().cancel(&request_id.to_string()) }))
        }
        // P2.3：上游模型清单动态拉取（D11）；不涉及 ai.db，直接处理
        "fetchUpstreamModels" => provider::fetch_upstream_models(
            &s_field(&req.params, "provider"),
            &s_field(&req.params, "baseUrl"),
            &s_field(&req.params, "apiKey"),
        ),
        // P2.3 数据层：ai.db 五表 CRUD + 附件外置 + 老数据导入
        m => handle_data_command(m, &req.params),
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

/// 构造错误响应帧（分发期错误，如并发上限拒绝）。
fn error_response(id: &Value, message: String) -> Value {
    serde_json::to_value(JsonRpcError {
        jsonrpc: "2.0",
        id: id.clone(),
        error: JsonRpcErrorDetail {
            code: -32000,
            message,
        },
    })
    .unwrap()
}

// ---------- P2.3 数据层命令处理 ----------

/// 宿主注入的应用数据目录（plugin_invoke 启动后端时设置）。
fn app_data_dir() -> Result<std::path::PathBuf, String> {
    std::env::var("SWALLOWNOTE_APP_DATA_DIR")
        .map(std::path::PathBuf::from)
        .map_err(|_| "缺少 SWALLOWNOTE_APP_DATA_DIR 环境变量".to_string())
}

/// 取字符串参数（缺失按空串）。
fn s_field(p: &Value, key: &str) -> String {
    p.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 可选字符串参数（缺失或空串 → None）。
fn opt_field(p: &Value, key: &str) -> Option<String> {
    match p.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// metaJson 兼容：字符串直取；对象/数组序列化为字符串（存入 ai_messages.meta_json）。
fn meta_field(p: &Value, key: &str) -> Option<String> {
    match p.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(v @ (Value::Object(_) | Value::Array(_))) => Some(v.to_string()),
        _ => None,
    }
}

/// P2.3 数据层命令：打开 ai.db 执行，返回响应 result。
fn handle_data_command(method: &str, params: &Value) -> Result<Value, String> {
    let dir = app_data_dir()?;
    // 附件与导入需要目录路径；其余命令走 ai.db 连接
    match method {
        "saveAttachment" => {
            return attachment::save_attachment(
                &dir,
                &s_field(params, "messageId"),
                &s_field(params, "name"),
                &s_field(params, "contentBase64"),
            );
        }
        "readAttachment" => {
            return attachment::read_attachment(&dir, &s_field(params, "path"));
        }
        "finalizeLegacyImport" => {
            return import::finalize_legacy_import(&dir);
        }
        _ => {}
    }

    let conn = db::open_db(&dir)?;
    match method {
        // 会话
        "listSessions" => db::list_sessions(&conn),
        "createSession" => db::create_session(&conn, &s_field(params, "title")),
        "renameSession" => {
            db::rename_session(&conn, &s_field(params, "id"), &s_field(params, "title"))
        }
        "deleteSession" => db::delete_session(&conn, &s_field(params, "id")),
        // 消息
        "listMessages" => db::list_messages(&conn, &s_field(params, "sessionId")),
        "appendMessage" => db::append_message(
            &conn,
            &s_field(params, "sessionId"),
            &s_field(params, "role"),
            &s_field(params, "content"),
            opt_field(params, "displayText").as_deref(),
            opt_field(params, "roleKey").as_deref(),
            meta_field(params, "metaJson").as_deref(),
            params.get("createdAt").and_then(|v| v.as_i64()),
        ),
        // 角色提示词
        "listRolePrompts" => db::list_role_prompts(&conn),
        "saveRolePrompt" => db::save_role_prompt(
            &conn,
            &s_field(params, "roleKey"),
            &s_field(params, "name"),
            &s_field(params, "prompt"),
            params.get("isBuiltin").and_then(|v| v.as_bool()).unwrap_or(false),
            params.get("sortOrder").and_then(|v| v.as_i64()).unwrap_or(0),
        ),
        "deleteRolePrompt" => db::delete_role_prompt(&conn, &s_field(params, "roleKey")),
        // 模型（key 永不入库，见 db::save_model 注释）
        "listModels" => db::list_models(&conn),
        "saveModel" => db::save_model(
            &conn,
            opt_field(params, "id").as_deref(),
            &s_field(params, "name"),
            &s_field(params, "provider"),
            &s_field(params, "modelId"),
            &s_field(params, "baseUrl"),
            params.get("contextWindow").and_then(|v| v.as_i64()).unwrap_or(0),
        ),
        "deleteModel" => db::delete_model(&conn, &s_field(params, "id")),
        "setDefaultModel" => db::set_default_model(&conn, &s_field(params, "id")),
        // 设置
        "getSetting" => db::get_setting(&conn, &s_field(params, "key")),
        "setSetting" => db::set_setting(&conn, &s_field(params, "key"), &s_field(params, "value")),
        // 老数据导入（迁移文件 → ai.db，幂等保护）
        "importLegacyData" => import::import_legacy_data(&dir, &conn),
        m => Err(format!("未知方法: {}", m)),
    }
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
/// `cancel` 由注册表下发（B7）：stopStream 置位后流尽快收尾为 stopped-done。
fn run_stream(params: &Value, id: &Value, cancel: &AtomicBool) {
    let response = match serde_json::from_value::<chat::StreamParams>(params.clone()) {
        Ok(p) => {
            let mut emit = make_emit(id);
            match chat::stream_chat(&p, &mut emit, cancel) {
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
