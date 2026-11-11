//! README「插件接入方式」示例的可运行版本：同步 echo 后端。
//!
//! 试运行：`cargo run --example echo` 后手动输入 JSON-RPC 请求行；
//! 端到端断言见 `tests/protocol.rs`（本示例会被 `cargo test` 编译并 spawn）。

use serde_json::{json, Value};
use swallow_plugin_rpc::{run, PluginBackend, RpcError, PLUGIN_ERROR};

struct EchoBackend;

impl PluginBackend for EchoBackend {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            // 存活探测（对齐 ai 插件）
            "ping" => Ok(json!({ "pong": true })),
            // 原样回显参数
            "echo" => Ok(params.clone()),
            // 演示错误响应
            "boom" => Err(RpcError::plugin(PLUGIN_ERROR, "boom!")),
            // 未知方法：错误形态由 backend 自定（对齐 secret-disk：-32000）
            _ => Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", method))),
        }
    }
}

fn main() {
    run(EchoBackend);
}
