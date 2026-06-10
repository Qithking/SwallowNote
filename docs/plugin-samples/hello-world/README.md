# Hello World 示例

最小可运行插件：侧边栏图标 + 全屏"Hello, world!"面板。

**学习目标**：理解插件的最小结构、icon / panel / manifest 三件套。

## 文件

- [manifest.json](./manifest.json) — Rust 端读取的元数据
- [index.tsx](./index.tsx) — JS 端入口

## 预期效果

- 侧边栏出现新图标（😊 表情）
- 点击 → 主区域出现居中的 "Hello, world!"
- 显示当前 `pluginId`

## 复刻步骤

参见 [quickstart.md](../../plugin-system/quickstart.md)。这个示例就是 5 分钟上手的最终代码。

## 关键点

- `icon` 是 `ComponentType<{ size?: number }>`，宿主用 `<Icon size={18} />` 渲染
- `panel` 是 `ComponentType<PluginPanelProps>`，宿主传入 `{ pluginId, isActive, close, store, events, invokeBackend }`
- `manifest.id` 全局唯一，重复安装会复用同一存储目录
- `permissions` 字段声明插件需要的 SDK 能力授权；hello-world **不声明任何权限**（只用 `panel` 渲染，不调 `store` / `events` / `registerContextMenu` / `invokeBackend`）
- `pluginPath` / `hasBackend` 不属于 `PluginManifest`；它们由宿主在加载时填充到 `PluginDefinition`，不要写在 manifest 里

## 权限（最小权限原则）

插件在 `manifest.permissions` 中**声明**所需权限，宿主在安装/首次使用时弹窗授权，运行时由 `assertPermission(pluginId, permission, ...)` 强制执行；未授权时抛 `PluginPermissionDeniedError`。本示例刻意**不写 `permissions` 字段**，作为最小权限基线：

- 没有 `store.get/set` 调用 → 不需要 `'storage'`
- 没有 `events.on/off` 调用 → 不需要 `'events'`
- 没有 `registerContextMenu` 调用 → 不需要 `'context-menu'`
- 没有 `invokeBackend` 调用 → 不需要 `'backend'`

后续示例按"用到的能力"逐步添加对应权限：

| 示例 | 新增能力 | 需声明权限 |
| --- | --- | --- |
| [storage-counter](../storage-counter) | 持久化存储 | `'storage'` |
| [event-listener](../event-listener) | 订阅宿主事件 | `'events'` |
| [settings-dialog](../settings-dialog) | 设置面板 | （不增加权限，`settings` 是 UI 入口） |
| [context-menu-item](../context-menu-item) | 右键菜单贡献 | `'context-menu'` |
| [full-stack](../full-stack) | 5 项能力综合 | 全部 4 项 |

完整权限列表、运行时检查机制、撤销即时生效等细节见 [manifest.md](../../plugin-system/manifest.md) "权限字段"一节。
