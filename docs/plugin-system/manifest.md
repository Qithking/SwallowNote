# Manifest 字段说明

`manifest` 是插件导出的核心对象，宿主通过它了解插件的身份、视觉位置、可选能力。

## 必填字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 全局唯一标识，建议反向域名（如 `com.example.my-plugin`）。卸载后再次安装会复用同一存储目录。 |
| `name` | `string` | 卡片标题、菜单、设置页面中的显示名。 |
| `description` | `string` | 一句话说明。卡片副标题 + 设置 dialog header。 |
| `version` | `string` | 语义化版本号，仅做展示用。 |
| `author` | `string` | 插件作者。 |
| `icon` | `ComponentType<{ size?: number }> \| ReactNode` | 触发器图标。`sidebar` 时显示在 ActivityBar，`editorToolbar` 时显示在编辑器工具栏。 |
| `panel` | `ComponentType<PluginPanelProps> \| ReactNode` | 主面板内容。 |

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

## 元数据字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `publishedAt` | `string` (ISO 8601) | 首次发布日期。仅展示用。 |
| `order` | `number` | 触发器在同 `iconPosition` 内的排序，数字越小越靠前。 |
| `enabled` | `boolean` | 初始启用状态。宿主加载后会同步到运行时。 |
| `hasBackend` | `boolean` | 是否携带 Rust 后端。如果为 `true`，插件目录必须包含 `backend/` 子目录。 |
| `pluginPath` | `string` | **由 loader 填充**，留空即可。 |
| `hooks` | `object` | 生命周期钩子（见 [lifecycle.md](./lifecycle.md)） |
| `settings` | `ComponentType<PluginPanelProps> \| ReactNode` | 可选设置组件（见 [settings.md](./settings.md)） |
| `permissions` | `PluginPermission[]` | 声明插件需要的权限（见下方） |

## 权限字段（`permissions`）

插件在 `manifest.permissions` 中**声明**所需权限，宿主在安装/首次使用时弹窗授权，运行时由沙箱强制执行。

| 取值 | 含义 | 何时被检查 |
| --- | --- | --- |
| `'storage'` | 持久化键值存储 | `store.get / set / delete / clear / keys` 全部调用 |
| `'events'` | 订阅宿主事件 | `events.on('note:open', ...)` 等订阅时 |
| `'context-menu'` | 贡献右键菜单项 | `registerContextMenu(...)` 注册时 |
| `'backend'` | 调用 Rust 后端 | `invokeBackend('cmd', args)` 调用时 |
| `'filesystem-read'` | 读文件 | 未来 FS API 启用时 |
| `'filesystem-write'` | 写文件 | 未来 FS API 启用时 |
| `'network'` | 网络请求 | 未来 net API 启用时 |
| `'clipboard'` | 剪贴板读写 | 未来 clipboard API 启用时 |
| `'notifications'` | 系统通知 | 未来 notifications API 启用时 |

```typescript
const manifest: PluginManifest = {
  id: 'com.example.recent-notes',
  // ...
  permissions: ['storage', 'events', 'context-menu'],
}
```

**最佳实践**：

- **最小权限原则**：只声明实际用到的权限。一个只用 `usePluginStorage` 的插件不要声明 `events`。
- **运行时检查**：`events.on` 内部会读取 handler 上的 `__pluginId` 字段并查询 `assertPermission(pluginId, 'events', ...)`，未授权时抛 `PluginPermissionDeniedError`。
- **撤销即时生效**：用户在插件管理页撤销某条权限后，下一次 `store.get / events.on` 等调用立即报错，无需重启宿主。

> **SDK 集成**：`usePluginEvent` / `usePluginEvents` 在订阅时会自动给 handler 打 `__pluginId` 标签，宿主总线据此执行权限检查。`usePluginStorage` / `registerContextMenu` 同样在内部走宿主 `assertPermission`，无需插件作者额外处理。

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

  // 可选
  settings: MySettingsDialog,
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

## 源码引用

- TS 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginDefinition` / `PluginManifest`
- 加载逻辑：[src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts)
- 插件注册表：[src/stores/plugin.ts](../../src/stores/plugin.ts) `usePluginStore`
