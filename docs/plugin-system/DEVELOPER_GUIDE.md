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
   - [命令面板贡献](#命令面板贡献)
   - [自定义文件编辑器](#自定义文件编辑器)
   - [编辑器 Tab API](#编辑器-tab-api)
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
| SwallowNote 维护者，要随主仓一起改 | 项目内开发（`src/lib/core-plugins/`） | [第 2 节](#5-分钟上手写一个最小可运行插件) |
| 写一个简单 demo / 一次性脚本 | 单文件 `.tsx` 拷到任何地方 | [第 8 节：方法 C](#方法-c单文件-demo) |

> **本文档的第 2-7 节以"项目内开发"为例** —— 概念和 API 与独立开发 100% 一致，后者只是把宿主实现替换成 SDK 内的 stub（开发用）和宿主真实实现（运行时通过 `setHost` 接管）。详见 [第 8 节](#独立开发swallow-noteplugin-sdk--plugin-template)。

### 插件类型选择

根据你的功能需求选择合适的插件类型：

| 插件类型 | iconPosition | contentPosition | 典型场景 |
|----------|-------------|-----------------|---------|
| 侧边栏面板插件 | `sidebar` | `fullPanel` / `leftPanel` / `rightPanel` | 笔记计数器、AI 助手、文件树增强 |
| 编辑器工具栏插件 | `editorToolbar` | `editorArea` | 格式化按钮、插入模板、快速操作 |
| 标题栏插件 | `titleBar` | `leftPanel` / `rightPanel` | 全局搜索、快速笔记 |
| 自定义文件编辑器 | 省略 | 省略 | 打开 `.smm`/`.canvas` 等自定义格式文件 |
| 纯后台插件 | 省略 | 省略 | 文件监听、自动同步、定时任务 |
| 混合插件 | `sidebar` | `fullPanel` | 既有侧边栏面板又有自定义编辑器 |

> **无 UI 插件**：省略 `iconPosition` 和 `contentPosition` 后，插件不渲染图标和面板，但仍可贡献：生命周期钩子、事件订阅、右键菜单、命令面板、自定义编辑器等。

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

> `manifest.json` 使用 **camelCase**（如 `iconPosition`、`contentPosition`、`hasBackend`、`publishedAt`），由前端 TypeScript 读取。打包时 vite 插件会自动转换为 snake_case 的 `// @swallow-manifest` 注释，供 Rust 端 `serde::Deserialize` 解析。开发者只需维护 camelCase 的 `manifest.json`，无需关心 snake_case 转换。

### 3) `index.tsx`（JS 端）

```tsx
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'

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
const manifest: PluginManifest = {
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
  // 没有用 storage / events / context-menu / backend 时
  // permissions 不需要声明
  permissions: [],
}

export default manifest

// 必须 re-export setHost，否则 tree-shaker 会丢弃该符号，
// 宿主无法通过 setHost 注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'
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
  // —— 设置 API（详见 [设置面板](#设置面板)） ——
  getSetting<T>(key: string): Promise<T | null>             // 读单个设置
  setSetting<T>(key: string, value: T): Promise<void>       // 写单个设置
  getAllSettings(): Promise<Record<string, unknown>>        // 读所有设置
  onSettingsChange(handler): () => void                     // 订阅设置变更
  // —— Frontmatter API（详见 [设置面板](#设置面板)） ——
  getActiveNoteFrontmatter(): Record<string, unknown> | null  // 获取当前笔记 frontmatter
  setActiveNoteFrontmatter(data): void                        // 更新 frontmatter（合并写入）
  onNoteFrontmatterChanged(callback): () => void              // 订阅 frontmatter 变更
}
```

> `settings` 组件接收**完全相同**的 props（但 `isActive === false`，因为是 modal）。`ToolbarButtonProps`（`editorToolbar` 触发器）包含上述全部字段，并额外提供 `activate()` / `deactivate()` / `activeNoteName` / `activeNoteExt` / `isActiveNoteMarkdown`。

> **`activeNoteContent` / `activeNotePath` 使用提示**：这两个属性由宿主直接提供当前活跃笔记的内容和路径，插件无需订阅 `note:change` 事件即可获取当前笔记内容。这一点非常重要——插件挂载时，初始的 `note:change` 事件已经触发完毕，基于事件的内容获取可能错过初始内容。如果需要实时跟踪笔记变化，仍可结合 `usePluginEvent(panel, 'note:change', ...)` 使用。

`ToolbarButtonProps`（`iconPosition: 'editorToolbar'` 时 icon 组件接收的 props）同样包含 `activeNoteContent` 和 `activeNotePath`。

### 完整 manifest 示例

```typescript
const manifest: PluginManifest = {
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
  // 生命周期钩子为扁平字段（非 hooks 对象）
  onLoad: async (ctx) => { /* 注册菜单、订阅事件 */ },
  onUnload: (ctx) => { /* 清理 */ },
  permissions: ['storage', 'events'],
}

export default manifest
```

---

## 宿主 API 全集

### 持久化存储

每个插件有独立的 JSON 文件：`<app_data>/plugins/<pluginId>/storage.json`。**键以插件 id 命名空间隔离**。

#### 6 个方法

```typescript
interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  /** 列出当前插件命名空间所有 key（排序返回） */
  keys(): Promise<string[]>
  /** 所有 key 及 JSON 大小的只读快照，按 size 降序 */
  entries(): Promise<Array<{ key: string; size: number }>>
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

#### 12 个内置事件

| 事件 | Payload | 触发时机 | 实现位置 |
| --- | --- | --- | --- |
| `note:open` | `{ noteId, path }` | 编辑器创建新 tab | `src/stores/editor.ts` |
| `note:close` | `{ noteId, path }` | 编辑器关闭 tab | 同上 |
| `note:save` | `{ noteId, path }` | 写盘成功 | `src/stores/editor.ts` |
| `note:change` | `{ noteId, path, content }` | 编辑器内容变化 | `src/stores/editor.ts` |
| `theme:change` | `{ theme }` | 用户切换主题 | `src/stores/ui.ts` |
| `locale:change` | `{ locale }` | 用户切换语言 | 同上 |
| `settings:change` | `{ key, value }` | 用户修改任意设置项 | 同上 |
| `app:ready` | `{}` | 应用启动完成 | `src/App.tsx` |
| `app:exit` | `{}` | 应用开始关闭 | `src/App.tsx` |
| `plugin-settings:change` | `{ pluginId, values }` | 插件设置变更（`setSetting` 写入后广播） | `src/lib/plugin-host-takeover.ts` |
| `editor:registered` | `{ pluginId, extension }` | 插件注册自定义编辑器 | `src/stores/pluginEditor.ts` |
| `editor:unregistered` | `{ pluginId, extension }` | 插件注销自定义编辑器 | 同上 |

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

> **陷阱**：`usePluginEvents` 的 `events` 参数在 effect deps 里——**必须 module-scope 常量**，不能用 `as const` 数组字面量（每次 render 都是新引用，导致反复重建订阅）。详见 [theme-watcher.tsx](../../src/lib/core-plugins/theme-watcher.tsx) 的 `WATCHED_EVENTS`。

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
import { pluginEventBus, emitSettingChanged, emitPluginSettingsChanged } from '@/lib/plugin-host'

// 通用
pluginEventBus.emit('settings:change', { key: 'foo', value: 42 })

// 类型安全的 helper（推荐）
emitSettingChanged('my-plugin:last-clicked', 42)

// 插件设置变更广播（host 内部使用，插件一般通过 setSetting 间接触发）
emitPluginSettingsChanged('com.example.my-plugin', { apiKey: 'xxx' })
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

### 命令面板贡献

插件可以向宿主命令面板（Ctrl/Cmd+P）贡献命令条目，用户可通过命令面板触发或绑定快捷键。

#### `PluginCommand` 接口

```typescript
import type { PluginCommand } from '@/types/plugin'

interface PluginCommand {
  /** 稳定 id，用于去重、设置键和更新（跨重载必须稳定） */
  id: string
  /** 显示标签，也用作命令面板搜索词 */
  label: string
  /** 可选 lucide-react 图标名，默认 "zap" */
  iconName?: string
  /** 可选分类，默认为插件显示名 */
  category?: string
  /** 可选谓词，返回 false 时在命令面板中隐藏 */
  when?: () => boolean
  /** 触发处理函数 */
  onTrigger: () => void | Promise<void>
}
```

#### API

```typescript
import {
  registerCommand,
  unregisterCommand,
  clearPluginCommands,
  listPluginCommands,
  usePluginCommands,
} from '@/lib/plugin-commands'
// 或独立开发：from '@swallow-note/plugin-sdk'
```

| 函数 | 说明 |
| --- | --- |
| `registerCommand(pluginId, command)` | 注册一条命令（同 id 替换） |
| `unregisterCommand(pluginId, commandId)` | 按 id 注销命令 |
| `clearPluginCommands(pluginId)` | 清除插件全部命令（卸载时宿主自动调用） |
| `listPluginCommands()` | 已注册命令只读快照 |
| `usePluginCommands()` | React hook：订阅命令列表变化，自动过滤 `when()` 返回 false 的项 |

#### 示例

```typescript
function onLoad(ctx: { pluginId: string }) {
  registerCommand(ctx.pluginId, {
    id: 'my-plugin:insert-timestamp',
    label: '插入时间戳',
    iconName: 'Clock',
    onTrigger: () => {
      console.log('insert', new Date().toISOString())
    },
  })
}

function onUnload(ctx: { pluginId: string }) {
  unregisterCommand(ctx.pluginId, 'my-plugin:insert-timestamp')
}
```

> **权限**：命令注册复用 `events` 权限门禁（见 [plugin-commands.ts:21](../../src/lib/plugin-commands.ts#L21)）。未声明 `events` 权限时 `registerCommand` 会抛 `PluginPermissionDeniedError`。

---

### 自定义文件编辑器

插件可以声明对特定扩展名文件的渲染责任，当用户打开匹配文件时宿主挂载插件提供的编辑器组件替代内置 Markdown / 代码编辑器。

#### Manifest 声明

```typescript
const manifest: PluginManifest = {
  // ...
  editorFileExtensions: ['.smm'],   // 带点小写，同一扩展名仅允许一个插件注册
  editorComponent: MyEditor,        // 接收 content / onChange
  permissions: ['editor'],          // 必须声明 editor 权限
}
```

`editorComponent` 组件签名：

```typescript
interface PluginEditorComponent {
  content: string
  onChange: (content: string) => void
}
```

#### 三层机制

1. **清单声明**：`editorFileExtensions` + `editorComponent` 在 manifest 中声明
2. **运行时注册**：插件 `onLoad` 时由宿主自动调用 `registerEditor(pluginId, extension, component)`，或插件主动调用
3. **分发查询**：用户打开文件时，`Editor.tsx` 调用 `getEditorForExtension(ext)` 查找匹配的插件组件，找不到则回退到内置编辑器

#### API

```typescript
import {
  registerEditor,
  unregisterEditor,
  getEditorForExtension,
  getActivePluginExtensions,
} from '@/stores/pluginEditor'
// 或独立开发：from '@swallow-note/plugin-sdk'
```

| 函数 | 说明 |
| --- | --- |
| `registerEditor(pluginId, extension, component)` | 注册编辑器（需 `editor` 权限，扩展名冲突抛错） |
| `unregisterEditor(pluginId)` | 注销该插件全部编辑器（卸载时宿主自动调用） |
| `getEditorForExtension(ext)` | 查询扩展名对应的编辑器，无则返回 `null` |
| `getActivePluginExtensions()` | 当前已注册扩展名只读快照（`Set<string>`） |

> **冲突处理**：同一扩展名仅允许一个插件注册。第二个插件注册时抛 `Error` 并 toast 提示。扩展名会规范化为带点小写（`SMM` → `.smm`）。

> **事件**：注册/注销时会派发 `editor:registered` / `editor:unregistered` 事件（见 [事件总线](#事件总线)）。

---

### 编辑器 Tab API

插件可以在主编辑区打开自定义 tab（如加密笔记、预览视图），由宿主用内置 `MarkdownEditor` 渲染内容，插件通过 `onChange` 回调接收编辑结果并自行存储。

#### `OpenEditorTabProps`

```typescript
interface OpenEditorTabProps {
  /** tab 唯一标识（相同 id 复用已有 tab） */
  id: string
  /** tab 标题文字 */
  name: string
  /** tab 标题图标（替换默认 FileText 图标） */
  icon?: ReactNode
  /** 初始内容（markdown 字符串） */
  content: string
  /** 内容变化回调：用户编辑后宿主调用此函数传回新内容 */
  onChange?: (content: string) => void
  /** 工具栏显示配置（控制各按钮的显示/隐藏） */
  toolbarConfig?: EditorToolbarConfig
}
```

#### `EditorToolbarConfig`

未设置的字段默认显示（向后兼容）。插件 tab 可通过此配置隐藏不适用的功能。

```typescript
interface EditorToolbarConfig {
  copyPath?: boolean                 // 复制完整路径（默认 true）
  openLocation?: boolean            // 在文件夹中显示（默认 true）
  openHistory?: boolean             // 打开历史记录（默认 true）
  noteProperties?: boolean          // 笔记属性面板（默认 true）
  directory?: boolean               // 大纲/目录（默认 true）
  sourceView?: boolean              // 源码视图切换（默认 true）
  noteWidth?: boolean               // 宽窄模式切换（默认 true）
  contentLayout?: boolean           // 内容布局（默认 true）
  downloadRemoteImages?: boolean    // 下载远程图片（默认 true）
  showFilePath?: boolean            // 左侧文件路径显示（默认 true）
  externalChangeWarning?: boolean   // 外部变更警告（默认 true）
  conflictIndicator?: boolean       // 冲突指示器（默认 true）
}
```

#### API

```typescript
import {
  openEditorTab,
  closeEditorTab,
  closePluginTabs,
} from '@swallow-note/plugin-sdk'
```

| 函数 | 说明 |
| --- | --- |
| `openEditorTab(pluginId, props)` | 打开（或复用同 id 的）tab |
| `closeEditorTab(pluginId, tabId)` | 关闭该插件打开的指定 tab（校验归属） |
| `closePluginTabs(pluginId)` | 关闭该插件打开的所有 tab（锁定/卸载时使用） |

#### 示例

```typescript
import { openEditorTab } from '@swallow-note/plugin-sdk'

function onOpenSecretNote(ctx: { pluginId: string }, noteId: string, content: string) {
  openEditorTab(ctx.pluginId, {
    id: noteId,
    name: '加密笔记',
    content,
    onChange: (next) => {
      // 插件负责保存到自己的存储（如加密数据库）
      void saveEncrypted(noteId, next)
    },
    toolbarConfig: { openLocation: false, noteProperties: false },
  })
}
```

> **独立预览模式**：`openEditorTab` / `closeEditorTab` / `closePluginTabs` 在未安装 host 时（`npm run dev`）打印警告并 no-op，因为没有主编辑区可打开。生产环境通过 `setHost` 注入真实实现。

---

### 设置面板

#### 声明

```typescript
const manifest: PluginManifest = {
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

#### 设置 API

除 `usePluginStorage` 外，插件可通过 `PluginPanelProps` 上的设置 API 读写插件专属设置（持久化在 SQLite 表 `plugin_settings_<id>`，由宿主 `settings.json` schema 描述）：

```typescript
interface PluginPanelProps {
  // ...
  getSetting<T>(key: string): Promise<T | null>             // 读单个设置
  setSetting<T>(key: string, value: T): Promise<void>       // 写单个设置
  getAllSettings(): Promise<Record<string, unknown>>        // 读所有设置
  onSettingsChange(handler): () => void                     // 订阅设置变更
}
```

```typescript
function MyPanel(panel: PluginPanelProps) {
  const [apiKey, setApiKey] = useState<string | null>(null)
  useEffect(() => {
    void panel.getSetting<string>('apiKey').then(setApiKey)
    return panel.onSettingsChange((values) => {
      setApiKey((values.apiKey as string) ?? null)
    })
  }, [panel])
  return <input value={apiKey ?? ''} onChange={(e) => panel.setSetting('apiKey', e.target.value)} />
}
```

模块级 API（用于生命周期钩子等非 panel 场景）：

```typescript
import { getSetting, setSetting, getAllSettings, onSettingsChange } from '@swallow-note/plugin-sdk'

await getSetting('com.example.my-plugin', 'apiKey')
await setSetting('com.example.my-plugin', 'apiKey', 'xxx')
await getAllSettings('com.example.my-plugin')
const off = onSettingsChange('com.example.my-plugin', (values) => { /* ... */ })
```

> **权限**：设置 API 复用 `storage` 权限。`setSetting` 写入后会广播 `plugin-settings:change` 事件，所有同插件 id 的 panel / toolbar 实例都会收到通知。

#### Frontmatter API

插件可读写当前活动笔记的 frontmatter（YAML 元数据）：

```typescript
interface PluginPanelProps {
  // ...
  getActiveNoteFrontmatter(): Record<string, unknown> | null  // 无活动笔记返回 null
  setActiveNoteFrontmatter(data: Partial<NoteFrontmatter>): void  // 合并写入
  onNoteFrontmatterChanged(callback): () => void              // 订阅变更
}
```

```typescript
function MyPanel(panel: PluginPanelProps) {
  // 给当前笔记打标签
  const handleAddTag = () => {
    const fm = panel.getActiveNoteFrontmatter() ?? {}
    const tags = Array.isArray(fm.tags) ? fm.tags as string[] : []
    if (!tags.includes('reviewed')) {
      panel.setActiveNoteFrontmatter({ tags: [...tags, 'reviewed'] })
    }
  }
  // 监听 frontmatter 变化
  useEffect(() => {
    return panel.onNoteFrontmatterChanged((data) => {
      console.log('frontmatter changed:', data)
    })
  }, [panel])
  return <button onClick={handleAddTag}>标记为已审阅</button>
}
```

> **合并语义**：`setActiveNoteFrontmatter` 做浅合并（类似 `Object.assign`），不会清空未传入的字段。无活动笔记时为空操作。

完整文档：[settings.md](./settings.md)

---

### 国际化（i18n）

宿主使用 `react-i18next` 进行国际化，已通过 vite external 外部化（`react-i18next` / `i18next` 由宿主 `window.ReactI18Next` 提供）。插件可以直接使用宿主的 i18n 实例。

#### 在插件中使用 i18n

```typescript
import { useTranslation } from 'react-i18next'

function MyPanel(panel: PluginPanelProps) {
  const { t } = useTranslation()
  return (
    <div>
      <h2>{t('my-plugin.title', 'My Plugin')}</h2>
      <button>{t('my-plugin.save', 'Save')}</button>
    </div>
  )
}
```

> **注意**：`useTranslation` 返回的 `t` 函数来自宿主的 i18next 实例。插件的翻译 key 需要通过宿主注册，或插件自行初始化 i18next。

#### 监听语言切换

通过 `locale:change` 事件监听语言变化（payload 为 `{ locale: string }`）：

```typescript
import { usePluginEvent } from '@swallow-note/plugin-sdk'

function MyPanel(panel: PluginPanelProps) {
  usePluginEvent(panel, 'locale:change', (payload) => {
    console.log('语言切换为:', payload.locale)
    // 可以在此重新加载翻译资源
  })
  // ...
}
```

#### locale 格式

宿主使用 BCP 47 语言标签：

- `'zh'` — 简体中文
- `'en'` — 英文
- `'ja'` — 日文

#### 推荐做法

1. 使用带命名空间的 key（如 `my-plugin.xxx`）避免与其他插件冲突
2. `t` 函数的第二个参数作为 fallback 字符串，在翻译缺失时显示
3. 如果插件翻译量大，考虑自建 i18next 实例而非依赖宿主

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

#### Rust 后端实现

后端是独立的 stdin/stdout 子进程，**不依赖 Tauri 框架**。通信使用 JSON-RPC 2.0：宿主按行写入请求到子进程 stdin，子进程按行把响应写回 stdout。

> 完整协议说明（生命周期、错误码、Cargo.toml、日志、命名约定）和编译指南见 [backend.md](./backend.md)。

下面是最小可运行的 `main.rs` 示例：按行读取 stdin、解析 JSON-RPC 请求、分发到对应方法、把响应写回 stdout。

```rust
// backend/src/main.rs
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout().lock();

    // 按行读取 stdin：每行是一个 JSON-RPC 请求
    for line in stdin.lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => continue };
        let req: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,  // 解析失败：跳过（生产环境应返回 parse error）
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(serde_json::Value::Null);

        // 分发到对应方法
        let result = match method {
            "count_words" => {
                let text = params.get("text").and_then(|t| t.as_str()).unwrap_or("");
                serde_json::json!(text.split_whitespace().count())
            }
            _ => continue,  // 未知方法：生产环境应返回 method not found
        };

        // 有 id 的是请求，需要返回响应；无 id 的是通知，忽略
        if let Some(id) = id {
            let resp = serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result });
            writeln!(out, "{}", resp).unwrap();
        }
    }
}
```

> 错误处理：返回 JSON-RPC `error` 对象（如 `{"code": -32603, "message": "..."}`）即可，宿主会把 `message` 转成 `PluginError` 抛给前端。完整示例见 [backend.md](./backend.md)。

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
  invokeBackend(cmd, args?): Promise<unknown>  // 调用 Rust 后端
}
```

> **注意**：钩子内的 `ctx.invokeBackend` 行为取决于运行模式：
> - **host 模式**：正常调用 Rust 后端（通过 `invoke_plugin` command）
> - **standalone 模式**：打印 `console.warn` 并返回 `null`（无 Tauri runtime）
>
> 因此，如果钩子需要调用后端，建议在 `onMount`/`onActivate` 中调用（此时面板已挂载，可通过 `panel.invokeBackend` 调用），而非在 `onLoad` 中。

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
import type { PluginContext, PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
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

const manifest: PluginManifest = {
  // ... 基础字段 ...
  panel: MyPanel,
  onLoad,
  onUnload,
}
```

完整文档：[lifecycle.md](./lifecycle.md)

---

## 权限系统

### 10 个权限

| Permission | 触发的 API | 校验位置 |
| --- | --- | --- |
| `storage` | `store.get / set / delete / clear / keys / entries` | [plugin-host.ts:348-350](../../src/lib/plugin-host.ts#L348-L350) |
| `events` | `events.on(event, handler)` / `registerCommand(...)` | [plugin-host.ts:101](../../src/lib/plugin-host.ts#L101) |
| `context-menu` | `registerContextMenu(...)` | [plugin-menu.ts:47](../../src/lib/plugin-menu.ts#L47) |
| `backend` | `panel.invokeBackend(...)` | [plugin-host-takeover.ts:100](../../src/lib/plugin-host-takeover.ts#L100) |
| `editor` | `registerEditor(...)` | [pluginEditor.ts:91](../../src/stores/pluginEditor.ts#L91) |
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
const manifest: PluginManifest = {
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
npm run build       # → dist/index.js + dist/manifest.json
```

### 构建配置（vite.config.ts）

独立开发使用 Vite library mode 构建，产物为 **ES 模块**（`formats: ['es']`），与官方模板和示例一致：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [react()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'src/MyPlugin.tsx'),
          formats: ['es'],
          fileName: () => 'index.js',
        },
        rollupOptions: {
          external: [
            'react', 'react-dom', 'react-dom/client',
            'react/jsx-runtime', 'react/jsx-dev-runtime',
            'sonner', 'react-i18next', 'i18next',
          ],
          output: {
            inlineDynamicImports: true,  // 禁用代码分割，blob URL 无法解析分块导入
          },
        },
      },
    }
  }
  return { plugins: [react()], server: { port: 5173, open: true } }
})
```

> **external 说明**：`react` / `react-dom` / `react/jsx-runtime` 由宿主通过 `window.React` / `window.ReactDOM` 提供；`sonner` 由宿主通过 `window.SonnerToast` 提供；`react-i18next` / `i18next` 由宿主通过 `window.ReactI18Next` 提供。这些依赖不需要打包进插件产物，否则会导致体积膨胀或运行时冲突。

> **`inlineDynamicImports` 说明**：插件加载器使用 blob URL 加载插件代码，blob URL 无法解析相对路径的 chunk 文件导入。因此必须设置 `inlineDynamicImports: true` 禁用代码分割，确保所有代码输出到单个 `index.js` 文件中。

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
  type PluginManifest,
  type PluginPanelProps,
  type PluginContext,
  type PluginEvent,
  type PluginStorage,
  type ContextMenuItem,
  type PluginCommand,
  type OpenEditorTabProps,
  type EditorToolbarConfig,
  // Runtime (with host takeover)
  pluginEventBus,
  getPluginStorage,
  registerContextMenu,
  unregisterContextMenu,
  // 命令面板
  registerCommand,
  unregisterCommand,
  clearPluginCommands,
  listPluginCommands,
  // 文件编辑器
  registerEditor,
  unregisterEditor,
  getEditorForExtension,
  getActivePluginExtensions,
  // 编辑器 Tab
  openEditorTab,
  closeEditorTab,
  closePluginTabs,
  // 设置 API（模块级）
  getSetting,
  setSetting,
  getAllSettings,
  onSettingsChange,
  // React hooks
  usePluginStorage,
  usePluginEvent,
  usePluginEvents,
  usePluginCommands,
  // Host takeover
  setHost,
  // Dev preview integration
  type HostOverrides,
  // Emit helpers（dev preview）
  emitPluginSettingsChanged,
} from '@swallow-note/plugin-sdk'

// 插件入口必须 re-export setHost，否则 tree-shaker 会丢弃该符号
export { setHost } from '@swallow-note/plugin-sdk'
```

### 方法 C：单文件 demo

```typescript
// hello.tsx
import type { PluginManifest } from '@swallow-note/plugin-sdk'

function Icon() { return <span>📝</span> }
function Panel() { return <div>Hello</div> }

const manifest: PluginManifest = {
  id: 'com.example.demo',
  name: 'Demo',
  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  icon: Icon,
  panel: Panel,
}

export default manifest
```

拷到 `src/lib/core-plugins/` 即可在 SwallowNote 内即时看到（仅 dev 模式）。

完整文档：[standalone-development.md](./standalone-development.md)

---

## 从源码定位：模块地图

| 关注点 | 源码位置 |
| --- | --- |
| 类型定义（`PluginManifest` / `PluginDefinition` / `PluginEvent` / `PluginStorage` / `PluginCommand`） | [src/types/plugin.ts](../../src/types/plugin.ts) |
| 事件总线 + 存储 + 生命周期调度 | [src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) |
| 宿主接管（`setHost` override 工厂） | [src/lib/plugin-host-takeover.ts](../../src/lib/plugin-host-takeover.ts) |
| 菜单注册表 | [src/lib/plugin-menu.ts](../../src/lib/plugin-menu.ts) |
| 命令面板注册表 | [src/lib/plugin-commands.ts](../../src/lib/plugin-commands.ts) |
| 文件编辑器注册表 | [src/stores/pluginEditor.ts](../../src/stores/pluginEditor.ts) |
| 插件设置（SQLite 缓存层） | [src/lib/plugin-settings/index.ts](../../src/lib/plugin-settings/index.ts) |
| React hooks | [src/lib/plugin-hooks.ts](../../src/lib/plugin-hooks.ts) |
| 权限检查 | [src/lib/plugin-permission-guard.ts](../../src/lib/plugin-permission-guard.ts) |
| 权限持久化 | [src/lib/plugin-permissions.ts](../../src/lib/plugin-permissions.ts) |
| 插件加载 + manifest 合并 | [src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts) |
| Panel props 工厂 | [src/lib/plugin-utils.tsx](../../src/lib/plugin-utils.tsx) |
| 插件状态管理（store） | [src/stores/plugin.ts](../../src/stores/plugin.ts) |
| 插件市场 store | [src/stores/plugin-market.ts](../../src/stores/plugin-market.ts) |
| Rust 命令注册 | [src-tauri/src/commands/plugin.rs](../../src-tauri/src/commands/plugin.rs) |
| Rust 后端 IPC | [src-tauri/src/commands/plugin_invoke.rs](../../src-tauri/src/commands/plugin_invoke.rs) |
| Rust 插件设置 IPC | [src-tauri/src/commands/plugin_settings.rs](../../src-tauri/src/commands/plugin_settings.rs) |
| 错误类型 | [src-tauri/src/commands/error.rs](../../src-tauri/src/commands/error.rs) |
| 内置示例插件 | [src/lib/core-plugins/](../../src/lib/core-plugins/) |
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
| `panel.invokeBackend` 在 hook 里调用 | host 模式可用但 standalone 模式返回 null | 优先在 `onMount`/`onActivate` 中通过 `panel.invokeBackend` 调用 |
| 后端超时（30s） | 子进程卡死 | 优化后端逻辑；或 catch `err.message === '... timeout ...'` 重试 |

---

## 性能最佳实践

### 事件订阅

- `note:change` 是**高频事件**（每次按键触发），监听时务必防抖：

```typescript
import { useRef } from 'react'

function MyPanel(panel: PluginPanelProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const unsub = panel.events.on('note:change', () => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        // 防抖后的逻辑
      }, 300)
    })
    return unsub
  }, [])
}
```

- `usePluginEvents` 的 `events` 数组必须是 **module-scope 常量**，否则每次渲染都会重新订阅
- 避免在事件 handler 中同步读取 `activeNoteContent`（大文件会阻塞）

### 存储

- `store.get` 会异步读盘，避免在渲染路径中调用——用 `usePluginStorage` hook 自动管理
- `entries()` 会遍历所有键并计算 size，不要在高频路径中调用
- 大数据（>1MB）考虑分片或使用后端文件系统

### 渲染

- 插件面板是 React 组件，遵循 React 性能最佳实践（`useMemo`、`useCallback`、`React.memo`）
- 大列表使用虚拟滚动（`react-window` 或类似库）
- 避免在 `render` 中调用 `store.get` / `getSetting` 等异步 API

### 后端通信

- `invokeBackend` 有 30 秒超时，长时间任务考虑分批返回
- 后端子进程空闲 10 分钟会被自动回收，下次调用有 spawn 延迟
- 避免频繁调用 `invokeBackend`（每次都有 IPC 开销），考虑批量化

## 错误处理最佳实践

### API 调用失败

```typescript
try {
  const result = await panel.invokeBackend('my_command', args)
} catch (err) {
  // invokeBackend 错误：超时、子进程崩溃、命令不存在
  console.error('后端调用失败:', err)
  // 向用户展示友好的错误提示
  toast.error('操作失败，请重试')
}

try {
  await panel.store.set('key', value)
} catch (err) {
  // 存储失败：磁盘满、权限问题
  console.error('存储失败:', err)
}
```

### 权限被拒绝

当插件使用了未声明的权限时，SDK 会抛出 `PluginPermissionDeniedError`：

```typescript
import { PluginPermissionDeniedError } from '@swallow-note/plugin-sdk'

try {
  await panel.store.set('key', 'value')
} catch (err) {
  if (err instanceof PluginPermissionDeniedError) {
    console.warn(`权限不足: ${err.operation}，请在 manifest 中声明 'storage' 权限`)
  }
}
```

### 生命周期钩子报错

钩子内的异常会被宿主 try/catch 捕获，不会崩溃宿主，但会记录错误日志。超时（5 秒）会触发 `PluginLifecycleTimeoutError`。

### 降级处理

当 API 不可用时（如 standalone 模式），考虑降级方案：

```typescript
const result = await panel.invokeBackend('count_words', { text })
  .catch(() => {
    // 后端不可用时，用前端降级方案
    return text.split(/\s+/).filter(Boolean).length
  })
```

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

### 版本兼容性

#### SDK 版本

`@swallow-note/plugin-sdk` 当前版本为 `0.1.0`（见导出的 `SDK_VERSION` 常量）。SDK 版本与宿主版本独立演进：

- **Minor 版本升级**（如 0.1.0 → 0.2.0）：可能新增 API，不破坏现有 API
- **Major 版本升级**（如 0.x → 1.0.0）：可能移除已废弃 API，需要插件适配

#### 兼容性策略

- 宿主加载插件时会解析 `// @swallow-manifest` 注释中的 `version` 字段
- SDK 的 stub 实现保证了 standalone 模式下的向后兼容（旧 API 调用不会崩溃）
- 新增的 API（如 `registerCommand`、`openEditorTab`）在旧版宿主上会走 stub（no-op + warn）
- 插件可以通过 `SDK_VERSION` 在运行时检查 SDK 版本

#### Breaking Changes

目前处于 `0.x` 阶段，API 可能调整。正式 1.0 发布后将遵循语义化版本（SemVer）：

- 新增功能：minor 版本升级
- Bug 修复：patch 版本升级
- 破坏性变更：major 版本升级

---

## FAQ

### 插件上传后不显示

检查以下几点：
1. `dist/index.js` 头部是否有 `// @swallow-manifest` 注释（vite.config 的 `inject-manifest-comment` 插件）
2. `manifest.json` 的 `id` 是否唯一（不能与已有插件重复）
3. `manifest.json` 的 `iconPosition` 是否正确设置
4. 查看宿主控制台（`F12` → Console）是否有加载错误

### storage 数据在卸载后还在

这是设计行为。`store` 的数据持久化在 `<app_data>/plugins/<pluginId>/storage.json`，卸载插件不会删除数据。重新安装同一插件会恢复数据。如需彻底清除，用户需在设置中"删除插件数据"。

### 如何在 dev 模式下测试后端调用

standalone 模式下 `invokeBackend` 返回 `null`（无 Tauri runtime）。要测试后端调用，需要在宿主中安装插件。`plugin-template` 的 `preview.tsx` 提供了前端 UI 的独立预览，但不支持后端测试。

### usePluginStorage 返回的值初始为 undefined

`usePluginStorage` 是异步的——首次渲染返回 `initialValue`，`store.get` 完成后触发重渲染更新为存储值。如果需要 loading 状态，检查 `value === initialValue` 是否为初始状态。

### 插件面板不刷新

Zustand 的 selector 订阅需要返回稳定的引用。如果 selector 返回新对象/数组，每次 store 变化都会触发重渲染。使用 `useShallow` 包装：

```typescript
const { a, b } = useUIStore(useShallow(s => ({ a: s.a, b: s.b })))
```

### 如何支持多语言

宿主使用 `react-i18next`，已通过 vite external 外部化。插件可以直接使用 `useTranslation` hook：

```typescript
import { useTranslation } from 'react-i18next'

function MyPanel() {
  const { t } = useTranslation()
  return <div>{t('my-plugin.hello')}</div>
}
```

翻译资源需要通过宿主的 i18n 系统注册，或使用插件自己的 i18next 实例。`locale:change` 事件可用于监听语言切换。

---

## 附录：完整代码模板

把以下代码作为新插件的起始模板：

```tsx
import { useState, useEffect, type ReactNode } from 'react'
import type {
  PluginManifest,
  PluginContext,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
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
const manifest: PluginManifest = {
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
  // 仅声明实际用到的权限：命令面板复用 events；自定义编辑器需 editor
  permissions: ['storage', 'events', 'context-menu'],
  // 生命周期钩子为扁平字段（非 hooks 对象）
  onLoad,
  onUnload,
  onEnable,
  onDisable,
  onMount,
  onUnmount,
  onActivate,
  onDeactivate,
}

export default manifest

// 必须 re-export setHost，否则 tree-shaker 会丢弃该符号，
// 宿主无法通过 setHost 注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'
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
| 看完整示例 | [内置插件示例](../../src/lib/core-plugins/) |
| 走市场分发 | [plugin-marketplace/](../plugin-marketplace/) |

---

> **最后更新**：2026-07-10，Phase 9.9。所有 API 表面与 SDK / host 1:1 对齐。如发现不一致请检查 SDK 版本或向 SwallowNote Team 反馈。
