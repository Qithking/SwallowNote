# SwallowNote 插件开发指南

> 让你能够**只看本文档**就完成一个生产级插件的开发、调试、打包、上传与更新。

---

## 目录

1. [快速决策：选哪种开发模式？](#快速决策选哪种开发模式)
2. [5 分钟上手：写一个最小可运行插件](#5-分钟上手写一个最小可运行插件)
3. [Manifest 字段权威参考](#manifest-字段权威参考)
4. [宿主 API 全集](#宿主-api-全集)
   - [持久化存储](#持久化存储)
   - [事件总线](#事件总线)
   - [右键菜单贡献](#右键菜单贡献)
   - [设置面板](#设置面板)
   - [Rust 后端](#rust-后端)
5. [8 个生命周期钩子](#8-个生命周期钩子)
6. [权限系统](#权限系统)
7. [包结构与打包](#包结构与打包)
8. [独立开发：@swallow-note/plugin-sdk + plugin-template](#独立开发swallow-noteplugin-sdk--plugin-template)
9. [从源码定位：模块地图](#从源码定位模块地图)
10. [调试与常见错误](#调试与常见错误)
11. [发布与更新](#发布与更新)

---

## 快速决策：选哪种开发模式？

| 你的身份 | 推荐模式 | 文档 |
| --- | --- | --- |
| 第三方作者，没有 SwallowNote 源码 | 独立开发（`@swallow-note/plugin-sdk` + template） | [第 8 节](#独立开发swallow-noteplugin-sdk--plugin-template) |
| SwallowNote 维护者，要随主仓一起改 | 项目内开发（`src/lib/plugin-samples/`） | [第 2 节](#5-分钟上手写一个最小可运行插件) |
| 写一个简单 demo / 一次性脚本 | 单文件 `.tsx` 拷到任何地方 | [第 8 节：方法 C](#方法-c单文件-demo) |

> **本文档的第 2-7 节以"项目内开发"为例** —— 概念和 API 与独立开发 100% 一致，后者只是把宿主实现替换成 SDK 内的 stub（开发用）和宿主真实实现（运行时通过 `setHost` 接管）。详见 [第 8 节](#独立开发swallow-noteplugin-sdk--plugin-template)。

---

## 5 分钟上手：写一个最小可运行插件

### 1) 文件结构

最小可运行插件只需要两个文件：

```
hello-world/
├── manifest.json     # Rust 端读取的元数据
├── index.tsx         # JS 入口（动态 import）
└── README.md         # （可选）插件说明
```

> 完整结构（含后端、SDK 软链等）见 [第 7 节](#包结构与打包)。

### 2) `manifest.json`（Rust 端）

Rust 端**只读这一份 JSON** 来决定插件 id / 名称 / 是否带后端：

```json
{
  "id": "com.example.hello-world",
  "name": "Hello World",
  "description": "A minimal example plugin",
  "version": "0.1.0",
  "author": "Your Name",
  "iconPosition": "sidebar",
  "contentPosition": "fullPanel",
  "hasBackend": false,
  "entry": "index.tsx"
}
```

> JSON 字段命名是 snake_case（`has_backend`、`icon_position`），由 Rust 端 `serde::Deserialize` 解析。JS manifest（下面）用 camelCase。两边独立，**不要** 误以为它们是同一份。

### 3) `index.tsx`（JS 端）

```tsx
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'

// ─── 图标（侧边栏） ────────────────────────────────────────────
function HelloIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    </svg>
  )
}

// ─── 面板内容 ──────────────────────────────────────────────────
function HelloPanel({ pluginId }: PluginPanelProps) {
  return (
    <div style={{ padding: 24 }}>
      <h1>Hello, world!</h1>
      <p>Plugin ID: <code>{pluginId}</code></p>
    </div>
  )
}

// ─── Manifest ─────────────────────────────────────────────────
const manifest: PluginDefinition = {
  id: 'com.example.hello-world',
  name: 'Hello World',
  description: 'A minimal example plugin',
  version: '0.1.0',
  author: 'Your Name',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 0,
  enabled: true,
  icon: HelloIcon,
  panel: HelloPanel,
  pluginPath: '',  // loader 自动填充
  hasBackend: false,
  // 没有用 storage / events / context-menu / backend 时
  // permissions 不需要声明
  permissions: [],
}

export default manifest
```

### 4) 打包 + 上传

```bash
# 在 hello-world/ 目录外
zip -r hello-world.zip hello-world/
```

打开 SwallowNote → Settings → Plugins → **Upload** → 选 `hello-world.zip` → 启用 → 侧边栏出现图标 → 点击 → 全屏面板 "Hello, world!"。

### 5) 验证清单

- [x] 侧边栏出现新图标（看 `iconPosition: 'sidebar'`）
- [x] 点击图标主区域出现面板（看 `contentPosition: 'fullPanel'`）
- [x] 控制台无错误（打开 DevTools 看）

---

## Manifest 字段权威参考

`PluginDefinition` 是 host 在 runtime 使用的形态，`PluginManifest` 是从 `index.js` 动态 import 出来的原始形态；二者**字段名相同**，loader 会合并/覆盖（见 [plugin-loader.ts](../../src/lib/plugin-loader.ts)）。

### 字段总表

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :---: | --- | --- |
| `id` | `string` | ✅ | — | 全局唯一。**反向域名**建议。卸载后再次安装会复用同一存储目录 |
| `name` | `string` | ✅ | — | 卡片标题、菜单、设置 header |
| `description` | `string` | ❌ | `''` | 一句话说明 |
| `version` | `string` | ❌ | `'0.0.0'` | semver。展示用 |
| `author` | `string` | ❌ | `''` | 展示用 |
| `publishedAt` | `string` (ISO 8601) | ❌ | `''` | 展示用 |
| `iconPosition` | `IconPosition` | ✅ | — | 见下表 |
| `contentPosition` | `ContentPosition` | ✅ | — | 见下表 |
| `order` | `number` | ❌ | `100` | 同一 `iconPosition` 内的排序，**数字越小越靠前** |
| `enabled` | `boolean` | ❌ | `true` | 初始启用状态。运行时切换会写盘 |
| `icon` | `ComponentType<{size?: number}> \| ReactNode` | ✅ | — | 触发器图标 |
| `panel` | `ComponentType<PluginPanelProps> \| ReactNode` | ✅ | — | 主面板内容 |
| `settings` | `ComponentType<PluginPanelProps> \| ReactNode` | ❌ | `undefined` | 设置 dialog 组件。**未声明则不显示齿轮按钮** |
| `permissions` | `PluginPermission[]` | ❌ | `[]` | 见 [权限系统](#权限系统) |
| `hooks` | `LifecycleHooks` | ❌ | `{}` | 8 个钩子，见 [生命周期钩子](#8-个生命周期钩子) |
| `pluginPath` | `string` | ❌ | `''` | **loader 自动填充**，写空字符串 |
| `hasBackend` | `boolean` | ❌ | `false` | 是否带 Rust 后端。**与 `manifest.json` 的 `has_backend` 保持一致** |

### `iconPosition` 与 `contentPosition` 搭配矩阵

| iconPosition \ contentPosition | leftPanel | rightPanel | fullPanel | editorArea |
| --- | :---: | :---: | :---: | :---: |
| `sidebar` | ✅ 经典侧边栏 | ✅ 右侧抽屉 | ✅ 全屏（推荐） | ⚠️ 少见 |
| `editorToolbar` | ✅ 工具栏+左侧 | ✅ 工具栏+右侧 | ❌ | ✅ 编辑器内浮层 |
| `titleBar` | ✅ 标题栏+左侧 | ✅ 标题栏+右侧 | ❌ | ❌ |

> **最佳实践**：`sidebar` + `fullPanel`（ActivityBar + 全屏）是最常见组合。`leftPanel` / `rightPanel` 用于常驻辅助面板（Git 状态、AI 对话）。

### `PluginPanelProps`（panel 组件接收的 props）

```typescript
interface PluginPanelProps {
  close: () => void                          // 关闭面板
  isActive: boolean                          // 面板当前是否可见/活跃
  pluginId: string                           // 插件 id
  invokeBackend: (cmd, args?) => Promise<unknown>  // 调用 Rust 后端
  store: PluginStorage                       // 持久化键值
  events: PluginEventBus                     // 事件订阅
  activeNoteContent: string                  // 当前活跃笔记的 markdown 内容（宿主提供）
  activeNotePath: string                     // 当前活跃笔记的文件路径（宿主提供）
}
```

> `settings` 组件接收**完全相同**的 props（但 `isActive === false`，因为是 modal）。

> **`activeNoteContent` / `activeNotePath` 使用提示**：这两个属性由宿主直接提供当前活跃笔记的内容和路径，插件无需订阅 `note:change` 事件即可获取当前笔记内容。这一点非常重要——插件挂载时，初始的 `note:change` 事件已经触发完毕，基于事件的内容获取可能错过初始内容。如果需要实时跟踪笔记变化，仍可结合 `usePluginEvent(panel, 'note:change', ...)` 使用。

`ToolbarButtonProps`（`iconPosition: 'editorToolbar'` 时 icon 组件接收的 props）同样包含 `activeNoteContent` 和 `activeNotePath`。

### 完整 manifest 示例

```typescript
const manifest: PluginDefinition = {
  // 身份
  id: 'com.example.my-plugin',
  name: 'My Plugin',
  description: 'Does one thing well',
  version: '1.2.3',
  author: 'Jane Doe',
  publishedAt: '2026-06-10',

  // 位置
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 10,
  enabled: true,

  // 视觉
  icon: MyIcon,
  panel: MyPanel,

  // 可选
  settings: MySettingsDialog,
  hooks: {
    onLoad: async (ctx) => { /* 注册菜单、订阅事件 */ },
    onUnload: (ctx) => { /* 清理 */ },
  },
  permissions: ['storage', 'events'],

  // 运行时（loader 填充）
  pluginPath: '',
  hasBackend: false,
}

export default manifest
```

---

## 宿主 API 全集

### 持久化存储

每个插件有独立的 JSON 文件：`<app_data>/plugins/<pluginId>/storage.json`。**键以插件 id 命名空间隔离**。

#### 5 个方法

```typescript
interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}
```

值必须 JSON 安全（无函数、无循环引用）。`null` 表示"键不存在"。

#### 两种使用方式

**方式 1：panel 内 React hook（推荐）**

```typescript
import { usePluginStorage } from '@/lib/plugin-hooks'

function CounterPanel(panel: PluginPanelProps) {
  const [count, setCount] = usePluginStorage<number>(panel, 'count', 0)
  // setCount 接受：新值 / 函数式更新 / null（删除 key）
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

**方式 2：模块级 helper（用于 onLoad/onUnload/事件 handler）**

```typescript
import { getPluginStorage } from '@/lib/plugin-host'

const store = getPluginStorage('com.example.my-plugin')
await store.set('lastLogin', new Date().toISOString())
```

> **实现细节（重要）**：
> - 写盘通过 `writePromise` 串行化（[plugin-host.ts:244-269](../../src/lib/plugin-host.ts#L244-L269)），`set(a,1); set(b,2)` 只触发一次磁盘写
> - `mutationCount` 计数器保证并发 `set` 时数据不丢失
> - 卸载时磁盘文件**保留**，内存缓存丢弃；显式 `clear()` 才真正清空

完整文档：[storage.md](./storage.md)

---

### 事件总线

#### 9 个内置事件

| 事件 | Payload | 触发时机 | 实现位置 |
| --- | --- | --- | --- |
| `note:open` | `{ noteId, path }` | 编辑器创建新 tab | `src/stores/editor.ts` |
| `note:close` | `{ noteId, path }` | 编辑器关闭 tab | 同上 |
| `note:save` | `{ noteId, path }` | 写盘成功 | `src/stores/files.ts` |
| `note:change` | `{ noteId, path, content }` | 编辑器内容变化 | `src/stores/editor.ts` |
| `theme:change` | `{ theme }` | 用户切换主题 | `src/stores/ui.ts` |
| `locale:change` | `{ locale }` | 用户切换语言 | 同上 |
| `settings:change` | `{ key, value }` | 用户修改任意设置项 | 同上 |
| `app:ready` | `{}` | 应用启动完成 | `src/App.tsx` |
| `app:exit` | `{}` | 应用开始关闭 | `src/App.tsx` |

#### 三种使用方式

**panel 内 hook（推荐）**

```typescript
import { usePluginEvent, usePluginEvents } from '@/lib/plugin-hooks'

function MyPanel(panel: PluginPanelProps) {
  // 单事件
  usePluginEvent(panel, 'theme:change', (p) => {
    console.log('theme:', p.theme)
  })

  // 多事件（共享一个 effect，handler 内分支）
  usePluginEvents(panel, ['note:open', 'note:close'], (event, p) => {
    console.log(event, p.path)
  })
  return <div>...</div>
}
```

> **陷阱**：`usePluginEvents` 的 `events` 参数在 effect deps 里——**必须 module-scope 常量**，不能用 `as const` 数组字面量（每次 render 都是新引用，导致反复重建订阅）。详见 [theme-watcher.tsx](../../src/lib/plugin-samples/theme-watcher.tsx) 的 `WATCHED_EVENTS`。

**模块级 bus（用于生命周期钩子）**

```typescript
import { pluginEventBus } from '@/lib/plugin-host'

let unsubscribe: (() => void) | null = null
function onLoad(ctx: { pluginId: string }) {
  unsubscribe = pluginEventBus.on('note:change', (p) => {
    console.log(p.path)
  })
}
function onUnload() {
  unsubscribe?.()
  unsubscribe = null
}
```

**emit 自己合成的事件**

```typescript
import { pluginEventBus, emitSettingChanged } from '@/lib/plugin-host'

// 通用
pluginEventBus.emit('settings:change', { key: 'foo', value: 42 })

// 类型安全的 helper（推荐）
emitSettingChanged('my-plugin:last-clicked', 42)
```

> **错误隔离**：bus 内部 `try/catch` 每个 handler 的调用，一个 plugin 抛异常不影响其他订阅者。

> **`__pluginId` 自动打标签**：宿主使用 `createPluginEventBus(pluginId)` 创建每个插件的事件总线实例。当插件调用 `events.on()` 时，宿主会自动为每个 handler 打上 `__pluginId` 标签，用于权限检查和插件卸载时的自动清理。**插件作者无需手动为 handler 添加 `__pluginId`**。SDK 的 `usePluginEvent` 和 `usePluginEvents` hooks 也不再手动添加 `__pluginId`——标签由宿主在 `events.on()` 调用时自动注入。

完整文档：[events.md](./events.md)

---

### 右键菜单贡献

#### 5 个注入位置

| Location | 触发场景 | 是否已接入 |
| --- | --- | :---: |
| `fileTree` | 文件树节点右键 | ✅ |
| `fileTreeEmpty` | 文件树空白区右键 | ⚠️ 预留 |
| `editor` | 编辑器内右键 | ✅ |
| `tab` | tab 上右键 | ✅ |
| `tabBarEmpty` | tab bar 空白处右键 | ⚠️ 预留 |

#### API

```typescript
import { registerContextMenu, unregisterContextMenu } from '@/lib/plugin-menu'

interface ContextMenuItem {
  id: string                                 // 稳定 id（必填，建议加 namespace）
  label: string                              // 菜单项文字
  iconName?: string                          // lucide icon 名（见下）
  locations?: ContextMenuLocation[]          // 缺省 = 全部 5 个位置
  when?: (ctx: ContextMenuContext) => boolean // 谓词，false 隐藏
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

interface ContextMenuContext {
  location: ContextMenuLocation
  path?: string          // 触发处的路径（fileTree/tab/editor）
  isDirectory?: boolean  // 是否目录
  activePath?: string    // 当前激活 tab 的路径
  selection?: string     // 编辑器选中文本
}
```

#### 完整示例

```typescript
function onLoad(ctx: { pluginId: string }) {
  // 1. 文件树节点上的"复制路径"
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:copy-path',
    label: 'Copy path to clipboard',
    iconName: 'Copy',
    locations: ['fileTree', 'tab'],
    onClick: async (mctx) => {
      if (!mctx.path) return
      await navigator.clipboard.writeText(mctx.path)
    },
  })

  // 2. 编辑器选中文本时显示"翻译"
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:translate',
    label: 'Translate selection',
    iconName: 'ExternalLink',
    locations: ['editor'],
    when: (mctx) => !!mctx.selection && mctx.selection.length > 0,
    onClick: (mctx) => {
      console.log('Translating:', mctx.selection)
    },
  })
}

function onUnload(ctx: { pluginId: string }) {
  unregisterContextMenu(ctx.pluginId, 'my-plugin:copy-path')
  unregisterContextMenu(ctx.pluginId, 'my-plugin:translate')
  // host 卸载插件时也会自动调 clearPluginMenuItems
}
```

#### iconName 白名单

支持 32 个 lucide name（不区分大小写）：

```
FileText, Settings, Trash2, Edit3, Copy, Scissors, ClipboardPaste,
Save, Download, Upload, Search, Eye, Code, Terminal, Play, Square,
Pause, RefreshCw, FolderPlus, FilePlus, GitBranch, GitCommit,
GitMerge, Star, Heart, Bookmark, Link, ExternalLink, Plus, Minus,
Check, X
```

> 未知 name 渲染为 `FileText`。完整列表见 [PluginContextMenuItems.tsx](../../src/components/Plugin/PluginContextMenuItems.tsx) `ICON_MAP`。

完整文档：[context-menu.md](./context-menu.md)

---

### 设置面板

#### 声明

```typescript
const manifest: PluginDefinition = {
  // ...
  panel: MyMainPanel,
  settings: MySettingsDialog,  // ← 声明后齿轮按钮才会出现
}
```

#### Props：与 panel 完全相同

```typescript
function MySettings(panel: PluginPanelProps) {
  const [apiKey, setApiKey] = usePluginStorage(panel, 'apiKey', '')
  return (
    <div className="p-4 space-y-3">
      <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      <button onClick={panel.close}>Close</button>
    </div>
  )
}
```

#### Dialog 行为

- 宽度 `max-w-2xl`、高度 `max-h-[80vh]`（内部 scroll）
- 标题：`{plugin.name} — {t('plugin.settings')}`
- 关闭：点击遮罩 / ESC / `panel.close()`

> **生命周期**：打开 mount → `onMount(ctx)`；关闭 unmount → `onUnmount(ctx)`。

完整文档：[settings.md](./settings.md)

---

### Rust 后端

需要时携带 Tauri command 作为后端（解析大文件、跑复杂计算、调用系统 API）。

#### 包结构

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

#### Rust command 示例

```rust
// backend/src/lib.rs
use tauri::command;

#[command]
pub fn count_words(text: String) -> u32 {
    text.split_whitespace().count() as u32
}
```

#### 前端调用

```typescript
function MyPanel(panel: PluginPanelProps) {
  const handle = async () => {
    const result = await panel.invokeBackend<number>('count_words', { text: 'hello' })
    console.log(result)  // 1
  }
  return <button onClick={handle}>Count</button>
}
```

#### 协议细节（**必读**）

实际 IPC 走的是 **JSON-RPC over stdin/stdout**，但**TS 端的 `panel.invokeBackend` 已经封装好**：

```
TS panel ─invoke('plugin_<id>_<cmd>', args)─▶ Rust host (plugin_invoke)
                                                       │
                                                       ▼
                                              spawn <id>/backend/plugin_<id>
                                                  JSON-RPC 2.0
                                                  (line-delimited)
```

实现：[`src-tauri/src/commands/plugin_invoke.rs`](../../src-tauri/src/commands/plugin_invoke.rs)

**关键点**：
- Rust 端 spawn 一个**长生命周期**的子进程（首次调用 lazy spawn，之后复用）
- 子进程 stdout 关闭 → 全部 pending 请求立即报错
- 单次调用超时 30 秒（`INVOKE_TIMEOUT`）
- 后端进程在插件**卸载前**会被 `kill_plugin` Tauri command 杀死

#### 错误处理

```rust
#[command]
pub fn parse(data: String) -> Result<MyStruct, String> {
    serde_json::from_str(&data).map_err(|e| e.to_string())
}
```

```typescript
try {
  const parsed = await panel.invokeBackend('parse', { data: '...' })
} catch (err) {
  // err.message 是 host 转发的字符串
  console.error('parse failed:', err)
}
```

#### 跨平台编译

```bash
# 三个目标
cargo build --release --target x86_64-unknown-linux-gnu
cargo build --release --target x86_64-apple-darwin
cargo build --release --target x86_64-pc-windows-msvc
```

输出复制到插件包根 `backend/` 下。

完整文档：[backend.md](./backend.md)

---

## 8 个生命周期钩子

```
register         ─► onLoad          (once, after install)
enable toggle    ─► onEnable        (off → on)
disable toggle   ─► onDisable       (on → off)
uninstall        ─► onUnload        (once, before file removal)
panel mounts     ─► onMount         (every mount)
panel unmounts   ─► onUnmount       (every unmount)
panel activated  ─► onActivate      (focus)
panel deactivated─► onDeactivate    (blur)
```

#### `PluginContext`（所有钩子共享的入参）

```typescript
interface PluginContext {
  pluginId: string              // 插件 id
  pluginPath: string            // 插件包绝对路径
  invokeBackend(cmd, args?): Promise<unknown>  // ⚠️ 钩子内调用会抛错
}
```

> **关键**：**钩子内不能调用 `ctx.invokeBackend`**——`buildPluginContext` 返回的 no-op 版本会抛错。后端 IPC 只能在 mounted panel 里通过 `panel.invokeBackend` 调。详见 [plugin-host.ts:474-484](../../src/lib/plugin-host.ts#L474-L484)。

#### 异常隔离

host 内部 `try/catch` 所有钩子（[plugin-host.ts:496-520](../../src/lib/plugin-host.ts#L496-L520)），一个 plugin 抛异常不影响其他插件：

```typescript
// host 内部
async function runLifecycleHook(hook, ctx, hookName) {
  try { await hook(ctx) } catch (err) {
    console.error(`[plugin-host] "${hookName}" failed for ${ctx.pluginId}:`, err)
  }
}
```

#### 完整示例

```typescript
import type { PluginContext, PluginDefinition, PluginPanelProps } from '@/types/plugin'
import { getPluginStorage, pluginEventBus } from '@/lib/plugin-host'
import { registerContextMenu, unregisterContextMenu } from '@/lib/plugin-menu'
import { usePluginStorage, usePluginEvent } from '@/lib/plugin-hooks'

let unsubscribe: (() => void) | null = null

async function onLoad(ctx: PluginContext) {
  const store = getPluginStorage(ctx.pluginId)
  if (!(await store.get('installedAt'))) {
    await store.set('installedAt', new Date().toISOString())
  }
  // 全局事件订阅
  unsubscribe = pluginEventBus.on('note:change', (p) => {
    console.log(`[${ctx.pluginId}] note changed:`, p.path)
  })
  // 右键菜单贡献
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:reindex',
    label: 'Reindex current note',
    iconName: 'RefreshCw',
    locations: ['editor'],
    when: (m) => !!m.path,
    onClick: (m) => console.log('reindex', m.path),
  })
}

function onUnload(ctx: PluginContext) {
  unsubscribe?.()
  unsubscribe = null
  unregisterContextMenu(ctx.pluginId, 'my-plugin:reindex')
}

function MyPanel(panel: PluginPanelProps) {
  const [count, setCount] = usePluginStorage(panel, 'count', 0)
  usePluginEvent(panel, 'note:change', (p) => {
    void setCount(c => c + 1)
  })
  return <div>Count: {count}</div>
}

const manifest: PluginDefinition = {
  // ... 基础字段 ...
  panel: MyPanel,
  hooks: { onLoad, onUnload },
}
```

完整文档：[lifecycle.md](./lifecycle.md)

---

## 权限系统

### 9 个权限

| Permission | 触发的 API | 校验位置 |
| --- | --- | --- |
| `storage` | `store.get / set / delete / clear / keys` | [plugin-host.ts:217-219](../../src/lib/plugin-host.ts#L217-L219) |
| `events` | `events.on(event, handler)` | [plugin-host.ts:64](../../src/lib/plugin-host.ts#L64) |
| `context-menu` | `registerContextMenu(...)` | [plugin-menu.ts:47](../../src/lib/plugin-menu.ts#L47) |
| `backend` | `panel.invokeBackend(...)` | [plugin-utils.tsx:159](../../src/lib/plugin-utils.tsx#L159) |
| `filesystem-read` | 未来 FS API | — |
| `filesystem-write` | 未来 FS API | — |
| `network` | 未来 net API | — |
| `clipboard` | 未来 clipboard API | — |
| `notifications` | 未来 notifications API | — |

### 运行时检查流程

```
plugin 调用 host API
       │
       ▼
assertPermission(pluginId, perm, op)
       │
       ▼
查询 in-memory guard（已 hydrate from localStorage）
       │
       ├── 未授权 → 抛 PluginPermissionDeniedError
       │
       └── 已授权 → 继续执行
```

权限在用户**安装时**通过 dialog 授予并**持久化**到 `window.localStorage`：

```
localStorage['plugin_permissions_<pluginId>'] = [
  { permission: 'storage', granted: true, requested: true },
  { permission: 'events',  granted: true, requested: true },
  ...
]
```

**撤销即时生效**：用户在插件管理页撤销某条权限后，下一次 `store.get` / `events.on` 等调用立即报错。

### 完整示例

```typescript
const manifest: PluginDefinition = {
  // ...
  permissions: ['storage', 'events', 'context-menu'],
}
```

### 常见错误

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `PluginPermissionDeniedError: events permission required` | 用了 `events.on` 但未声明 `events` 权限 | `manifest.permissions` 加 `'events'` |
| 卸载后再次安装弹权限 | localStorage 没记录（不同 id 命名空间） | id 不变即可 |
| 撤销权限后旧代码仍在跑 | 撤销是 lazy 的，运行中已 attach 的订阅不会被清 | 让 `events.on` / `registerContextMenu` 在每次调用时检查 |

> **最小权限原则**：只声明实际用到的权限。一个只用 `usePluginStorage` 的插件不要声明 `events`。

---

## 包结构与打包

### 最小包

```
my-plugin/
├── manifest.json
├── index.tsx
└── README.md
```

### 完整包（含后端）

```
my-plugin/
├── manifest.json
├── index.tsx                  # JS 入口
├── backend/                   # Rust 后端（可选）
│   ├── plugin_<id>            # Linux/macOS 可执行
│   ├── plugin_<id>.exe        # Windows 可执行
│   ├── Cargo.toml
│   └── src/lib.rs
└── README.md
```

### 打包

```bash
# 1) 编译后端（如果有）
cd my-plugin/backend
cargo build --release
cp target/release/libmy_plugin.so ../backend/plugin_com.example.my-plugin
cd ..

# 2) 打包 JS
zip -r my-plugin-v0.1.0.zip my-plugin/ \
  -x 'my-plugin/backend/target/*' \
  -x 'my-plugin/backend/Cargo.lock' \
  -x 'my-plugin/node_modules/*'
```

> **重要**：打包时**必须**包含 `manifest.json`（在插件根目录）和 `index.tsx`（`manifest.json` 的 `entry` 字段指向它）。`backend/` 是可选的。

### 验证清单（发布前）

- [ ] `manifest.json` 的 `id` 与 `index.tsx` 的 `id` 一致
- [ ] `manifest.json` 的 `has_backend` 与 `index.tsx` 的 `hasBackend` 一致
- [ ] `manifest.json` 的 `entry` 指向 `index.tsx`（或你的入口文件名）
- [ ] 后端的可执行文件名是 `plugin_<id>`（Linux/macOS）或 `plugin_<id>.exe`（Windows）
- [ ] 没用到的权限**不要**声明

---

## 独立开发：@swallow-note/plugin-sdk + plugin-template

不想 clone 整个 SwallowNote？使用 SDK 零依赖开发。

### 起步

```bash
cp -r docs/plugin-template ~/code/my-plugin
cd ~/code/my-plugin
npm install         # 通过 file: 协议 link 到本地 SDK
npm run dev         # http://localhost:5173
# 改 src/plugin/index.tsx，HMR 即时生效
npm run build       # → dist/plugin.js + dist/manifest.json
```

### 构建配置（vite.config.ts）

独立开发使用 Vite library mode 构建，关键配置如下：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/MyPlugin.tsx', formats: ['iife'], name: 'MyPlugin', fileName: () => 'plugin.js' },
    rollupOptions: {
      external: [
        'react', 'react-dom', 'react/jsx-runtime',
        'sonner', 'react-i18next', 'i18next',
      ],
      output: {
        inlineDynamicImports: true,  // 必须禁用代码分割，插件加载器使用 blob URL，无法解析相对路径的 chunk 导入
      },
    },
  },
})
```

> **external 说明**：`react` / `react-dom` / `react/jsx-runtime` 由宿主通过 `window.React` / `window.ReactDOM` 提供；`sonner` 由宿主通过 `window.SonnerToast` 提供；`react-i18next` / `i18next` 由宿主通过 `window.ReactI18Next` 提供。这些依赖不需要打包进插件产物，否则会导致体积膨胀或运行时冲突。

> **`inlineDynamicImports` 说明**：插件加载器使用 blob URL 加载插件代码，blob URL 无法解析相对路径的 chunk 文件导入。因此必须设置 `inlineDynamicImports: true` 禁用代码分割，确保所有代码输出到单个 `plugin.js` 文件中。

### SDK 双模式

SDK 的核心：**一份代码、两种运行模式、零分支**。

| 模式 | 何时 | 事件总线 | 存储 | 菜单注册表 | 后端 |
| --- | --- | --- | --- | --- | --- |
| Standalone | `npm run dev` / 浏览器调试 | EventTarget | localStorage | 内存 Map | console.warn + null |
| Host | 加载到 SwallowNote | 真实 bus | Tauri + JSON | 真实 registry | 真实子进程 |

**切换是自动的**：插件代码不需要 `if (host) ... else ...`。host 加载插件时调 `setHost({...})` 替换 stub。

### 完整 SDK API

```typescript
import {
  // Types
  type PluginDefinition,
  type PluginPanelProps,
  type PluginContext,
  type PluginEvent,
  type PluginStorage,
  type ContextMenuItem,
  // Runtime (with host takeover)
  pluginEventBus,
  getPluginStorage,
  registerContextMenu,
  unregisterContextMenu,
  // React hooks
  usePluginStorage,
  usePluginEvent,
  usePluginEvents,
  // Host takeover
  setHost,
  // Dev preview integration
  type HostOverrides,
} from '@swallow-note/plugin-sdk'
```

### 方法 C：单文件 demo

```typescript
// hello.tsx
import type { PluginDefinition } from '@/types/plugin'

function Icon() { return <span>📝</span> }
function Panel() { return <div>Hello</div> }

const manifest: PluginDefinition = {
  id: 'com.example.demo',
  name: 'Demo',
  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  icon: Icon,
  panel: Panel,
  pluginPath: '',
  hasBackend: false,
}

export default manifest
```

拷到 `src/lib/plugin-samples/` 即可在 SwallowNote 内即时看到（仅 dev 模式）。

完整文档：[standalone-development.md](./standalone-development.md)

---

## 从源码定位：模块地图

| 关注点 | 源码位置 |
| --- | --- |
| 类型定义（`PluginDefinition` / `PluginEvent` / `PluginStorage`） | [src/types/plugin.ts](../../src/types/plugin.ts) |
| 事件总线 + 存储 + 生命周期调度 | [src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) |
| 菜单注册表 | [src/lib/plugin-menu.ts](../../src/lib/plugin-menu.ts) |
| React hooks | [src/lib/plugin-hooks.ts](../../src/lib/plugin-hooks.ts) |
| 权限检查 | [src/lib/plugin-permission-guard.ts](../../src/lib/plugin-permission-guard.ts) |
| 权限持久化 | [src/lib/plugin-permissions.ts](../../src/lib/plugin-permissions.ts) |
| 插件加载 + manifest 合并 | [src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts) |
| Panel props 工厂 | [src/lib/plugin-utils.tsx](../../src/lib/plugin-utils.tsx) |
| 插件状态管理（store） | [src/stores/plugin.ts](../../src/stores/plugin.ts) |
| 插件市场 store | [src/stores/plugin-market.ts](../../src/stores/plugin-store.ts) |
| Rust 命令注册 | [src-tauri/src/commands/plugin.rs](../../src-tauri/src/commands/plugin.rs) |
| Rust 后端 IPC | [src-tauri/src/commands/plugin_invoke.rs](../../src-tauri/src/commands/plugin_invoke.rs) |
| 错误类型 | [src-tauri/src/commands/error.rs](../../src-tauri/src/commands/error.rs) |
| 内置示例插件 | [src/lib/plugin-samples/](../../src/lib/plugin-samples/) |
| SDK 实现 | [docs/plugin-sdk/src/index.ts](../plugin-sdk/src/index.ts) |
| 独立开发模板 | [docs/plugin-template/](../plugin-template/) |

---

## 调试与常见错误

### DevTools 调试技巧

**React DevTools**：

- 安装 React DevTools 浏览器扩展
- 在 Components 面板搜索你的插件组件（如 `MyPanel`）
- 可以看到 props（`store` / `events` / `isActive`）

**Console**：

- 所有 host 内部日志前缀 `[plugin-host]` / `[plugin-loader]`
- 权限拒绝会抛 `PluginPermissionDeniedError`，含 `pluginId` / `op`

**Storage 检查**：

```javascript
// 在 DevTools Console
localStorage.getItem('plugin_permissions_com.example.my-plugin')
```

**Tauri DevTools**：

- 设置 `TAURI_DEBUG=1` 启动，host 窗口会附加 devtools
- 插件子进程的 stderr 会输出到 host 日志（前缀 `[plugin:<id>]`）

### 常见错误表

| 错误 | 原因 | 解决 |
| --- | --- | --- |
| 上传后无图标 | `iconPosition` 拼写错误或不是 `sidebar` | 检查 `iconPosition: 'sidebar'` |
| 点击图标无反应 | `contentPosition` 与触发器不匹配 | `fullPanel` 用于全屏；`rightPanel`/`leftPanel` 配合 sidebar |
| 插件重复触发 onLoad | 动态 import 加了 `?v=${Date.now()}` 缓存破坏 | 正常行为，每次 `install_plugin_from_bytes` 都强制重载 |
| `Cannot find module '@/types/plugin'` | 路径别名仅在项目内解析 | 配置 tsconfig.json 的 `paths` |
| 打包后体积巨大 | 包含 `node_modules` | 只打包源码 |
| `PluginPermissionDeniedError` | 用了 API 但未声明 | `manifest.permissions` 加对应权限 |
| 卸载后菜单残留 | 忘了 `onUnload` 里 `unregisterContextMenu` | host 会自动清理，但显式清理是好习惯 |
| `usePluginEvents` 反复重订 | 数组字面量作为依赖 | module-scope 常量 |
| `panel.invokeBackend` 在 hook 里调用 | hook context 没有真实 IPC | 只在 mounted panel 内调用 |
| 后端超时（30s） | 子进程卡死 | 优化后端逻辑；或 catch `err.message === '... timeout ...'` 重试 |

---

## 发布与更新

### 发布流程

1. **Bump 版本**：`manifest.json` 和 `index.tsx` 的 `version` 字段同步 +1
2. **打包**：`zip -r my-plugin-v0.1.0.zip my-plugin/`
3. **上传**：SwallowNote → Settings → Plugins → Upload
4. **更新**：用户点击 "Update" → `update_plugin` 命令解压到新版本目录、保留 storage

### 版本管理（host 行为）

host 自 Phase 9.2 起**对每个插件做版本管理**：

```
<app_data>/plugins/com.example.my-plugin/
├── .versions/
│   ├── 0.1.0/      # 完整快照
│   └── 0.2.0/      # 完整快照
├── current         # 软链接 → .versions/0.2.0
├── .current_version  # 文本回退（Windows）
└── storage.json    # 跨版本保留
```

- **回滚**：保留旧版本目录，swap `current` 软链
- **更新**：装新版本到 `.versions/<new>/`，swap 软链，**storage.json 保留**
- **卸载**：`rm -rf` 整个目录

### 签名验证（市场安装）

从市场安装时 host 会做 ed25519 签名验证：

```typescript
// src/lib/plugin-market.ts: 预校验 SHA-256
// src-tauri/src/commands/plugin.rs: 完整 ed25519 验证
```

如果你的插件要走市场分发，需要发布到 [docs/plugin-marketplace/repo.json](../plugin-marketplace/repo.json) 索引（见 [marketplace/README.md](../plugin-marketplace/README.md)）。

### 升级兼容性建议

- **不要**在 storage key 上做 breaking change
- **不要**删除事件
- 钩子签名变化要在 README 标注 major version bump
- 后端 command 删除要 deprecate 至少 1 个 minor 版本

---

## 附录：完整代码模板

把以下代码作为新插件的起始模板：

```tsx
import { useState, useEffect, type ReactNode } from 'react'
import type {
  PluginDefinition,
  PluginContext,
  PluginPanelProps,
} from '@/types/plugin'
import { getPluginStorage, pluginEventBus } from '@/lib/plugin-host'
import {
  registerContextMenu,
  unregisterContextMenu,
} from '@/lib/plugin-menu'
import {
  usePluginStorage,
  usePluginEvent,
} from '@/lib/plugin-hooks'

// ─── Icon ────────────────────────────────────────────────────
function MyIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

// ─── Panel ───────────────────────────────────────────────────
function MyPanel(panel: PluginPanelProps): ReactNode {
  const [count, setCount] = usePluginStorage(panel, 'count', 0)
  const [active, setActive] = useState(panel.isActive)

  useEffect(() => {
    setActive(panel.isActive)
  }, [panel.isActive])

  usePluginEvent(panel, 'note:change', (p) => {
    console.log('note changed:', p.path)
  })

  return (
    <div className="p-4 text-sm space-y-3">
      <h2 className="font-semibold">
        My Plugin {active ? '•' : ''}
      </h2>
      <div>Plugin ID: <code>{panel.pluginId}</code></div>
      <div>Active note: <code>{panel.activeNotePath || '(none)'}</code></div>
      <div>Count: {count}</div>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
      <button onClick={() => setCount(null)}>Reset</button>
      <button onClick={panel.close}>Close</button>
    </div>
  )
}

// ─── Settings ────────────────────────────────────────────────
function MySettings(panel: PluginPanelProps): ReactNode {
  const [count, setCount] = usePluginStorage(panel, 'count', 0)
  return (
    <div className="p-4 space-y-3">
      <div>Count: {count}</div>
      <button onClick={() => setCount(0)}>Reset</button>
      <button onClick={panel.close}>Close</button>
    </div>
  )
}

// ─── Lifecycle hooks ────────────────────────────────────────
let unsubscribe: (() => void) | null = null

async function onLoad(ctx: PluginContext): Promise<void> {
  const store = getPluginStorage(ctx.pluginId)
  if (!(await store.get('installedAt'))) {
    await store.set('installedAt', new Date().toISOString())
  }
  unsubscribe = pluginEventBus.on('note:save', (p) => {
    console.log(`[${ctx.pluginId}] saved:`, p.path)
  })
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:reindex',
    label: 'Reindex current note',
    iconName: 'RefreshCw',
    locations: ['editor'],
    when: (m) => !!m.path,
    onClick: (m) => console.log('reindex', m.path),
  })
}

function onUnload(ctx: PluginContext): void {
  unsubscribe?.()
  unsubscribe = null
  unregisterContextMenu(ctx.pluginId, 'my-plugin:reindex')
}

function onEnable(ctx: PluginContext): void {
  console.debug(`[my-plugin] enabled (${ctx.pluginId})`)
}

function onDisable(ctx: PluginContext): void {
  console.debug(`[my-plugin] disabled (${ctx.pluginId})`)
}

function onMount(): void { /* no-op */ }
function onUnmount(): void { /* no-op */ }
function onActivate(ctx: PluginContext): void {
  console.debug(`[my-plugin] activated (${ctx.pluginId})`)
}
function onDeactivate(ctx: PluginContext): void {
  console.debug(`[my-plugin] deactivated (${ctx.pluginId})`)
}

// ─── Manifest ────────────────────────────────────────────────
const manifest: PluginDefinition = {
  id: 'com.example.my-plugin',
  name: 'My Plugin',
  description: 'Does one thing well',
  version: '0.1.0',
  author: 'You',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 50,
  enabled: true,
  icon: MyIcon,
  panel: MyPanel,
  settings: MySettings,
  pluginPath: '',
  hasBackend: false,
  permissions: ['storage', 'events', 'context-menu'],
  hooks: {
    onLoad,
    onUnload,
    onEnable,
    onDisable,
    onMount,
    onUnmount,
    onActivate,
    onDeactivate,
  },
}

export default manifest
```

---

## 文档地图

| 想做什么 | 看哪个文档 |
| --- | --- |
| 写第一个插件 | [quickstart.md](./quickstart.md) |
| 查 manifest 字段 | [manifest.md](./manifest.md) |
| 写 lifecycle 钩子 | [lifecycle.md](./lifecycle.md) |
| 用 storage | [storage.md](./storage.md) |
| 订阅事件 | [events.md](./events.md) |
| 加右键菜单 | [context-menu.md](./context-menu.md) |
| 加设置 dialog | [settings.md](./settings.md) |
| 写 Rust 后端 | [backend.md](./backend.md) |
| 独立开发 | [standalone-development.md](./standalone-development.md) |
| 看完整示例 | [plugin-samples/](../plugin-samples/) |
| 走市场分发 | [plugin-marketplace/](../plugin-marketplace/) |

---

> **最后更新**：2026-06-10，Phase 9.9。所有 API 表面与 SDK / host 1:1 对齐。如发现不一致请检查 SDK 版本或向 SwallowNote Team 反馈。
