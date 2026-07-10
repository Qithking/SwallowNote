# Rust Backend 示例

展示 `invokeBackend` + Rust 后端通过 stdin/stdout JSON-RPC 2.0 与宿主通信。

**学习目标**：用 Rust 子进程处理 CPU 密集型任务（解析大文件、跑复杂计算），不阻塞 UI。

## 文件

- [manifest.json](./manifest.json) — `hasBackend: true`
- [index.tsx](./index.tsx) — 前端调用 `invokeBackend`
- [backend/Cargo.toml](./backend/Cargo.toml) — Rust 包配置
- [backend/src/main.rs](./backend/src/main.rs) — JSON-RPC 子进程实现

## 通信架构

```
┌───────────────┐   stdin (JSON-RPC 请求)    ┌─────────────────────────┐
│               │ ─────────────────────────▶ │  plugin_com.example.    │
│  SwallowNote  │                            │  rust-backend           │
│    宿主进程    │   stdout (JSON-RPC 响应)   │  (Rust 二进制)          │
│               │ ◀───────────────────────── │                         │
└───────────────┘   stderr (日志)            └─────────────────────────┘
```

- **stdin**：宿主按行写入 JSON-RPC 请求
- **stdout**：子进程按行返回 JSON-RPC 响应
- **stderr**：子进程日志，宿主自动加 `[plugin:<id>]` 前缀转发
- **每行一个 JSON 对象**，不要塞多个进同一行

## 生命周期

- 宿主首次调用时按需 spawn，之后**长驻**内存（同一插件多次调用复用同一进程）
- 子进程空闲 **10 分钟**被 `idle_reaper` 回收
- 单次调用超时 **30 秒**；连续超时 **3 次**触发熔断，宿主 kill 后端，下次重新 spawn
- 子进程退出（stdout EOF）时，所有未完成请求立即被拒绝

## 后端命令

| method | params | 返回 | 说明 |
| --- | --- | --- | --- |
| `count_words` | `{ text: string }` | `number` | 按空白字符切分统计单词数 |
| `parse_json` | `{ data: string }` | `object` | 解析 JSON 字符串，失败返回 -32603 error |

### 请求/响应示例

```jsonc
// 请求
{"jsonrpc":"2.0","id":1,"method":"count_words","params":{"text":"hello world from rust"}}
// 响应
{"jsonrpc":"2.0","id":1,"result":4}

// 错误响应（非法 JSON）
{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"parse failed: ..."}}
```

## 编译步骤

后端产物是可执行二进制（不是动态库），需为目标平台编译：

```bash
# 进入 backend 目录
cd backend

# 编译 release（默认目标）
cargo build --release

# 交叉编译其他平台
cargo build --release --target x86_64-apple-darwin
cargo build --release --target x86_64-unknown-linux-gnu
cargo build --release --target x86_64-pc-windows-msvc
```

产物路径：`backend/target/release/plugin_com.example.rust-backend`

## 二进制命名约定

- **主命名**：`plugin_<id>`（与 `manifest.json` 的 `id` 一致）
- 本示例 id 为 `com.example.rust-backend`，二进制名为 `plugin_com.example.rust-backend`
- Windows 上是 `plugin_com.example.rust-backend.exe`
- 兜底：宿主也会尝试 `<id>`（无 `plugin_` 前缀），但建议统一用主命名

把编译后的二进制放到插件包的 `backend/` 目录下，宿主通过 `manifest.json` 的 `hasBackend: true`（或 `backend/` 目录存在）检测后端。

## 前端调用

```typescript
// 调用 count_words，泛型标注返回类型
const count = await panel.invokeBackend<number>('count_words', {
  text: 'hello world from rust',
})
console.log(count) // 4

// 调用 parse_json
const parsed = await panel.invokeBackend('parse_json', {
  data: '{"key":"value"}',
})

// 错误处理
try {
  await panel.invokeBackend('parse_json', { data: '{invalid' })
} catch (err) {
  // err 是宿主转发的 JSON-RPC error.message 字符串
  console.error('parse failed:', err)
}
```

## JSON-RPC 错误码

| code | 含义 |
| --- | --- |
| -32700 | parse error（请求 JSON 解析失败） |
| -32600 | invalid request |
| -32601 | method not found |
| -32602 | invalid params |
| -32603 | internal error |

## 何时用后端

大部分插件用前端就能实现（持久化存储、事件订阅、UI 扩展）。后端适合：
- 解析大文件（Word / Excel）而不阻塞 UI
- Markdown 转 HTML（pulldown-cmark）
- 调本地工具（git / docker / sqlite）
- CPU 密集型计算（图像处理、压缩）

详见 [backend.md](../../plugin-system/backend.md)。

## 权限

`permissions: ['backend']` —— `invokeBackend` 调用需要 `backend` 权限，宿主在调用前通过 `assertPermission(pluginId, 'backend', ...)` 校验，未授权抛 `PluginPermissionDeniedError`。

## 独立预览模式

`npm run dev` 下无宿主，`invokeBackend` 返回 null（SDK 兜底）。真实调用需在宿主中加载本插件并编译 Rust 后端二进制。
