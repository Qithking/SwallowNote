//! 密盘插件后端入口。
//!
//! JSON-RPC over stdin/stdout 协议骨架由 `swallow-plugin-rpc` crate 提供
//! （逐字节等价平移自本插件原 main.rs 手写实现），本文件只保留业务逻辑：
//! State 初始化、命令分发、`.swl.bak` 残留清理。
//! 每行 stdin 是一个 JSON-RPC 请求，每行 stdout 是一个 JSON-RPC 响应。
//!
//! 启动时自动清理 `.swl.bak` 残留文件（上次导入中断的产物）。

mod commands;
mod db;
mod models;
mod security;
mod state;

use serde_json::Value;
use swallow_plugin_rpc::{run, PluginBackend, RpcError, PLUGIN_ERROR};

use crate::state::State;

/// 密盘后端：持有全局 State，按 method 路由到 commands 模块。
struct SecretDiskBackend {
    state: State,
}

impl SecretDiskBackend {
    /// 统一把 commands 的 `Result<Value, String>` 转为 -32000 插件通用错误，
    /// 与迁移前 dispatch 的错误形态（code/-32000 + 原样 message）一致。
    fn call(
        &self,
        f: fn(&State, &Value) -> Result<Value, String>,
        params: &Value,
    ) -> Result<Value, RpcError> {
        f(&self.state, params).map_err(|msg| RpcError::plugin(PLUGIN_ERROR, msg))
    }
}

impl PluginBackend for SecretDiskBackend {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "init" => self.call(commands::cmd_init, params),
            "unlock" => self.call(commands::cmd_unlock, params),
            "lock" => self.call(commands::cmd_lock, params),
            "is_initialized" => self.call(commands::cmd_is_initialized, params),
            "is_unlocked" => self.call(commands::cmd_is_unlocked, params),
            "list_children" => self.call(commands::cmd_list_children, params),
            "create_item" => self.call(commands::cmd_create_item, params),
            "get_note" => self.call(commands::cmd_get_note, params),
            "update_note" => self.call(commands::cmd_update_note, params),
            "rename_item" => self.call(commands::cmd_rename_item, params),
            "delete_item" => self.call(commands::cmd_delete_item, params),
            "move_item" => self.call(commands::cmd_move_item, params),
            "backup" => self.call(commands::cmd_backup, params),
            "import_db" => self.call(commands::cmd_import_db, params),
            "change_password" => self.call(commands::cmd_change_password, params),
            // 未知方法：沿用本插件惯例 -32000「未知方法: {}」
            m => Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", m))),
        }
    }

    /// 命令出错时输出 stderr 日志（主循环写错误帧之前触发），
    /// 与迁移前 dispatch 的 `security::log_error(&req.method, &msg)` 行为一致。
    fn on_error(&mut self, method: &str, error: &RpcError) {
        security::log_error(method, &error.message);
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

    // JSON-RPC 主循环（stdin 逐行 → 分发 → stdout 一行一帧 + flush）。
    run(SecretDiskBackend { state });
}
