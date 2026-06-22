# 带后端的插件开发指南

> 以「文档导出」插件为例，完整演示如何开发一个包含 Rust 后端的 SwallowNote 插件。

---

## 目录

1. [插件架构概览](#1-插件架构概览)
2. [目录结构](#2-目录结构)
3. [manifest.json — 插件清单](#3-manifestjson--插件清单)
4. [前端开发](#4-前端开发)
5. [后端开发（Rust）](#5-后端开发rust)
6. [构建与打包](#6-构建与打包)
7. [安装与验证](#7-安装与验证)
8. [调用链路详解](#8-调用链路详解)
9. [常见问题](#9-常见问题)

---

## 1. 插件架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│  SwallowNote 宿主                                                    │
│                                                                      │
│  ┌─────────────────┐    invoke('invoke_plugin', ...)    ┌─────────┐ │
│  │  前端 (index.js) │ ─────────────────────────────────▶│ Rust    │ │
│  │                  │    JSON-RPC over stdin/stdout      │ 后端    │ │
│  │  • toolbarButton │◀──────────────────────────────────│ 二进制  │ │
│  │  • panel         │    base64 / JSON response          │         │ │
│  └─────────────────┘                                   └─────────┘ │
│         │                                                    │       │
│         │ 事件订阅 (note:change, note:open ...)              │       │
│         ▼                                                    │       │
│  ┌─────────────────┐                                        │       │
│  │  宿主事件总线     │                                        │       │
│  └─────────────────┘                                        │       │
└──────────────────────────────────────────────────────────────────────┘
```

**关键原则**：插件完全自包含，与宿主零耦合。

- 前端：React 组件，通过 SDK 获取类型，通过 `ToolbarButtonProps` 接收宿主上下文
- 后端：独立 Rust 二进制，不依赖 Tauri，通过 JSON-RPC over stdin/stdout 通信
- 宿主只提供通用机制（`invoke_plugin`、事件总线、存储），不包含任何插件专属代码

---

## 2. 目录结构

```
plugins/export/
├── manifest.json           # 插件清单（Rust 端读取）
├── package.json            # npm 配置（前端构建依赖）
├── tsconfig.json           # TypeScript 配置
├── vite.config.ts          # Vite 构建配置（IIFE 输出）
├── build.sh                # 后端构建脚本
├── package.sh              # 完整打包脚本（前端+后端→zip）
├── src/
│   └── index.tsx           # 前端入口
└── src-tauri/              # Rust 后端源码
    ├── Cargo.toml          # Rust 依赖配置
    └── src/
        ├── main.rs         # JSON-RPC 入口（stdin/stdout 通信）
        └── convert.rs      # 核心转换逻辑（Markdown→DOCX）
```

构建产物：

```
dist/                       # Vite 构建输出
├── index.js                # IIFE bundle（宿主加载此文件）
└── manifest.json           # 复制的清单

com.swallownote.export.zip  # 最终可安装的插件包
├── index.js
├── manifest.json
└── backend/
    └── plugin_com.swallownote.export   # Rust 二进制
```

---

## 3. manifest.json — 插件清单

```json
{
  "id": "com.swallownote.export",
  "name": "文档导出",
  "description": "将 Markdown 文档导出为 Word (.docx) / PDF / HTML 格式",
  "version": "0.2.0",
  "author": "SwallowNote",
  "publishedAt": "2026-06-13",
  "iconPosition": "editorToolbar",
  "contentPosition": "editorArea",
  "order": 50,
  "enabled": true,
  "hasBackend": true,
  "entry": "index.tsx"
}
```

### 关键字段说明

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `com.swallownote.export` | 全局唯一标识，反向域名格式。ZIP 包名必须与此一致 |
| `iconPosition` | `editorToolbar` | 图标显示在编辑器工具栏（也可选 `sidebar`、`titleBar`） |
| `contentPosition` | `editorArea` | 面板内容区域（本插件无面板，但字段必填） |
| `hasBackend` | `true` | **必须设为 true**（写在 [`manifest.json`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/manifest.json) 中），否则宿主不会查找 `backend/` 目录。前端 `PluginManifest` 类型不含此字段,由宿主在加载 manifest.json 时填充到 `PluginDefinition` |
| `entry` | `index.tsx` | 源码入口，构建后宿主加载的是 `index.js` |

---

## 4. 前端开发

### 4.1 package.json

```json
{
  "name": "swallownote-plugin-export",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:backend": "bash build.sh release",
    "package": "bash package.sh",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@swallow-note/plugin-sdk": "file:../../docs/plugin-sdk",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/api": "^2.0",
    "@tauri-apps/plugin-dialog": "^2.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "sonner": "^1.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

**要点**：

- `@swallow-note/plugin-sdk`：通过 `file:` 协议链接到本地 SDK，提供类型和运行时 stub
- `@tauri-apps/api`、`@tauri-apps/plugin-dialog`：Tauri 公共 API，放在 `devDependencies` 中避免打包进 IIFE
- `sonner`：宿主已提供的库，放在 `devDependencies` 中（IIFE bundle 在宿主环境运行时可访问）
- 插件 i18n **不依赖** `react-i18next` / `i18next`（见 [`i18n.ts`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/src/i18n.ts) 私有词条）

### 4.2 vite.config.ts

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        // 构建完成后复制 manifest.json 到 dist/
        {
          name: 'copy-manifest',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })
            copyFileSync(
              resolve(__dirname, 'manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )
          },
        },
      ],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'src/index.tsx'),
          name: 'SwallowNoteExportPlugin',
          formats: ['iife'],        // 必须是 IIFE 格式
          fileName: () => 'index.js', // 宿主期望的文件名
        },
        rollupOptions: {
          external: [],
          output: { inlineDynamicImports: true },
        },
      },
    }
  }
  // dev 模式：浏览器预览
  return {
    plugins: [react()],
    server: { port: 5174, open: true },
  }
})
```

**关键配置**：

- `formats: ['iife']`：宿主通过 `convertFileSrc` + `import()` 动态加载，必须是 IIFE 格式
- `fileName: () => 'index.js'`：安装时宿主检查 `index.js` 是否存在
- `inlineDynamicImports: true`：所有代码内联到单文件，避免多 chunk 加载问题

### 4.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src", "../../docs/plugin-sdk/src"]
}
```

`include` 中加入 SDK 源码路径，确保 TypeScript 能解析 `@swallow-note/plugin-sdk` 的类型。

### 4.4 src/index.tsx — 前端入口

`src/index.tsx` 暴露一个 `toolbarButton`（下拉菜单）和占位 `panel`，并把当前笔记的 `activeNoteContent` / `activeNotePath` 直接当作 props 拿到——**不再需要 `events.on('note:change')` 同步内容**。关键代码骨架如下：

```tsx
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import type { PluginManifest, PluginPanelProps, ToolbarButtonProps } from '@swallow-note/plugin-sdk'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { jsPDF } from 'jspdf'
import { domToCanvas } from 'modern-screenshot'
import { compactMarkdown } from './markdown-normalize'
import { getStrings } from './i18n'

// ─── 工具栏按钮组件（下拉菜单） ──────────────────────────────
function ExportToolbarButton(props: ToolbarButtonProps): ReactNode {
  const { size, invokeBackend, activeNoteContent, activeNotePath } = props
  const [menuOpen, setMenuOpen] = useState(false)
  // 同步锁：双击/连点会在同一 microtask 内被丢弃
  const exportingRef = useRef(false)
  const [isExporting, setIsExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // 插件私有词条，不再依赖宿主 react-i18next catalog
  const strings = getStrings(navigator.language)

  const hasContent = activeNoteContent.trim().length > 0
  const noteName = activeNotePath?.split('/').pop() || 'untitled'

  // 关闭菜单的全局 click 监听
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // 共用导出流程:toast 生命周期 + 保存对话框 + base64 落盘
  const runExport = useCallback(
    async (format: 'docx' | 'pdf' | 'html', produce: () => Promise<Uint8Array | string>) => {
      if (exportingRef.current) return        // 同步锁
      if (!hasContent) {
        toast.info(strings.emptyNote)
        return
      }
      exportingRef.current = true
      setIsExporting(true)
      setMenuOpen(false)
      const toastId = toast.loading(strings.generating)
      try {
        const result = await produce()
        const fileName = (noteName || 'untitled').replace(/\.(md|markdown)$/i, '') + `.${format}`
        const selected = await save({ defaultPath: fileName, filters: [...] })
        if (!selected) return
        const b64 = typeof result === 'string' ? result : uint8ToBase64(result)
        await invoke('write_binary_file', { path: selected, data: b64 })
        toast.success(strings.exportSuccess, { id: toastId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('too large')) {
          toast.error(strings.tooLarge, { id: toastId, description: msg })
        } else if (format === 'pdf') {
          toast.error(strings.pdfExportFailed, { id: toastId, description: msg })
        } else {
          toast.error(strings.exportFailed, { id: toastId, description: msg })
        }
      } finally {
        exportingRef.current = false
        setIsExporting(false)
      }
    },
    [hasContent, noteName, strings],
  )

  const handleExportDocx = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('docx', async () => {
      return (await invokeBackend('markdown_to_docx', { markdown })) as string
    })
  }, [activeNoteContent, invokeBackend, runExport])

  const handleExportPdf = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('pdf', async () => {
      const html = (await invokeBackend('markdown_to_html', { markdown })) as string
      return await generatePdfFromHtml(html, activeNotePath)
    })
  }, [activeNoteContent, activeNotePath, invokeBackend, runExport])

  // HTML 导出:复用后端 markdown_to_html 的响应,直接保存为 .html 文件,
  // 不走 PDF 多段渲染 —— 浏览器打开样式与 PDF 等同。
  const handleExportHtml = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('html', async () => {
      return (await invokeBackend('markdown_to_html', { markdown })) as string
    })
  }, [activeNoteContent, invokeBackend, runExport])

  return (
    <div ref={menuRef} className="relative">
      <button onClick={() => setMenuOpen(!menuOpen)} ...>
        <ExportIcon size={size} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[140px]" ...>
          <button onClick={handleExportDocx} disabled={isExporting || !hasContent} ...>
            {strings.wordMenu}
          </button>
          <button onClick={handleExportPdf} disabled={isExporting || !hasContent} ...>
            {strings.pdfMenu}
          </button>
          <button onClick={handleExportHtml} disabled={isExporting || !hasContent} ...>
            {strings.htmlMenu}
          </button>
        </div>
      )}
    </div>
  )
}

const manifest: PluginManifest = {
  id: 'com.swallownote.export',
  // ... 其余字段
  // hasBackend 由宿主在加载 manifest.json 时填充到 PluginDefinition,
  // 不属于前端 PluginManifest 类型。
  icon: ExportIcon,
  panel: ExportPanel,                    // 占位，本插件无面板
  toolbarButton: ExportToolbarButton,    // 自定义工具栏按钮
  permissions: ['backend'],              // 不再需要 'events'（已改用 activeNoteContent prop）
}
```

#### 4.4.1 PDF 导出机制(多段渲染)

`generatePdfFromHtml` 实现**多段渲染**,避免单 canvas OOM:

1. 后端 `markdown_to_html` 返回拼好的完整 HTML 文档(内置 `<style>`,含 A4 宽度、字体、分页规则)
2. 前端把 HTML 挂到隐藏容器,**真实等待所有 `<img>` load 完毕**(**全局共享 8s 超时**;`asset:` 协议由 `convertFileSrc` 重写)
3. 把 `body` 的直接子元素按高度累加,**每 `A4_HEIGHT_PX - 40` 像素分一页**;超高元素(典型:长代码块)走 [`splitOversizedChild`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/src/index.tsx#L260-L291) 按行切分
4. 每页用 `cloneNode(true)` **深拷贝**出独立容器,**单独 `domToCanvas`**(canvas 高度被容器 `height` 锁在 `A4_HEIGHT_PX × 2`,百页文档也只占一页内存)
5. `pdf.addImage` + `pdf.addPage` 逐页入栈

#### 4.4.1.1 PDF 自定义块渲染(mermaid / katex / markmap)

`renderCustomBlocksForPdf` 在第 2 步(`resolveImageSources` 之后、`waitForImages` 之前)被调用,**用动态 `import()` 加载** 3 个第三方库(放 `devDependencies`,首屏 bundle 不增体积):

```ts
const [mermaid, katex, markmap] = await Promise.all([
  import('mermaid' as any).catch(() => null),
  import('katex' as any).catch(() => null),
  import('markmap-view' as any).catch(() => null),
])
```

对每个 `<pre><code class="language-mermaid|katex|markmap">` 块,替换为对应的渲染产物:

- **mermaid** —— `mermaid.render(id, source)` → `<svg>` 字符串,塞进 `<div class="export-mermaid">`
- **katex** —— `katex.renderToString(source, { displayMode: true, throwOnError: false })` → HTML 字符串
- **markmap** —— `new Markmap().create(svg, undefined, source)` + `mm.fit()` + 200ms 延时

任何一步 `try/catch` 失败都会**保留原 `<pre>`**(显示源码),不影响主流程导出。HTML 导出走的是浏览器原生 mermaid.js(由 `markdown_to_html` 输出的 `<style>` 触发),无需前端额外处理。

DOCX 端的同名代码块保留源码并追加 `"(前端渲染)"` 标记(由 `convert.rs::render_code_block` 渲染),提示读者该图在 PDF/HTML 端有渲染产物。

#### 4.4.2 图片资源解析

**PDF / HTML 路径**:`resolveImageSources` 把 Markdown 原文里的相对路径 `<img src="./x.png">` 重写成 `asset:localhost/...`,Tauri 协议处理器会去读本地文件并以 `data:` URL 返回。`http(s):` / `data:` / `blob:` 不动。

**DOCX 路径**:`collectImageAssets(markdown, notePath)` 在 `handleExportDocx` 中被调用,正则提取所有 `![alt](url)` 的相对 URL,**逐个 fetch 字节** → base64 编码 → 通过 JSON-RPC `image_assets` 参数传给 Rust 后端。后端 `convert.rs::markdown_to_docx` 收到 map 后,base64 解码出原始字节,通过 `docx_rs::Pic::new(&bytes)` **嵌入为真实图片**;未命中走 `alt` + URL 占位文字(降级路径,与旧版本兼容)。总量上限 50 MB(`MAX_EMBEDDED_IMAGE_BYTES`),超出跳过剩余图片;单图失败不阻塞整体导出。

#### 4.4.3 私有 i18n

插件不再依赖宿主 `react-i18next` catalog。`getStrings(locale)` 在 [`i18n.ts`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/src/i18n.ts) 中按 `zh/en` 返回词条,含 `tooltip` 字段(用于工具栏按钮 `title` / `aria-label`)。当前语言通过宿主注入的 `window.__SWALLOW_LOCALE__` 全局变量读取(优先)或回退到 `navigator.language` / `'zh-CN'`,由 [`readLocale()`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/src/index.tsx#L65-L74) 统一处理。

### 4.5 关键概念

#### toolbarButton vs icon

| 方式 | 行为 |
|---|---|
| 只提供 `icon` | 宿主渲染默认按钮，点击激活/停用面板 |
| 提供 `toolbarButton` | 宿主渲染你的自定义组件，完全控制交互 |

`toolbarButton` 接收 `ToolbarButtonProps`：

```typescript
interface ToolbarButtonProps {
  size: number                    // 推荐图标尺寸（editorToolbar: 14, sidebar: 18）
  isActive: boolean               // 面板是否激活
  pluginId: string                // 插件 ID
  invokeBackend: (command, args?) => Promise<unknown>  // 调用后端
  store: PluginStorage            // 持久化存储
  events: PluginEventBus          // 事件总线
  activate: () => void            // 激活面板
  deactivate: () => void          // 停用面板
}
```

#### invokeBackend 调用链路

```
invokeBackend('markdown_to_docx', { markdown: '...' })
  → invoke('invoke_plugin', {
      pluginId: 'com.swallownote.export',
      command: 'markdown_to_docx',
      args: { markdown: '...' }
    })
  → 宿主 Rust 查找 backend/plugin_com.swallownote.export
  → 启动子进程，发送 JSON-RPC 请求
  → 插件后端处理并返回
```

#### 事件订阅

> **本插件已改用 prop 注入链路**（见 §4.4 `ToolbarButtonProps.activeNoteContent` / `activeNotePath`），**不订阅事件总线**。下面的 `events.on` 示例保留作为通用参考——其他需要响应笔记变更的插件可以这样用。
>
> ```typescript
> // 订阅笔记内容变化
> events.on('note:change', ({ content, path }) => { ... })
> // 订阅笔记打开
> events.on('note:open', ({ path }) => { ... })
> ```
>
> 可用事件：`note:open`、`note:close`、`note:save`、`note:change`、`theme:change`、`locale:change`、`settings:change`、`app:ready`、`app:exit`

---

## 5. 后端开发（Rust）

### 5.1 Cargo.toml

```toml
[package]
name = "swallownote-plugin-export"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "plugin_com_swallownote_export"   # 二进制文件名
path = "src/main.rs"

[dependencies]
docx-rs = "0.4"            # DOCX 生成
pulldown-cmark = "0.12"    # Markdown 解析
base64 = "0.22"            # base64 编码
thiserror = "1"            # 错误处理
serde = { version = "1", features = ["derive"] }
serde_json = "1"           # JSON-RPC 协议
```

**要点**：

- **不依赖 tauri**：后端是独立二进制，通过 stdin/stdout 与宿主通信
- `[[bin]]` 的 `name` 必须遵循 `plugin_<plugin_id 中的 . 替换为 _>` 的命名规则
- 二进制最终会被重命名为 `plugin_com.swallownote.export`（宿主查找的文件名）

### 5.2 main.rs — JSON-RPC 入口

```rust
mod convert;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

/// JSON-RPC 2.0 请求。`id` 用 `serde_json::Value` 是为了 spec
/// 兼容（接受 number / string / null），宿主当前只发数字 id
/// （内部用 `Arc<AtomicU64>` 计数），Value 透传是 0 成本防御。
#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC 2.0 成功响应
#[derive(Serialize)]
struct JsonRpcSuccess {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

/// JSON-RPC 2.0 错误响应
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
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    // 逐行读取 stdin，每行是一个 JSON-RPC 请求
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,  // stdin 关闭，退出
        };

        let line = line.trim();
        if line.is_empty() { continue; }

        // 解析请求
        let req: JsonRpcRequest = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                // 返回解析错误（id 用 Null,因为从未收到有效 id）
                let resp = JsonRpcError {
                    jsonrpc: "2.0",
                    id: Value::Null,
                    error: JsonRpcErrorDetail {
                        code: -32700,
                        message: format!("Parse error: {}", e),
                    },
                };
                let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        // 分发到处理函数
        let response = handle_request(&req);
        let _ = writeln!(stdout, "{}", serde_json::to_string(&response).unwrap());
        let _ = stdout.flush();  // 必须刷新！
    }
}

fn handle_request(req: &JsonRpcRequest) -> Value {
    match req.method.as_str() {
        "markdown_to_docx" => {
            let markdown = req.params.get("markdown")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match convert::markdown_to_docx(markdown.to_string()) {
                Ok(b64) => {
                    // 成功：返回 { "jsonrpc": "2.0", "id": N, "result": "<base64>" }
                    let resp = JsonRpcSuccess {
                        jsonrpc: "2.0",
                        id: req.id,
                        result: Value::String(b64),
                    };
                    serde_json::to_value(resp).unwrap()
                }
                Err(e) => {
                    // 失败：返回 { "jsonrpc": "2.0", "id": N, "error": { ... } }
                    let resp = JsonRpcError { /* ... */ };
                    serde_json::to_value(resp).unwrap()
                }
            }
        }
        _ => {
            // 未知方法
            let resp = JsonRpcError {
                jsonrpc: "2.0",
                id: req.id,
                error: JsonRpcErrorDetail {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                },
            };
            serde_json::to_value(resp).unwrap()
        }
    }
}
```

### 5.3 JSON-RPC 协议规范

宿主与插件后端之间的通信协议是 **行分隔的 JSON-RPC 2.0**：

```
宿主 → 插件:  {"jsonrpc":"2.0","id":1,"method":"markdown_to_docx","params":{"markdown":"# Hello"}}\n
插件 → 宿主:  {"jsonrpc":"2.0","id":1,"result":"UEsDBBQAAAA..."}\n
```

错误响应：

```
插件 → 宿主:  {"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"docx-rs pack failed: ..."}}\n
```

**关键规则**：

1. 每行一个 JSON 对象，以 `\n` 结尾
2. 必须调用 `stdout.flush()`，否则宿主读不到数据
3. `id` 必须与请求中的 `id` 一致
4. stderr 输出会被宿主日志记录，但不会被视为响应
5. stdin 关闭（EOF）时进程应正常退出

### 5.4 convert.rs — 核心转换逻辑

```rust
use docx_rs::*;
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::io::Cursor;
use base64::Engine;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("DOCX generation failed: {0}")]
    DocxGeneration(String),
}

/// 将 Markdown 字符串转换为 DOCX，返回 base64 编码的字节
pub fn markdown_to_docx(markdown: String) -> Result<String, ExportError> {
    let doc = build_docx(&markdown)?;
    let mut buf = Cursor::new(Vec::new());
    doc.build()
        .pack(&mut buf)
        .map_err(|e| ExportError::DocxGeneration(format!("docx-rs pack failed: {}", e)))?;
    let bytes = buf.into_inner();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(b64)
}

fn build_docx(markdown: &str) -> Result<Docx, ExportError> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let blocks = parse_blocks(parser);

    let mut doc = Docx::new();
    for block in &blocks {
        match block {
            Block::Heading { level, inlines } => {
                let style = format!("Heading{}", level.min(&6));
                let para = append_inlines(Paragraph::new().style(&style), inlines);
                doc = doc.add_paragraph(para);
            }
            Block::Paragraph(inlines) => {
                let para = append_inlines(Paragraph::new(), inlines);
                doc = doc.add_paragraph(para);
            }
            Block::CodeBlock { code } => {
                let para = Paragraph::new().add_run(
                    Run::new().add_text(code)
                        .fonts(RunFonts::new().ascii("Courier New").east_asia("Courier New"))
                        .size(18)
                );
                doc = doc.add_paragraph(para);
            }
            Block::ListItem { depth, inlines } => {
                let indent_val: i32 = (*depth as i32).min(4) * 360;
                let mut para = Paragraph::new()
                    .add_run(Run::new().add_text("• "))
                    .indent(Some(indent_val), None, None, None);
                para = append_inlines(para, inlines);
                doc = doc.add_paragraph(para);
            }
            Block::Table { headers, rows } => {
                // 构建表格...
            }
        }
    }
    Ok(doc)
}
```

**docx-rs 0.4 API 要点**：

| API | 说明 |
|---|---|
| `Docx::new()` | 创建空文档 |
| `doc.add_paragraph(para)` | 添加段落 |
| `doc.add_table(table)` | 添加表格 |
| `Paragraph::new().style("Heading1")` | 使用内置标题样式 |
| `Run::new().add_text(t).bold().italic()` | 粗体/斜体文本 |
| `Run::new().fonts(RunFonts::new().ascii("Courier New"))` | 设置字体 |
| `doc.build().pack(&mut buf)` | 生成 DOCX 并写入 |

**pulldown-cmark 0.12 API 要点**：

| API | 说明 |
|---|---|
| `Parser::new_ext(md, options)` | 创建解析器 |
| `Tag::Heading { level, .. }` | 标题开始（注意 `..` 忽略其他字段） |
| `Tag::BlockQuote(_)` | 引用块（0.12 变为 tuple variant） |
| `TagEnd::Table` | 表格结束（0.12 变为 unit variant） |
| `TagEnd::BlockQuote(_)` | 引用块结束 |

---

## 6. 构建与打包

### 6.1 前端构建

```bash
cd plugins/export

# 安装依赖
npm install

# 构建（输出 dist/index.js + dist/manifest.json）
npm run build
```

构建产物：
- `dist/index.js` — **ES module** bundle（`format: 'es'`），约 1.2MB（含 jspdf、modern-screenshot、SDK、组件代码）
- `dist/manifest.json` — 从项目根目录复制
- `dist/index.js` 头部会被注入 `// @swallow-manifest {…}` 注释，宿主的 `scan_plugins` 解析该注释来发现插件元信息

**关键 Vite 配置**（见 [`vite.config.ts`](file:///Users/thking/code/codeBuddy/SwallowNote/plugins/export/vite.config.ts)）：

| 配置 | 值 | 原因 |
|---|---|---|
| `formats` | `['es']` | 宿主通过 `import()` 动态加载，期望 ES module |
| `inlineDynamicImports` | `true` | 宿主用 blob URL 加载，不能解析相对 chunk 引用 |
| `external` | `['react', 'react-dom', 'sonner', '@tauri-apps/api', '@tauri-apps/plugin-dialog', '@swallow-note/plugin-sdk']` | 共享宿主实例，避免多 React dispatcher 崩溃 |
| 头部 manifest 注释 | `// @swallow-manifest {...}` | 注入插件元信息到 bundle 头部 |

### 6.2 后端构建

```bash
cd plugins/export

# Debug 模式
bash build.sh

# Release 模式（推荐，体积更小）
bash build.sh release
```

`build.sh` 做了什么：

1. `cargo build --release --manifest-path src-tauri/Cargo.toml`
2. 复制 `src-tauri/target/release/plugin_com_swallownote_export` → `backend/plugin_com.swallownote.export`
3. 设置可执行权限

**二进制命名规则**：

| 阶段 | 文件名 | 说明 |
|---|---|---|
| Cargo 编译产物 | `plugin_com_swallownote_export` | `_` 替代 `.` |
| 宿主期望的文件名 | `plugin_com.swallownote.export` | 保留 `.` |
| Windows | `plugin_com.swallownote.export.exe` | 自动加 `.exe` |

宿主查找路径：`<plugin_path>/backend/plugin_<plugin_id>` 或 `<plugin_path>/backend/<plugin_id>`

### 6.3 完整打包

```bash
cd plugins/export

# 一键打包（前端 + 后端 + zip）
npm run package
# 或
bash package.sh release
```

`package.sh` 做了什么：

1. `npx vite build` — 构建前端（ES module bundle + manifest 头部注释）
2. `cargo build --release` — 构建后端
3. 复制后端二进制到 `dist/backend/plugin_com.swallownote.export`
4. `zip -r com.swallownote.export-${version}.zip index.js manifest.json backend/`

最终产物：`plugins/export/com.swallownote.export-0.1.0.zip`（版本号来自 `manifest.json`）

### 6.4 跨平台构建

如果需要支持多个平台，需要分别编译后端：

```bash
# macOS (Apple Silicon)
cargo build --release --target aarch64-apple-darwin --manifest-path src-tauri/Cargo.toml

# macOS (Intel)
cargo build --release --target x86_64-apple-darwin --manifest-path src-tauri/Cargo.toml

# Windows
cargo build --release --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml

# Linux
cargo build --release --target x86_64-unknown-linux-gnu --manifest-path src-tauri/Cargo.toml
```

每个平台生成独立的 zip 包，用户根据操作系统选择安装。

---

## 7. 安装与验证

### 7.1 安装方式

1. 打开 SwallowNote → 设置 → 插件管理
2. 拖拽 `com.swallownote.export.zip` 到上传区域，或点击上传按钮选择文件
3. 插件出现在列表中，启用即可

### 7.2 安装后目录结构

宿主将 zip 解压到 `<app_data_dir>/plugins/com.swallownote.export/`：

```
<app_data_dir>/plugins/com.swallownote.export/
└── .versions/
    └── upload/
        ├── index.js
        ├── manifest.json
        └── backend/
            └── plugin_com.swallownote.export
```

### 7.3 验证清单

| 验证项 | 预期结果 |
|---|---|
| 编辑器工具栏出现下载图标 | 图标可见,hover 有背景变化 |
| 点击图标出现下拉菜单 | 显示「导出为 Word」「导出为 PDF」「导出为 HTML」 |
| 空笔记 | 三个导出按钮均 `disabled`(鼠标变 not-allowed) |
| 点击「导出为 Word」 | 弹出保存对话框,保存后 `.docx` 可在 Word/WPS 打开 |
| 点击「导出为 PDF」 | 弹出保存对话框,保存后多页 PDF 可正常打开 |
| 点击「导出为 HTML」 | 弹出保存对话框,保存后浏览器打开样式与 PDF 一致(包含 `<style>` 内置 CSS) |
| 含 mermaid/katex/markmap 代码块 | DOCX 中保留语言标签 + `(前端渲染)` 标记(如 `[mermaid] (前端渲染)`),PDF 渲染为对应图表,HTML 浏览器内由 mermaid.js 渲染 |
| 含中文段落 | DOCX 中显示为宋体(SimSun);PDF 同等字体 |
| 含相对路径图片 | DOCX 嵌入真实图片(`<w:drawing>`);PDF / HTML 通过 `asset:` 协议加载 |
| 含表格 5 列 | DOCX 表格列宽 ≈ 1.25 inch/列(总 6.25 inch),Word/WPS 显示正常边框 |
| 100 页+ 长文档 | PDF / DOCX / HTML 三格式均不抛 `RangeError`;PDF 多段 canvas 渲染不 OOM |
| 快速双击「导出为 Word」 | 只触发一次保存对话框(同步锁 `exportingRef`) |
| 禁用插件后 | 工具栏图标消失 |
| 卸载插件后 | 无残留,主应用正常运行 |

---

## 8. 调用链路详解

### 8.1 DOCX 导出完整链路

```
用户点击「导出为 Word」
  │
  ▼
ExportToolbarButton.handleExportDocx()
  │
  ▼
invokeBackend('markdown_to_docx', { markdown: noteContent })
  │  ← ToolbarButtonProps.invokeBackend
  │
  ▼
invoke('invoke_plugin', {
  pluginId: 'com.swallownote.export',
  command: 'markdown_to_docx',
  args: { markdown: '...' }
})
  │  ← @tauri-apps/api/core
  │
  ▼
[Rust] invoke_plugin() — src-tauri/src/commands/plugin_invoke.rs
  │
  ├─ get_or_spawn() — 查找或启动后端子进程
  │   ├─ resolve_backend_binary() — 查找 backend/plugin_com.swallownote.export
  │   └─ spawn_plugin_process() — 启动子进程 + stdin/stdout 管道
  │
  ├─ 构造 JSON-RPC 请求: {"jsonrpc":"2.0","id":1,"method":"markdown_to_docx","params":{...}}
  │
  ├─ 写入子进程 stdin + flush
  │
  └─ 等待子进程 stdout 响应（30s 超时）
      │
      ▼
[插件后端] main.rs — 逐行读取 stdin
  │
  ├─ 解析 JSON-RPC 请求
  │
  ├─ handle_request() — 分发到 convert::markdown_to_docx()
  │   ├─ pulldown-cmark 解析 Markdown
  │   ├─ docx-rs 生成 DOCX
  │   └─ base64 编码
  │
  └─ 写入 stdout: {"jsonrpc":"2.0","id":1,"result":"<base64>"}
      │
      ▼
[Rust] invoke_plugin() — 解析响应，返回 result
  │
  ▼
[前端] b64 = await invokeBackend(...)
  │
  ▼
save() — 弹出保存对话框
  │
  ▼
invoke('write_binary_file', { path, data: b64 }) — 写入文件
  │
  ▼
toast.success('导出成功')
```

### 8.2 PDF 导出链路

```
用户点击「导出为 PDF」
  │
  ▼
ExportToolbarButton.handleExportPdf()
  │
  ▼
compactMarkdown(activeNoteContent) — 归一化 Markdown
  │
  ▼
invokeBackend('markdown_to_html', { markdown }) — 后端拼好完整 HTML 文档
  │  ← ToolbarButtonProps.invokeBackend
  │
  ▼
invoke('invoke_plugin', {
  pluginId: 'com.swallownote.export',
  command: 'markdown_to_html',
  args: { markdown: '...' }
})
  │  ← @tauri-apps/api/core
  │
  ▼
[插件后端] main.rs → handle_request('markdown_to_html')
  │
  ├─ convert::markdown_to_html()  用 pulldown-cmark 解析 + 拼 <style> + <body>
  │   ├─ ENABLE_TABLES / ENABLE_STRIKETHROUGH / ENABLE_TASKLISTS
  │   ├─ 内置 CSS：A4 宽度、字体、分页规则（page-break-inside: avoid）
  │   └─ 返回完整 HTML 字符串
  │
  └─ stdout: {"jsonrpc":"2.0","id":N,"result":"<!DOCTYPE html>..."}
      │
      ▼
[前端] html = await invokeBackend(...)
  │
  ▼
generatePdfFromHtml(html, notePath)  — 关键的多段渲染
  │
  ├─ 把 HTML 挂到隐藏容器，resolveImageSources 把 <img src> 改成 asset: 协议
  │
  ├─ renderCustomBlocksForPdf(container)  — 自定义块渲染(post-process)
  │   ├─ 动态 import('mermaid' / 'katex' / 'markmap-view') — devDeps,首屏不进 bundle
  │   ├─ 对每个 <pre><code class="language-mermaid|katex|markmap">:
  │   │   mermaid  → mermaid.render(id, src) → <svg>
  │   │   katex    → katex.renderToString(src, { displayMode: true }) → HTML
  │   │   markmap  → new Markmap().create(svg, undefined, src) → <svg> + fit
  │   └─ 任何一步失败 → 保留原 <pre>(降级路径)
  │
  ├─ waitForImages(...) 真实等待所有 <img> load 完毕(全局共享 8s deadline)
  │
  ├─ 按高度把 body 直接子元素分组到多页
  │   each child measured with getBoundingClientRect().height
  │   accumulate until running total > A4_HEIGHT_PX - 40
  │
  └─ for each page:
       ├─ cloneNode(true) 拷贝该页 children 到独立容器
       ├─ 容器 height = A4_HEIGHT_PX + overflow: hidden
       ├─ resolveImageSources + waitForImages (re-resolve for cloned imgs)
       ├─ domToCanvas(pageEl, { scale: 2, width: A4_WIDTH_PX, height: A4_HEIGHT_PX })
       │   ← canvas 高度被锁在 A4_HEIGHT_PX * 2 = 2166px，百页不 OOM
       ├─ canvas.toDataURL('image/png')  →  base64 PNG
       └─ pdf.addImage(...)  →  pdf.addPage() (除最后一页)
  │
  ▼
return new Uint8Array(pdf.output('arraybuffer'))
  │
  ▼
runExport('pdf', ...) 共用流程：
  save() — 弹出保存对话框
  │
  ▼
uint8ToBase64(bytes)  — FileReader.readAsDataURL 异步编码,避开 String.fromCharCode.apply 栈限制
  │
  ▼
invoke('write_binary_file', { path, data: b64 }) — 写入文件
  │
  ▼
toast.success(strings.exportSuccess)
```

### 8.3 DOCX 导出链路(含图片嵌入)

```
用户点击「导出为 Word」
  │
  ▼
ExportToolbarButton.handleExportDocx()
  │
  ▼
collectImageAssets(markdown, notePath)  — 收集所有相对路径图片
  │  ├─ 正则提取 ![alt](url) 的 url,跳过 http(s)/data/blob/asset
  │  ├─ resolveRelativePath + convertFileSrc 走 Tauri asset: 协议
  │  ├─ fetch → Blob → ArrayBuffer → FileReader base64
  │  └─ 总量超 50 MB → 终止(MAX_EMBEDDED_IMAGE_BYTES)
  │
  ▼
invokeBackend('markdown_to_docx', { markdown, imageAssets })
  │  imageAssets = { url: base64-no-prefix, ... }
  │
  ▼
[插件后端] convert::markdown_to_docx(markdown, image_assets)
  │  ├─ base64 解码出 raw bytes → HashMap<url, Vec<u8>>
  │  ├─ build_docx(&markdown, &decoded_assets)
  │  │   ├─ Inline::Image { url } 命中 → Pic::new(&bytes).size(EMU 6×4 inch)
  │  │   └─ 未命中 → 维持 v3.1 占位文字(alt + URL)
  │  ├─ render_table 加列宽 (9000 / col_count twips ≈ 6.25 inch)
  │  ├─ render_code_block 检测 mermaid/katex/markmap lang 时追加 "(前端渲染)"
  │  └─ 8 + 2 = 10 个测试用例覆盖
  │
  ▼
return base64(DOCX zip) → runExport 流程同上
```

### 8.4 HTML 导出链路

```
用户点击「导出为 HTML」
  │
  ▼
ExportToolbarButton.handleExportHtml()
  │
  ▼
invokeBackend('markdown_to_html', { markdown })
  │
  ▼
[后端] convert::markdown_to_html()  — 与 PDF 路径**完全相同**的 HTML 响应
  │
  ▼
return html string
  │
  ▼
runExport('html', ...):
  save() — 弹出保存对话框 (filter: html/htm)
  │
  ▼
invoke('write_binary_file', { path, data: htmlB64 }) — 写入文件
  │
  ▼
toast.success(strings.exportSuccess)
```

**没有** PDF 多段渲染 / canvas / jsPDF,只有 `markdown_to_html` → `write_binary_file`。浏览器打开的样式与 PDF 完全一致(同一份 HTML + 内置 CSS),但 mermaid.js 渲染由浏览器端触发(通过 `markdown_to_html` 输出的 `<script>` 标签或宿主页面预加载)。

### 8.5 笔记内容获取(v2 起不再订阅事件)

本插件**不**订阅宿主事件总线——宿主在每次 `toolbarButton` 渲染时直接通过 props 注入当前笔记的 Markdown 文本和路径：

```
[宿主] useEditorStore → currentTab.content
  │
  ▼
createToolbarButtonProps(plugin, store)
  │
  ▼
<ToolbarButtonProps>.activeNoteContent : string
<ToolbarButtonProps>.activeNotePath   : string | null
  │
  ▼
ExportToolbarButton(props)  — 直接解构
```

> 历史：本插件 v1 实现里用过 `events.on('note:change', ...)` 同步笔记内容，但 v2 起改用 prop 注入，避免插件在挂载/卸载边界处漏掉事件或 race condition。`manifest.permissions` 也因此去掉了 `'events'`。

如果插件确实需要响应笔记变化（例如想持续轮询），仍然可以订阅事件总线。SDK 暴露的 `ToolbarButtonProps` 同时保留 `events: PluginEventBus` 字段。

---

## 9. 常见问题

### Q: 后端二进制放在哪里？宿主怎么找到它？

宿主按以下顺序查找：

1. `<plugin_path>/backend/plugin_<plugin_id>[.exe]`
2. `<plugin_path>/backend/<plugin_id>[.exe]`

其中 `plugin_path` 是安装时解压的目录（`<app_data_dir>/plugins/<id>/.versions/upload/`）。

### Q: invokeBackend 报错 "plugin backend not found"

检查：
1. `manifest.json` 中 `hasBackend` 是否为 `true`
2. `backend/` 目录是否存在
3. 二进制文件名是否正确（`plugin_com.swallownote.export`，不是 `plugin_com_swallownote_export`）
4. 二进制是否有可执行权限（`chmod +x`）

### Q: invokeBackend 报错 "failed to write to plugin stdin"

后端进程可能已崩溃。宿主会在下次调用时自动重启子进程。如果持续失败，检查后端代码是否有 panic。

### Q: 前端构建后 index.js 太大

确保 `react`、`react-dom` 等宿主已提供的库放在 `devDependencies` 中。Vite IIFE 模式会将所有 `dependencies` 打包进去。

### Q: 后端进程什么时候启动？什么时候退出？

- **启动**：首次 `invokeBackend` 调用时懒启动
- **复用**：同一插件的后续调用复用同一进程
- **重启**：进程崩溃后下次调用自动重启
- **退出**：插件卸载时宿主调用 `kill_plugin_backend` 终止进程

### Q: 如何调试后端？

1. 在 `main.rs` 中使用 `eprintln!()` 输出调试信息（宿主会记录到日志）
2. 手动运行二进制并输入 JSON-RPC 请求：
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"markdown_to_docx","params":{"markdown":"# Hello"}}' | \
     ./backend/plugin_com.swallownote.export
   ```

### Q: 如何添加新的后端命令？

1. 在 `convert.rs` 中实现新函数
2. 在 `main.rs` 的 `handle_request()` 中添加新的 `match` 分支
3. 前端通过 `invokeBackend('new_command', { ... })` 调用

### Q: 插件独立性如何保证？

| 检查项 | 验证方法 |
|---|---|
| 主应用 `src/` 中无插件代码 | `grep -r "com.swallownote.export" src/` 应无结果 |
| 主应用 `src-tauri/` 中无插件代码 | `grep -r "swallownote_plugin_export" src-tauri/src/` 应无结果 |
| 主应用 `Cargo.toml` 无插件依赖 | 不含 `swallownote-plugin-export`、`docx-rs`、`pulldown-cmark` |
| 删除插件目录后主应用可编译 | `npx tsc --noEmit && npx vite build && cd src-tauri && cargo check` |
