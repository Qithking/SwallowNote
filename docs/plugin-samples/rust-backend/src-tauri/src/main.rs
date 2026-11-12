// Rust 后端示例：基于 swallow-plugin-rpc 的同步 JSON-RPC 后端
//
// 协议骨架（stdin 逐行读取、-32700 解析错误、响应帧写出 + flush）由
// `swallow_plugin_rpc::run` 统一提供，插件只需实现 `PluginBackend::handle`。
//
// 支持的命令（与旧手写 stdin/stdout 循环版行为一致）：
//  - count_words({ text }) -> number   统计单词数（按空白切分）
//  - parse_json({ data })  -> object   解析 JSON 字符串，失败回 -32603
//  - 其他方法              -> -32601 method not found
//
// 生命周期：宿主首次调用时按需 spawn，之后长驻内存；空闲 10 分钟被 idle_reaper 回收。

use serde_json::{json, Value};
use swallow_plugin_rpc::{run, PluginBackend, RpcError, s_field};

struct RustBackendDemo;

impl PluginBackend for RustBackendDemo {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            // 统计单词数：按空白字符切分后计数；text 缺失/非字符串按空串（计数为 0）
            "count_words" => Ok(json!(s_field(params, "text").split_whitespace().count())),
            // 解析 JSON 字符串：成功返回解析结果，失败回内部错误（-32603）
            "parse_json" => serde_json::from_str::<Value>(&s_field(params, "data"))
                .map_err(|e| RpcError::internal(format!("parse failed: {}", e))),
            // 未知方法：-32601（wenyan/export 惯例）
            _ => Err(RpcError::method_not_found(format!(
                "method '{}' not found",
                method
            ))),
        }
    }
}

fn main() {
    eprintln!(
        "[backend] starting up, plugin_id={}",
        std::env::args().nth(1).unwrap_or_default()
    );
    run(RustBackendDemo);
}
