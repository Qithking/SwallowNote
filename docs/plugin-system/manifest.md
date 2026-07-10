# Manifest 字段说明

`manifest` 是插件导出的核心对象，宿主通过它了解插件的身份、视觉位置、可选能力。

## 核心字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | :---: | --- |
| `id` | `string` | ✅ | 全局唯一标识，建议反向域名（如 `com.example.my-plugin`）。卸载后再次安装会复用同一存储目录。 |
| `name` | `string` | ✅ | 卡片标题、菜单、设置页面中的显示名。 |
| `description` | `string` | ❌ | 一句话说明。卡片副标题 + 设置 dialog header。 |
| `version` | `string` | ❌ | 语义化版本号，仅做展示用。 |
| `author` | `string` | ❌ | 插件作者。 |
| `icon` | `ComponentType<{ size?: number }> \| ReactNode` | ❌ | 触发器图标。`sidebar` 时显示在 ActivityBar，`editorToolbar` 时显示在编辑器工具栏。 |
| `panel` | `ComponentType<PluginPanelProps> \| ReactNode` | ❌ | 主面板内容。 |

## 位置字段

| 字段 | 类型 | 取值 | 说明 |
| --- | --- | --- | --- |
| `iconPosition` | `IconPosition` | `'sidebar'` / `'editorToolbar'` / `'titleBar'` | 触发器显示位置 |
| `contentPosition` | `ContentPosition` | `'leftPanel'` / `'rightPanel'` / `'fullPanel'` / `'editorArea'` | 面板显示位置 |

**搭配矩阵**：

| iconPosition \ contentPosition | leftPanel | rightPanel | fullPanel | editorArea |
| --- | --- | --- | --- | --- |
| `sidebar` | ✅ 经典侧边栏 | ✅ 右侧抽屉 | ✅ 全屏（无触发器时） | ⚠️ 少见 |
| `editorToolbar` | ✅ 工具栏+左侧 | ✅ 工具栏+右侧 | ❌ | ✅ 编辑器内浮层 |
| `titleBar` | ✅ 标题栏+左侧 | ✅ 标题栏+右侧 | ❌ | ❌ |

> **最佳实践**：`sidebar` + `fullPanel` 是最常见的组合（ActivityBar 图标 + 全屏内容）。`leftPanel` / `rightPanel` 用于需要常驻的辅助面板（Git 状态、AI 对话等）。

## 可选字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | :---: | --- |
| `toolbarButton` | `ComponentType<ToolbarButtonProps> \| ReactNode` | ❌ | 可选自定义工具栏按钮组件，替代默认图标按钮。详见下方 [ToolbarButtonProps](#toolbarbuttonprops)。 |
| `editorFileExtensions` | `string[]` | ❌ | 可渲染的文件扩展名（带点小写，如 `['.smm']`）。同一扩展名仅允许一个插件注册，需声明 `'editor'` 权限。 |
| `editorComponent` | `ComponentType<{ content: string; onChange: (content: string) => void }>` | ❌ | 匹配 `editorFileExtensions` 的文件渲染组件，接收 `content` 与 `onChange`。 |
| `publishedAt` | `string` (ISO 8601) | ❌ | 首次发布日期。仅展示用。 |
| `order` | `number` | ❌ | 触发器在同 `iconPosition` 内的排序，数字越小越靠前。 |
| `enabled` | `boolean` | ❌ | 初始启用状态。宿主加载后会同步到运行时。 |
| `hasBackend` | `boolean` | ❌ | 是否携带 Rust 后端。支持 `true` / `false`，默认为 `false`（省略时等同 `false`）。如果为 `true`，插件目录必须包含 `backend/` 子目录。 |
| `pluginPath` | `string` | ❌ | **由 loader 填充**，留空即可。 |
| `hooks` | `object` | ❌ | 生命周期钩子（见 [lifecycle.md](./lifecycle.md)） |
| `settings` | `ComponentType<PluginPanelProps> \| ReactNode` | ❌ | 可选设置组件（见 [settings.md](./settings.md)） |
| `permissions` | `PluginPermission[]` | ❌ | 声明插件需要的权限（见下方） |
| `dependencies` | `PluginDependency[]` | ❌ | 插件间依赖声明。安装时由 `resolveDependencies` 消费，详见下方 [PluginDependency](#plugindependency)。 |
| `commandPalette` | `string[]` | ❌ | 贡献给命令面板的命令 id 列表。命令通过 SDK 的 `registerCommand` 注册，此处仅做声明性索引，供冲突检测使用。 |
| `autoUpdate` | `boolean` | ❌ | 用户 opt-in 的自动更新标志，持久化在 localStorage。宿主 store 持有权威值，清单字段仅作初始镜像。 |

### PluginDependency

```typescript
interface PluginDependency {
  id: string       // 依赖的插件 id
  version: string  // semver 范围，空或 * 匹配任意
}
```

## 权限字段（`permissions`）

插件在 `manifest.permissions` 中**声明**所需权限，宿主在安装/首次使用时弹窗授权，运行时由沙箱强制执行。

| 取值 | 含义 | 何时被检查 |
| --- | --- | --- |
| `'storage'` | 持久化键值存储 | `store.get / set / delete / clear / keys / entries` 全部调用 |
| `'events'` | 订阅宿主事件 | `events.on('note:open', ...)` 等订阅时 |
| `'context-menu'` | 贡献右键菜单项 | `registerContextMenu(...)` 注册时 |
| `'backend'` | 调用 Rust 后端 | `invokeBackend('cmd', args)` 调用时 |
| `'filesystem-read'` | 读文件 | 未来 FS API 启用时 |
| `'filesystem-write'` | 写文件 | 未来 FS API 启用时 |
| `'network'` | 网络请求 | 未来 net API 启用时 |
| `'clipboard'` | 剪贴板读写 | 未来 clipboard API 启用时 |
| `'notifications'` | 系统通知 | 未来 notifications API 启用时 |
| `'editor'` | 注册自定义文件编辑器 | `registerEditor(pluginId, extension, component)` 注册时 |

```typescript
const manifest: PluginManifest = {
  id: 'com.example.recent-notes',
  // ...
  permissions: ['storage', 'events', 'context-menu'],
}
```

**最佳实践**：

- **最小权限原则**：只声明实际用到的权限。一个只用 `usePluginStorage` 的插件不要声明 `events`。
- **运行时检查**：宿主使用 `createPluginEventBus(pluginId)` 创建每个插件的事件总线实例，当插件调用 `events.on()` 时，宿主会自动为 handler 打上 `__pluginId` 标签并查询 `assertPermission(pluginId, 'events', ...)`，未授权时抛 `PluginPermissionDeniedError`。**插件作者无需手动为 handler 添加 `__pluginId`**。
- **撤销即时生效**：用户在插件管理页撤销某条权限后，下一次 `store.get / events.on` 等调用立即报错，无需重启宿主。

> **SDK 集成**：`usePluginEvent` / `usePluginEvents` 不再手动给 handler 打 `__pluginId` 标签——标签由宿主在 `events.on()` 调用时自动注入。`usePluginStorage` / `registerContextMenu` 同样在内部走宿主 `assertPermission`，无需插件作者额外处理。

## 完整 manifest 示例

```typescript
import type { PluginDefinition } from '@/types/plugin'

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

  // 可选能力
  settings: MySettingsDialog,
  toolbarButton: MyToolbarButton,           // 自定义工具栏按钮（替代默认图标）
  editorFileExtensions: ['.smm'],           // 声明可渲染的扩展名（需 'editor' 权限）
  editorComponent: MyEditor,                // 匹配扩展名时挂载的编辑器组件
  commandPalette: ['my-plugin:run'],        // 贡献的命令面板 id

  // 依赖与更新
  dependencies: [{ id: 'com.example.core', version: '^1.0.0' }],
  autoUpdate: true,

  hooks: {
    onLoad: async (ctx) => { /* ... */ },
    onUnload: (ctx) => { /* ... */ },
  },

  // 运行时（loader 填充）
  pluginPath: '',
  hasBackend: false,
}

export default manifest
```

## Rust 端元数据：`manifest.json`

> 这是 Rust 端读取的 JSON 元数据文件，与上面的 JS manifest 配套。**只放需要 Rust 知道的字段**（id / name / version / hasBackend / entry）。

**字段命名约定**：`manifest.json` 使用 **camelCase**（如 `iconPosition`、`contentPosition`、`hasBackend`、`publishedAt`），因为该文件主要由前端 TypeScript 读取。打包时，各插件的 `vite.config.ts` 会读取 `manifest.json`，把字段转成 **snake_case**（如 `icon_position`、`content_position`、`has_backend`、`published_at`），并以 `// @swallow-manifest { ... }` 注释形式注入到 `dist/index.js` 顶部。Rust 端 `parse_manifest_from_index_js` 解析该注释，用 `serde::Deserialize` 反序列化为 `PluginMetadataRust` 结构体（字段为 snake_case，以匹配 Rust 命名习惯）。

下面示例展示的是 **Rust serde 消费格式**（snake_case），即 `// @swallow-manifest` 注释里的形态；前端开发者手写的 `manifest.json` 请用 camelCase。

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.2.3",
  "author": "Jane Doe",
  "has_backend": false,
  "entry": "index.tsx"
}
```

完整 Rust 端 schema 见 `src-tauri/src/commands/plugin.rs`。

## 宿主注入的 Props 字段

`panel`、`settings` 组件接收 `PluginPanelProps`，`toolbarButton` 组件接收 `ToolbarButtonProps`。这些 Props 由宿主在渲染时注入，**不需要在 manifest.json 中声明**，但插件组件可以直接使用。

### PluginPanelProps

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `close` | `() => void` | 关闭当前插件面板 |
| `isActive` | `boolean` | 当前面板是否处于激活/可见状态 |
| `pluginId` | `string` | 插件 ID |
| `invokeBackend` | `(command: string, args?: Record<string, unknown>) => Promise<unknown>` | 调用插件后端命令 |
| `store` | `PluginStorage` | 插件作用域的持久化键值存储 |
| `events` | `PluginEventBus` | 宿主事件总线，可订阅主题/笔记/语言/设置变更 |
| `activeNoteContent` | `string` | 当前活动笔记的内容（Markdown 字符串）。无活动笔记时为空字符串 |
| `activeNotePath` | `string` | 当前活动笔记的文件路径。无活动笔记时为空字符串 |
| `getSetting` | `<T>(key: string) => Promise<T \| null>` | 按 schema 读取单个设置值，缺失时回退到 schema 默认值并返回 `null` |
| `setSetting` | `<T>(key: string, value: T) => Promise<void>` | 持久化单个设置键（写穿 SQLite） |
| `getAllSettings` | `() => Promise<Record<string, unknown>>` | 读取所有设置为扁平 key/value map，缺失键回退到 schema 默认值 |
| `onSettingsChange` | `(handler: (settings: Record<string, unknown>) => void) => () => void` | 订阅设置变化，返回取消订阅函数 |
| `getActiveNoteFrontmatter` | `() => Record<string, unknown> \| null` | 获取当前笔记的 frontmatter 对象，无活动笔记时返回 `null` |
| `setActiveNoteFrontmatter` | `(data: Record<string, unknown>) => void` | 合并更新当前笔记的 frontmatter，无活动笔记时为空操作 |
| `onNoteFrontmatterChanged` | `(callback: (data: Record<string, unknown>) => void) => () => void` | 监听 frontmatter 变更事件，返回取消订阅函数 |

### ToolbarButtonProps

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `size` | `number` | 当前工具栏上下文推荐的图标尺寸（`editorToolbar`/`titleBar` 为 14px，`sidebar` 为 18px） |
| `isActive` | `boolean` | 插件面板是否处于激活状态 |
| `pluginId` | `string` | 插件 ID |
| `invokeBackend` | `(command: string, args?: Record<string, unknown>) => Promise<unknown>` | 调用插件后端命令 |
| `store` | `PluginStorage` | 插件作用域的持久化键值存储 |
| `events` | `PluginEventBus` | 宿主事件总线 |
| `activate` | `() => void` | 激活插件（根据 `contentPosition` 显示面板） |
| `deactivate` | `() => void` | 停用插件（隐藏面板） |
| `activeNoteContent` | `string` | 当前活动笔记的内容（Markdown 字符串）。无活动笔记时为空字符串 |
| `activeNotePath` | `string` | 当前活动笔记的文件路径。无活动笔记时为空字符串 |
| `activeNoteName` | `string` | 活动笔记文件名（末段），无活动笔记时为空字符串 |
| `activeNoteExt` | `string` | 活动笔记扩展名（小写无点，如 `md`），无活动笔记或无扩展名时为空字符串 |
| `isActiveNoteMarkdown` | `boolean` | 活动笔记是否为 Markdown 文件（`.md`/`.markdown`） |
| `getSetting` | `<T>(key: string) => Promise<T \| null>` | 按 schema 读取单个设置值，详见 [PluginPanelProps](#pluginpanelprops) |
| `setSetting` | `<T>(key: string, value: T) => Promise<void>` | 持久化单个设置键 |
| `getAllSettings` | `() => Promise<Record<string, unknown>>` | 读取所有设置 |
| `onSettingsChange` | `(handler: (settings: Record<string, unknown>) => void) => () => void` | 订阅设置变化 |
| `getActiveNoteFrontmatter` | `() => Record<string, unknown> \| null` | 获取活动笔记 frontmatter |
| `setActiveNoteFrontmatter` | `(data: Record<string, unknown>) => void` | 合并更新活动笔记 frontmatter |
| `onNoteFrontmatterChanged` | `(callback: (data: Record<string, unknown>) => void) => () => void` | 监听 frontmatter 变更 |

> **提示**：`activeNoteContent` 和 `activeNotePath` 是宿主实时注入的只读字段，插件无需订阅事件即可获取当前笔记信息。当用户切换笔记时，宿主会自动更新这些值并触发组件重渲染。`ToolbarButtonProps` 额外提供 `activeNoteName` / `activeNoteExt` / `isActiveNoteMarkdown`，便于工具栏按钮按文件类型切换行为（如仅在 `.md` 文件上高亮）。

## 源码引用

- TS 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginDefinition` / `PluginManifest`
- 加载逻辑：[src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts)
- 插件注册表：[src/stores/plugin.ts](../../src/stores/plugin.ts) `usePluginStore`
