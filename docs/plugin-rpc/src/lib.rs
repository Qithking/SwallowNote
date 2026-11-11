//! # swallow-plugin-rpc
//!
//! SwallowNote 插件后端共享 RPC 层：JSON-RPC 2.0 over stdin/stdout 协议骨架。
//!
//! 现有 4 个含 Rust 后端的插件（secret-disk / wenyan / export / ai）各自
//! 手写同构协议代码（struct + 主循环 + 分发），本 crate 将其收敛为一份实现，
//! 插件以 path 依赖引入后 `main` 收敛为约 30 行（见 `examples/echo.rs`）。
//!
//! ## 协议行为（与现有插件 main.rs 逐字节等价）
//!
//! - stdin 逐行读取：`trim` 后空行跳过；读取失败（EOF/错误）退出循环。
//! - 解析失败回 `-32700` 帧：`id` 恒为 `null`，message 为
//!   `解析错误: <serde_json 错误>`（对齐 secret-disk/ai 前缀）。
//! - 每帧响应一行写出并立即 flush；成功帧 `{"jsonrpc","id","result"}`、
//!   错误帧 `{"jsonrpc","id","error":{code,message[,data]}}`。
//! - `id`（数字/字符串/null）在响应中原样回显；未知 method 的错误形态
//!   由各插件 backend 自行决定（现状：secret-disk/ai 用 -32000
//!   `未知方法: {}`，wenyan/export 用 -32601 `Method not found: {}`）。
//!
//! ## 接入
//!
//! 同步插件只需实现 [`PluginBackend::handle`]；流式插件另覆写
//! [`PluginBackend::dispatch`]（返回 `None` 表示响应由 worker 异步写出，
//! 对齐 ai 插件 streamChat 模式），并用 [`make_emit`]（通知帧）与
//! [`StreamRegistry`]（取消/并发上限）支撑流式生命周期。

mod params;
mod protocol;
mod registry;
mod stream;

pub use params::{meta_field, opt_field, s_field};
pub use protocol::{
    JsonRpcError, JsonRpcErrorDetail, JsonRpcRequest, JsonRpcSuccess, RpcError, INTERNAL_ERROR,
    INVALID_PARAMS, METHOD_NOT_FOUND, PARSE_ERROR, PLUGIN_ERROR,
};
pub use registry::{StreamRegistry, MAX_CONCURRENT_STREAMS};
pub use stream::{make_emit, stream_frame, STREAM_METHOD};

use serde_json::Value;
use std::io::{self, BufRead, Write};

/// 插件后端命令分发 trait。
pub trait PluginBackend {
    /// 同步处理一条命令：`Ok` 写成功帧，`Err` 写错误帧。
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError>;

    /// 命令分发钩子：返回 `Some(结果)` 时主循环立即写响应帧；
    /// 返回 `None` 表示不写（流式命令在 worker 线程异步写终结帧，
    /// 对齐 ai 插件 streamChat「分发期 spawn worker + 注册表登记」模式）。
    /// `id` 为本次请求的 JSON-RPC id——流式登记（`StreamRegistry`）与
    /// 通知帧路由（`make_emit`）均以它为键。默认实现全部按同步处理，
    /// 同步插件无需覆写。
    fn dispatch(
        &mut self,
        id: &Value,
        method: &str,
        params: &Value,
    ) -> Option<Result<Value, RpcError>> {
        let _ = id;
        Some(self.handle(method, params))
    }

    /// 命令处理出错回调（主循环写错误帧之前触发）。用于保留各插件
    /// 现有的 stderr 错误日志行为（如 ai 的 `[ai-backend] {method}: {msg}`）；
    /// 默认静默。流式 `dispatch` 返回 `None` 的路径不经过本回调，
    /// worker 自行负责日志。
    fn on_error(&mut self, _method: &str, _error: &RpcError) {}
}

/// 处理单行输入，返回应写出的响应行（`None` = 不写：空行或流式延后）。
/// 纯函数：主循环与测试共用，保证行为一致。
pub fn process_line<B: PluginBackend>(backend: &mut B, line: &str) -> Option<String> {
    // 与现有 main.rs 一致：trim 后空行跳过。
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // 解析失败回 -32700：id 恒为 null（没看到合法请求，无从回显）。
    let req: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return Some(
                serde_json::to_string(&JsonRpcError::new(
                    Value::Null,
                    RpcError::parse(format!("解析错误: {}", e)),
                ))
                .unwrap(),
            );
        }
    };

    match backend.dispatch(&req.id, &req.method, &req.params) {
        Some(Ok(result)) => Some(
            serde_json::to_string(&JsonRpcSuccess::new(req.id, result)).unwrap(),
        ),
        Some(Err(err)) => {
            backend.on_error(&req.method, &err);
            Some(serde_json::to_string(&JsonRpcError::new(req.id, err)).unwrap())
        }
        // 流式命令：响应帧由 worker 异步写出。
        None => None,
    }
}

/// JSON-RPC 主循环：stdin 逐行 → 解析（失败回 -32700）→ 分发 →
/// stdout 一行一帧 + flush。行为与现有插件 main.rs 完全一致。
pub fn run<B: PluginBackend>(mut backend: B) {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if let Some(response) = process_line(&mut backend, &line) {
            let _ = writeln!(stdout, "{}", response);
            let _ = stdout.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// 同步 mock：ping/echo/boom/未知方法（对齐 secret-disk 错误形态）。
    struct Mock;
    impl PluginBackend for Mock {
        fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
            match method {
                "ping" => Ok(json!({ "pong": true })),
                "echo" => Ok(params.clone()),
                "boom" => Err(RpcError::plugin(PLUGIN_ERROR, "boom!")),
                _ => Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", method))),
            }
        }
    }

    /// 流式 mock：stream 命令延后（不写帧），其余转 handle；
    /// 记录 on_error 调用。
    struct Deferring {
        deferred: bool,
        errors: Rc<RefCell<Vec<String>>>,
    }
    impl PluginBackend for Deferring {
        fn handle(&mut self, method: &str, _params: &Value) -> Result<Value, RpcError> {
            Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", method)))
        }
        fn dispatch(
            &mut self,
            id: &Value,
            method: &str,
            params: &Value,
        ) -> Option<Result<Value, RpcError>> {
            match method {
                "stream" => {
                    self.deferred = true;
                    let _ = id;
                    None
                }
                m => Some(self.handle(m, params)),
            }
        }
        fn on_error(&mut self, method: &str, error: &RpcError) {
            self.errors.borrow_mut().push(format!("{}: {}", method, error.message));
        }
    }

    /// 同步分发：成功/回显/错误帧形态与字段顺序。
    #[test]
    fn dispatch_success_and_error_frames() {
        let mut b = Mock;
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":null}"#)
                .unwrap(),
            r#"{"jsonrpc":"2.0","id":1,"result":{"pong":true}}"#
        );
        // 错误帧：struct 声明序 jsonrpc,id,error{code,message}。
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":2,"method":"boom"}"#).unwrap(),
            r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"boom!"}}"#
        );
    }

    /// 未知 method：错误形态由 backend 决定（此处为 -32000 未知方法）。
    #[test]
    fn unknown_method_shape() {
        let mut b = Mock;
        let line = process_line(&mut b, r#"{"jsonrpc":"2.0","id":3,"method":"nope"}"#).unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["error"]["code"], -32000);
        assert_eq!(v["error"]["message"], "未知方法: nope");
        assert_eq!(v["id"], 3);
    }

    /// -32700 解析错误帧：id 为 null、code 为 -32700、message 带前缀。
    #[test]
    fn parse_error_frame() {
        let mut b = Mock;
        let line = process_line(&mut b, "not json").unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], Value::Null);
        assert_eq!(v["error"]["code"], -32700);
        assert!(
            v["error"]["message"].as_str().unwrap().starts_with("解析错误: "),
            "实际: {}",
            v["error"]["message"]
        );
    }

    /// 空行/纯空白行跳过（返回 None，不写帧）。
    #[test]
    fn blank_lines_skipped() {
        let mut b = Mock;
        assert_eq!(process_line(&mut b, ""), None);
        assert_eq!(process_line(&mut b, "   \t "), None);
    }

    /// id 三种类型（数字/字符串/null）在响应中原样回显；
    /// 缺 params 字段时按 Null 处理不报错。
    #[test]
    fn id_echo_and_missing_params() {
        let mut b = Mock;
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":"req-9","method":"echo","params":{"x":1}}"#)
                .unwrap(),
            r#"{"jsonrpc":"2.0","id":"req-9","result":{"x":1}}"#
        );
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":null,"method":"echo","params":[1]}"#)
                .unwrap(),
            r#"{"jsonrpc":"2.0","id":null,"result":[1]}"#
        );
        // 缺 params：default 为 Null，命令收到 Null 不报解析错误。
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":5,"method":"echo"}"#).unwrap(),
            r#"{"jsonrpc":"2.0","id":5,"result":null}"#
        );
    }

    /// 流式 dispatch 返回 None：不写帧；同步错误路径触发 on_error 回调。
    #[test]
    fn defer_and_on_error_hook() {
        let errors = Rc::new(RefCell::new(Vec::new()));
        let mut b = Deferring { deferred: false, errors: Rc::clone(&errors) };

        // 流式命令：分发后无帧写出。
        assert_eq!(
            process_line(&mut b, r#"{"jsonrpc":"2.0","id":1,"method":"stream"}"#),
            None
        );
        assert!(b.deferred);

        // 同步命令出错：写出错误帧且 on_error 被调用。
        let frame = process_line(&mut b, r#"{"jsonrpc":"2.0","id":2,"method":"nope"}"#).unwrap();
        assert!(frame.contains(r#""code":-32000"#));
        assert_eq!(*errors.borrow(), vec!["nope: 未知方法: nope".to_string()]);
    }
}
