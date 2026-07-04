//! 密盘插件后端入口。
//!
//! 实现 JSON-RPC over stdin/stdout 协议，与宿主的 `invoke_plugin` 命令对接。
//! 每行 stdin 是一个 JSON-RPC 请求，每行 stdout 是一个 JSON-RPC 响应。
//!
//! 启动时自动清理 `.swl.bak` 残留文件（上次导入中断的产物）。

mod commands;
mod db;
mod models;
mod security;
mod state;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

use crate::state::State;

/// JSON-RPC 2.0 请求。`id` 为 `Value` 以支持数字/字符串/null。
#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
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
    // 初始化状态，解析数据库路径。
    let state = match State::new() {
        Ok(s) => s,
        Err(e) => {
            security::log_error("初始化", &e);
            // 致命错误：无法推导数据库路径，退出进程。
            std::process::exit(1);
        }
    };

    // 启动时清理 .swl.bak 残留文件。
    cleanup_bak_file(&state);

    // JSON-RPC 主循环。
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

        let response = dispatch(&state, &req);
        let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
        let _ = stdout.flush();
    }
}

/// 命令分发：根据 `method` 路由到对应的命令处理函数。
fn dispatch(state: &State, req: &JsonRpcRequest) -> Value {
    let result = match req.method.as_str() {
        "init" => commands::cmd_init(state, &req.params),
        "unlock" => commands::cmd_unlock(state, &req.params),
        "lock" => commands::cmd_lock(state, &req.params),
        "is_initialized" => commands::cmd_is_initialized(state, &req.params),
        "is_unlocked" => commands::cmd_is_unlocked(state, &req.params),
        "list_children" => commands::cmd_list_children(state, &req.params),
        "create_item" => commands::cmd_create_item(state, &req.params),
        "get_note" => commands::cmd_get_note(state, &req.params),
        "update_note" => commands::cmd_update_note(state, &req.params),
        "rename_item" => commands::cmd_rename_item(state, &req.params),
        "delete_item" => commands::cmd_delete_item(state, &req.params),
        "move_item" => commands::cmd_move_item(state, &req.params),
        "backup" => commands::cmd_backup(state, &req.params),
        "import_db" => commands::cmd_import_db(state, &req.params),
        "change_password" => commands::cmd_change_password(state, &req.params),
        _ => Err(format!("未知方法: {}", req.method)),
    };

    match result {
        Ok(value) => {
            let resp = JsonRpcSuccess {
                jsonrpc: "2.0",
                id: req.id.clone(),
                result: value,
            };
            serde_json::to_value(resp).unwrap()
        }
        Err(msg) => {
            // 错误日志输出到 stderr，不含敏感信息（命令内部已规避）。
            security::log_error(&req.method, &msg);
            let resp = JsonRpcError {
                jsonrpc: "2.0",
                id: req.id.clone(),
                error: JsonRpcErrorDetail {
                    code: -32000,
                    message: msg,
                },
            };
            serde_json::to_value(resp).unwrap()
        }
    }
}

/// 清理 `.swl.bak` 残留文件。
///
/// 规则（spec 安全加固要求）：
/// - 若 `.swl` 和 `.swl.bak` 都存在 → 删除 `.swl.bak`（视为上次导入中断的残留）
/// - 若只有 `.swl.bak` 存在（`.swl` 不存在）→ 恢复 `.swl.bak` 为 `.swl`
/// - 若只有 `.swl` 存在 → 无操作
fn cleanup_bak_file(state: &State) {
    let swl_path = state.db_path();
    let bak_path = swl_path.with_extension("swl.bak");

    let swl_exists = swl_path.exists();
    let bak_exists = bak_path.exists();

    if !bak_exists {
        return; // 无残留文件
    }

    if swl_exists {
        // .swl 和 .swl.bak 都存在：删除残留 .swl.bak。
        if let Err(e) = std::fs::remove_file(&bak_path) {
            security::log_info(&format!("清理 .swl.bak 失败: {}", e));
        } else {
            security::log_info("检测到上次导入残留 .swl.bak，已清理");
        }
    } else {
        // 只有 .swl.bak 存在：恢复为 .swl。
        if let Err(e) = std::fs::rename(&bak_path, swl_path) {
            security::log_info(&format!("恢复 .swl.bak 失败: {}", e));
        } else {
            security::log_info("检测到上次导入未完成，已恢复原数据库");
        }
    }
}
