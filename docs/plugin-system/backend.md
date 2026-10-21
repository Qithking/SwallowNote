# Rust 后端（可选）

插件可以携带一个编译后的 Rust 二进制作为后端，通过 **JSON-RPC 2.0 over stdin/stdout** 与宿主通信。在需要高性能（解析大文件、跑复杂计算、调用系统 API）时使用。

后端**不是** Tauri command，也不依赖 Tauri 框架——它只是一个被宿主 spawn 的长驻子进程。

## 通信架构

```
┌───────────────┐   stdin (JSON-RPC 请求)    ┌─────────────────┐
│               │ ─────────────────────────▶ │                 │
│   SwallowNote │                            │  plugin_<id>    │
│    宿主进程    │   stdout (JSON-RPC 响应)   │  (Rust 二进制)   │
│               │ ◀───────────────────────── │                 │
└───────────────┘   stderr (日志)            └─────────────────┘
```

- **stdin**：宿主按行写入 JSON-RPC 请求，例如
  `{"jsonrpc":"2.0","id":1,"method":"count_words","params":{"text":"hello world"}}`
- **stdout**：子进程按行返回 JSON-RPC 响应，例如
  `{"jsonrpc":"2.0","id":1,"result":4}` 或
  `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"..."}}`。
  流式场景下还会输出**通知帧**（无 `id`、带 `method`），参见[流式调用](#流式调用)。
- **stderr**：子进程的日志输出，宿主会以 `[plugin:<id>] ...` 前缀 tee 到自己的日志。
- **每行一个 JSON 对象**，不要把多个请求/响应塞进同一行。

### 生命周期

- 宿主在第一次调用时按需 spawn 子进程，之后**长驻**内存（同一插件的多次调用复用同一进程）。
- 子进程空闲 **10 分钟**自动被 `idle_reaper` 回收（kill），下次调用时再重新拉起。
- 非流式调用超时 **30 秒**；连续超时 **3 次**会触发熔断，宿主主动 kill 后端进程，下次调用重新 spawn。
- **流式调用**采用独立超时模型：首块超时默认 **90 秒**（前端可用 `firstChunkTimeoutSecs` 覆盖，最小 1 秒），收到首个流事件后进入空闲模式——**块间空闲 60 秒**滚动续期，无总时长上限；流式超时**不计入**连续超时熔断。
- 子进程退出（stdout EOF）时，所有未完成的 pending 请求会被立即拒绝，进行中的流以 `error` 事件收尾。

### 调用链路

前端调用 `panel.invokeBackend('count_words', args)` 后：

1. 前端通过 `@tauri-apps/api/core` 的 `invoke('invoke_plugin', { pluginId, command, args })` 调到宿主。
2. 宿主的 `invoke_plugin` 命令（`src-tauri/src/commands/plugin_invoke.rs`）查找或 spawn 对应插件的子进程。
3. 宿主分配一个递增的 JSON-RPC `id`，把请求序列化后写入子进程 stdin。
4. 宿主的后台 reader 任务读取子进程 stdout，按 `id` 路由到对应的 pending oneshot。
5. 响应到达后，`invoke_plugin` 把 `result` 返回给前端；`error` 则转成 `PluginError` 抛出。

## 包结构

```
my-plugin/
├── manifest.json
├── index.tsx
├── backend/
│   ├── Cargo.toml
│   ├── src/
│   │   └── main.rs
│   └── plugin_my-plugin        # 编译后的二进制（产物）
└── README.md
```

`backend/` 目录存放 Rust 源码与编译后的二进制产物。宿主通过 `manifest.json` 的 `hasBackend: true`（或 `backend/` 目录存在）检测后端。

## Rust 端实现

后端是一个**不依赖 Tauri** 的纯 Rust 程序，只需实现一个 stdin/stdout 的 JSON-RPC 循环。下面是一个最小可运行的示例：

```rust
// backend/src/main.rs
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    // 按行读取 stdin：每行是一个 JSON-RPC 请求
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        // 解析 JSON-RPC 请求
        let req: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                // 解析失败：返回 JSON-RPC parse error（id 为 null）
                let err = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": {"code": -32700, "message": format!("parse error: {}", e)}
                });
                writeln!(out, "{}", err).unwrap();
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(serde_json::Value::Null);

        // 分发到对应的处理函数
        let result = match method {
            "count_words" => {
                let text = params.get("text").and_then(|t| t.as_str()).unwrap_or("");
                serde_json::json!(text.split_whitespace().count())
            }
            _ => {
                // 未知方法：返回 JSON-RPC method not found
                if let Some(id) = &id {
                    let err = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {"code": -32601, "message": format!("method '{}' not found", method)}
                    });
                    writeln!(out, "{}", err).unwrap();
                }
                continue;
            }
        };

        // 有 id 的是请求，需要返回响应；无 id 的是通知，忽略即可
        if let Some(id) = id {
            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result
            });
            writeln!(out, "{}", resp).unwrap();
        }
    }
}
```

### Cargo.toml

```toml
[package]
name = "my-plugin-backend"
version = "0.1.0"
edition = "2021"

[[bin]]
# 产物名必须是 plugin_<id>，与 manifest.json 的 id 字段一致
name = "plugin_my-plugin"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### 日志

把日志写到 **stderr**，宿主会自动加上 `[plugin:<id>]` 前缀转发：

```rust
eprintln!("[backend] starting up, plugin_id={}", std::env::args().nth(1).unwrap_or_default());
```

### 传给子进程的环境

宿主在 spawn 时会传入：

- `argv[1]`：插件 id（子进程可做 sanity check，通常可忽略）。
- 环境变量 `SWALLOWNOTE_APP_DATA_DIR`：应用数据目录，插件可在此存放持久化数据（区别于会被卸载删除的插件安装目录）。

## 流式调用

当后端命令需要长时间运行并持续产出中间结果（解析进度、逐行输出、生成 token 流）时，使用流式通道（参见 ADR-0002）。

### 协议规则

1. 宿主发起的请求与普通调用完全一致（带 `id`）。
2. 后端在最终响应**之前**，可随时向 stdout 输出通知帧推送增量：

   ```json
   {"jsonrpc":"2.0","method":"swallow/stream","params":{"requestId":1,"event":"chunk","data":"部分结果..."}}
   ```

   - `requestId`：必须等于对应请求的 `id`，宿主据此把帧路由回发起方。
   - `event`：`chunk`（增量数据）、`done`（后端语义的完成信号，可选）、`error`（后端语义的失败信号，可选）；未知 `event` 会被宿主丢弃。
   - `data`：任意 JSON 值，`done` 事件可省略。
3. 调用仍由**最终响应帧**终结：`{"jsonrpc":"2.0","id":1,"result":...}`。前端 Promise 以响应帧的 `result` 兑现，通知帧只负责逐块回调。
4. 同一后端进程可并发处理多路流：不同 `id` 的请求各自路由，互不串扰。
5. 请求已结束后到达的迟到通知帧会被宿主丢弃并记录 warn 日志（协议违规可观测）。

### 超时模型

| 阶段 | 超时 | 说明 |
| ---- | ---- | ---- |
| 等待首个流事件 | 90s（可配） | 前端用 `firstChunkTimeoutSecs` 覆盖，最小 1s |
| 后续流事件之间 | 60s 滚动续期 | 每收到一个事件重置计时，无总时长上限 |

流式超时**不计入**连续 3 次熔断；非流式调用维持 30s 总超时 + 熔断。

### 后端示例

```rust
// 逐行输出大文件行数：先推 chunk，最后返回最终结果
"my_plugin_stream_lines" => {
    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
    let content = std::fs::read_to_string(path)?;
    let total = content.lines().count();
    for (i, line) in content.lines().enumerate() {
        // 通知帧：requestId 必须等于请求 id
        let note = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "swallow/stream",
            "params": {"requestId": id, "event": "chunk",
                       "data": {"index": i, "line": line}}
        });
        writeln!(out, "{}", note).unwrap();
    }
    // 最终响应帧终结调用
    serde_json::json!(total)
}
```

### 前端调用

```typescript
const total = await panel.invokeBackendStream<{ index: number; line: string }, number>(
  'my_plugin_stream_lines',
  { path: '/path/to/big.txt' },
  (chunk) => console.log('收到行', chunk.index, chunk.line),
  // 可选：覆盖首块超时（秒），默认 90
  { firstChunkTimeoutSecs: 120 },
)
```

## 前端调用

```typescript
import type { PluginPanelProps } from '@/types/plugin'

function MyPanel(panel: PluginPanelProps) {
  const handleCount = async () => {
    const result = await panel.invokeBackend<number>('count_words', {
      text: 'hello world from rust',
    })
    console.log('word count:', result)  // 4
  }

  return <button onClick={handleCount}>Count words</button>
}
```

## 命令命名约定

JSON-RPC 的 `method` 字段全局共享一个命名空间，建议前缀化以避免冲突：

```rust
"my_plugin_count_words" => {
    let text = params.get("text").and_then(|t| t.as_str()).unwrap_or("");
    serde_json::json!(text.split_whitespace().count())
}
```

前端调用：

```typescript
panel.invokeBackend('my_plugin_count_words', { text: '...' })
```

## 错误处理

返回 JSON-RPC error 对象即可，宿主会把 `message` 转成 `PluginError` 抛给前端：

```rust
"my_plugin_parse" => {
    let data = params.get("data").and_then(|t| t.as_str()).unwrap_or("");
    match serde_json::from_str::<MyStruct>(data) {
        Ok(v) => serde_json::json!(v),
        Err(e) => {
            let err = serde_json::json!({
                "code": -32603,
                "message": format!("parse failed: {}", e)
            });
            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": err
            });
            writeln!(out, "{}", resp).unwrap();
            continue;
        }
    }
}
```

```typescript
try {
  const parsed = await panel.invokeBackend<MyStruct>('my_plugin_parse', { data: '...' })
} catch (err) {
  // err 是宿主转发的 JSON-RPC error.message 字符串
  console.error('parse failed:', err)
}
```

JSON-RPC 常用错误码：

| code      | 含义            |
| --------- | --------------- |
| -32700    | parse error     |
| -32600    | invalid request |
| -32601    | method not found |
| -32602    | invalid params  |
| -32603    | internal error  |

## 编译/分发

后端产物是**可执行二进制**（不是动态库），需要在打包时为目标平台编译：

```bash
# 在 plugin/backend 目录
cargo build --release --target x86_64-unknown-linux-gnu
cargo build --release --target x86_64-apple-darwin
cargo build --release --target x86_64-pc-windows-msvc
```

把产物复制到插件包的 `backend/` 下，命名约定：

- 主命名：`plugin_<id>`（与 `manifest.json` 的 `id` 一致），Windows 上是 `plugin_<id>.exe`。
- 兜底命名：宿主也会尝试 `<id>`（无 `plugin_` 前缀），但建议统一用主命名。

例如 `id: "my-plugin"` 的插件，二进制路径为 `backend/plugin_my-plugin`。

## 不需要后端？

大部分插件用前端就能实现（持久化存储、事件订阅、UI 扩展）。后端适合：

- 解析大文件（Word / Excel）而不阻塞 UI
- 将 Markdown 转换为带样式的 HTML（如导出插件使用 `markdown_to_html`，后端通过 pulldown-cmark 将 markdown 转为 styled HTML，前端再通过 modern-screenshot + jsPDF 将 HTML 渲染为 PDF）
- 调本地工具（git / docker / sqlite）
- 跑 CPU 密集型计算（图像处理、压缩）

如果只是要存储键值对 / 订阅事件 / 改 UI —— **用纯前端就够了**。

## 源码引用

- 调用入口与子进程管理：[src-tauri/src/commands/plugin_invoke.rs](../../src-tauri/src/commands/plugin_invoke.rs)（`invoke_plugin` / `invoke_plugin_stream` 命令、`PluginProcess`、`idle_reaper`、流路由表）
- 前端上下文：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `buildPluginContext`（`invokeBackend` 最终调用 `@tauri-apps/api/core` 的 `invoke('invoke_plugin', ...)`）
- 前端流式桥接：[src/lib/plugin-stream.ts](../../src/lib/plugin-stream.ts)（Tauri `Channel` 组装 + `invoke('invoke_plugin_stream', ...)`）
- 后端二进制路径解析：`resolve_backend_binary`（同 `plugin_invoke.rs`）
