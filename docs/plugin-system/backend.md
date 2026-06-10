# Rust 后端（可选）

插件可以携带 Tauri command 作为后端。在需要高性能（解析大文件、跑复杂计算、调用系统 API）时使用。

## 包结构

```
my-plugin/
├── manifest.json
├── index.tsx
├── backend/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
└── README.md
```

## Rust 端 command

```rust
// backend/src/lib.rs
use tauri::command;

#[command]
pub fn count_words(text: String) -> u32 {
    text.split_whitespace().count() as u32
}

#[command]
pub async fn fetch_metadata(url: String) -> Result<String, String> {
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![count_words, fetch_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
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

为避免命名冲突，建议前缀化：

```rust
#[command]
pub fn my_plugin_count_words(text: String) -> u32 { ... }
```

前端调用：

```typescript
panel.invokeBackend('my_plugin_count_words', { text: '...' })
```

## Capabilities

后端命令需要注册到 Tauri capabilities（`src-tauri/capabilities/default.json`）。宿主**不**为插件后端自动注册命令 —— 插件作者需要：

1. 在 `manifest.json` 中声明 `has_backend: true`
2. 在 `backend/src/lib.rs` 中定义 command
3. 在打包前通过 `tauri.conf.json` 的 `allowlist` 或 capabilities 显式授权

> 详细 Tauri command 注册见 [Tauri 官方文档](https://tauri.app/v1/guides/distribution/sign-android-application)。

## 错误处理

```rust
#[command]
pub fn my_plugin_parse(data: String) -> Result<MyStruct, String> {
    serde_json::from_str(&data).map_err(|e| e.to_string())
}
```

```typescript
try {
  const parsed = await panel.invokeBackend<MyStruct>('my_plugin_parse', { data: '...' })
} catch (err) {
  // err 是 host 转发的 Rust 错误字符串
  console.error('parse failed:', err)
}
```

## 编译/分发

后端是 `.so` / `.dylib` / `.dll`，需要在打包时为目标平台编译：

```bash
# 在 plugin/backend 目录
cargo build --release --target x86_64-unknown-linux-gnu
cargo build --release --target x86_64-apple-darwin
cargo build --release --target x86_64-pc-windows-msvc
```

输出到 `backend/target/release/libmy_plugin.so` 等，复制到插件包根目录的 `backend/` 下。

## 不需要后端？

大部分插件用前端就能实现（持久化存储、事件订阅、UI 扩展）。后端适合：

- 解析大文件（PDF / Word / Excel）而不阻塞 UI
- 调本地工具（git / docker / sqlite）
- 跑 CPU 密集型计算（图像处理、压缩）

如果只是要存储键值对 / 订阅事件 / 改 UI —— **用纯前端就够了**。

## 源码引用

- 调用入口：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `buildPluginContext`（`invokeBackend` 来自 `panel.invokeBackend`，最终调用 `@tauri-apps/api/core` 的 `invoke`）
- 插件命令注册：[src-tauri/src/commands/plugin.rs](../../src-tauri/src/commands/plugin.rs)
- Tauri 配置：[src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json)
