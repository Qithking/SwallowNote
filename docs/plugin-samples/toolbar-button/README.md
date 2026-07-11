# Toolbar Button 示例

展示 `iconPosition: 'editorToolbar'` + 自定义 `toolbarButton` 组件 + `ToolbarButtonProps` 全量字段。

**学习目标**：把插件入口挂在编辑器工具栏（而非侧边栏），并用自定义组件替代默认图标按钮。

## 与 hello-world 的区别

| 维度 | hello-world | toolbar-button |
| --- | --- | --- |
| `iconPosition` | `sidebar` | `editorToolbar` |
| `contentPosition` | `fullPanel` | `editorArea` |
| 入口组件 | `icon`（SVG） | `toolbarButton`（自定义按钮） |
| 侧边栏图标 | 有 | 无 |

当 `iconPosition` 为 `editorToolbar` 时，宿主不再渲染侧边栏图标，而是把 `toolbarButton` 组件挂到编辑器顶部工具栏。点击按钮调用 `activate()` 后，`panel` 按 `contentPosition: 'editorArea'` 在编辑器区域展开。

## 文件

- [manifest.json](./manifest.json) — `iconPosition: "editorToolbar"`、`contentPosition: "editorArea"`
- [index.tsx](./index.tsx) — `toolbarButton` 组件 + 面板

## ToolbarButtonProps 字段

`toolbarButton` 组件接收 `ToolbarButtonProps`，关键字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `size` | `number` | 工具栏推荐图标尺寸，按钮宽高应跟随此值 |
| `isActive` | `boolean` | 当前插件面板是否已激活（用于高亮按钮） |
| `pluginId` | `string` | 当前插件 ID |
| `activate()` | `() => void` | 按 `contentPosition` 展开面板 |
| `deactivate()` | `() => void` | 收起面板 |
| `activeNoteName` | `string` | 活动笔记文件名（无点无扩展名），无笔记时为空串 |
| `activeNoteExt` | `string` | 活动笔记小写扩展名（无点前缀），无笔记或无扩展名时为空串 |
| `isActiveNoteMarkdown` | `boolean` | 活动笔记是否为 `.md` 文件 |
| `activeNoteContent` | `string` | 活动笔记内容，无笔记时为空串 |
| `activeNotePath` | `string` | 活动笔记完整路径，无笔记时为空串 |
| `invokeBackend` | `(cmd, args?) => Promise<unknown>` | 调用插件后端命令（需 `backend` 权限） |
| `store` | `PluginStorage` | 插件作用域持久化存储（需 `storage` 权限） |
| `events` | `PluginEventBus` | 宿主事件总线（需 `events` 权限） |
| `getSetting` / `setSetting` / `getAllSettings` / `onSettingsChange` | — | 插件设置读写与订阅 |
| `getActiveNoteFrontmatter` / `setActiveNoteFrontmatter` / `onNoteFrontmatterChanged` | — | 活动笔记 frontmatter 读写与订阅 |

## 预期效果

- 编辑器顶部工具栏出现一个自定义按钮（带方框图标）
- 鼠标悬停显示当前活动笔记的文件名、扩展名、是否 Markdown
- 点击按钮 → 编辑器区域展开面板，展示笔记元信息
- 再次点击 → 收起面板，按钮高亮状态切换

## 权限

`permissions: []` —— 本示例仅做 UI 展示与 `activate()`/`deactivate()` 调用，不涉及 `store` / `events` / `backend` 等受保护能力，故无需声明任何权限。
