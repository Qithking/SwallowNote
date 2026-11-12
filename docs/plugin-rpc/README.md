# swallow-plugin-rpc

SwallowNote 插件后端共享 RPC 层：把 4 个插件各自手写的 stdin/stdout
JSON-RPC 2.0 协议骨架（~80 行/插件 + ai 的 ~200 行流式代码）收敛为一个
path 依赖的 crate。协议行为与现有插件 main.rs 逐字节等价，宿主零改动。

## 插件接入

**1. Cargo.toml 加 path 依赖**（与 SDK `file:` 模式一致，不引入 workspace）：

```toml
[dependencies]
swallow-plugin-rpc = { path = "../../docs/plugin-rpc" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**2. main.rs 收敛为 ~30 行**：

```rust
use serde_json::{json, Value};
use swallow_plugin_rpc::{run, PluginBackend, RpcError, s_field, PLUGIN_ERROR};

struct SecretDiskBackend { /* 你的状态字段 */ }

impl PluginBackend for SecretDiskBackend {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "unlock"  => cmd_unlock(self, &s_field(params, "password")),
            "list_children" => cmd_list_children(self, params),
            // 未知方法：错误形态由插件自定（secret-disk 惯例 -32000）
            m => Err(RpcError::plugin(PLUGIN_ERROR, format!("未知方法: {}", m))),
        }
    }
}

fn main() {
    let state = State::new().expect("初始化失败");
    run(SecretDiskBackend { state });
}
```

主循环行为（`run`，与现有 main.rs 一致）：stdin 逐行 → trim 跳空行 →
解析失败回 `-32700`（`id:null`，`解析错误: <serde 错误>`）→
`dispatch` → 成功帧 `{"jsonrpc":"2.0","id","result"}` / 错误帧
`{"jsonrpc":"2.0","id","error":{code,message}}` → 每行一帧写出并 flush；
`id`（数字/字符串/null）原样回显。

## 错误码约定

| 常量 | 值 | 用途 |
|---|---|---|
| `PARSE_ERROR` | -32700 | stdin 行非法 JSON（主循环自动处理） |
| `METHOD_NOT_FOUND` | -32601 | 方法不存在（wenyan/export 惯例） |
| `INVALID_PARAMS` | -32602 | 参数无效 |
| `INTERNAL_ERROR` | -32603 | 内部错误 |
| `PLUGIN_ERROR` | -32000 | 插件通用错误（secret-disk/ai 惯例） |

-32000 保留为通用插件错误；插件自定义应用码建议放 `error.data`
（`RpcError::plugin(1001, "…").with_data(json!({...}))`，序列化时
`data` 为 `None` 不输出该键，保持现有帧形态）。

## 流式命令（ai 插件模式）

覆写 `dispatch`：流式命令登记 `StreamRegistry` 并 spawn worker 后返回
`None`（主循环不写帧，主循环继续读 stdin 支撑 stopStream）；
worker 用 `make_emit` 写 `swallow/stream` 通知帧，结束时写终结响应帧并
`unregister` 释放名额：

```rust
fn dispatch(&mut self, id: &Value, method: &str, params: &Value) -> Option<Result<Value, RpcError>> {
    match method {
        "streamChat" => {
            // id 即本次请求的 JSON-RPC id：registry 与 emit 均以它为键
            let cancel = match registry.register(&id.to_string()) {
                Ok(c) => c,
                Err(msg) => return Some(Err(RpcError::plugin(PLUGIN_ERROR, msg))),
            };
            std::thread::spawn(move || { /* make_emit(&id) + 终结帧 + unregister */ });
            None // 主循环不写帧，继续读 stdin（支撑 stopStream）
        }
        "stopStream" => Some(Ok(json!({ "cancelled": registry.cancel(/*requestId*/) }))),
        _ => Some(self.handle(method, params)),
    }
}
```

- 通知帧：`{"jsonrpc":"2.0","method":"swallow/stream",
  "params":{"requestId":<id>,"event":"chunk|done|error","data":…}}`，
  宿主按 `requestId` 路由，event 仅接受白名单。
- 取消生效：worker 在读循环检查 `register` 返回的 `AtomicBool`；阻塞读
  （如 ureq）配短 `timeout_read` 周期醒来检查即可尽快收尾。
- `StreamRegistry::register` 的错误消息与 ai 插件现状一致
  （`并发流已达上限(4), …` / `相同请求的流已在进行中`），会原样进入
  错误响应帧 message。

## 其余导出

`JsonRpcRequest` / `JsonRpcSuccess` / `JsonRpcError` / `JsonRpcErrorDetail`（协议结构）、
`process_line`（单行处理纯函数，测试可复用）、`s_field` / `opt_field` / `meta_field`
（参数提取）、`stream_frame` / `STREAM_METHOD`、`MAX_CONCURRENT_STREAMS`。

完整可运行示例见 `examples/echo.rs`（`cargo run --example echo`）；
协议等价性断言见 `tests/protocol.rs`。
