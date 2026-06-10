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
- `pluginPath` / `hasBackend` 不属于 `PluginManifest`；它们由宿主在加载时填充到 `PluginDefinition`，不要写在 manifest 里
