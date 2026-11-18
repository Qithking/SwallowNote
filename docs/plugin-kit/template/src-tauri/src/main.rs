//! __PLUGIN_NAME__ 插件 Rust 后端。
//!
//! 宿主以子进程方式拉起本二进制，经 stdin/stdout 交换 JSON-RPC 帧
//! （协议由 swallow-plugin-rpc 封装，源码见仓库 docs/plugin-rpc）。
//! 本示例实现一个 echo 命令：原样返回收到的 message 字段。

use swallow_plugin_rpc::{run, PluginBackend, RpcError};

/// 最小后端实现：echo 命令回显消息，未知命令返回方法不存在错误。
struct EchoBackend;

impl PluginBackend for EchoBackend {
    fn handle(&mut self, method: &str, params: &serde_json::Value) -> Result<serde_json::Value, RpcError> {
        match method {
            // echo：回显 message 字段（前端 invokeBackend('echo', {...}) 对应这里）
            "echo" => Ok(serde_json::json!({
                "message": params.get("message").cloned().unwrap_or(serde_json::Value::Null),
            })),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

fn main() {
    // 阻塞式主循环：读请求帧 → 分发 handle() → 写响应帧
    run(EchoBackend);
}
