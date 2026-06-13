# 插件系统总览

> **第一次看？** 请先读 [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) —— 一份从头到尾不遗漏任何要点的完整开发指南。

SwallowNote 插件系统允许第三方代码扩展编辑器面板、订阅宿主事件、持久化数据、为右键菜单贡献条目、调用 Rust 后端。所有能力都通过一个零依赖的 JavaScript 入口文件（`index.js` 或 `index.tsx`）暴露。

## 能力矩阵

| 能力 | 入口 | 文档 |
| --- | --- | --- |
| 注册面板 / 图标 | `manifest.panel` / `manifest.icon` | [manifest.md](./manifest.md) |
| 生命周期钩子 | `manifest.onLoad` / `onMount` / ... | [lifecycle.md](./lifecycle.md) |
| 事件订阅 | `panel.events.on(event, handler)` | [events.md](./events.md) |
| 持久化存储 | `panel.store.get / set / delete` | [storage.md](./storage.md) |
| 设置面板 | `manifest.settings` | [settings.md](./settings.md) |
| 右键菜单贡献 | `registerContextMenu(pluginId, item)` | [context-menu.md](./context-menu.md) |
| Rust 后端 | `panel.invokeBackend(cmd, args)` | [backend.md](./backend.md) |
| **权限声明与授权** | `manifest.permissions` | [manifest.md#权限字段permissions](./manifest.md#权限字段permissions) |
| **独立开发** | `@swallow-note/plugin-sdk` | [standalone-development.md](./standalone-development.md) |

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  SwallowNote 宿主                                            │
│                                                              │
│  ┌──────────┐    ┌────────────┐    ┌──────────────────┐    │
│  │ Editor   │───▶│ Plugin     │◀──▶│ Persistent       │    │
│  │ 面板挂载 │    │ Container  │    │ Storage (JSON)   │    │
│  └──────────┘    └────────────┘    └──────────────────┘    │
│        │              │                       ▲              │
│        │              ▼                       │              │
│        │     ┌──────────────────┐             │              │
│        └────▶│ Event Bus        │             │              │
│              │ (PluginEventBus) │             │              │
│              └──────────────────┘             │              │
│        ▲              │                       │              │
│        │              ▼                       │              │
│  ┌──────────┐    ┌──────────────────┐         │              │
│  │ Context  │    │ Rust 后端        │─────────┘              │
│  │ Menu 注入│    │ (Tauri command)  │                        │
│  └──────────┘    └──────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │  插件 (index.js / index.tsx) │
              │  - React 组件 (icon/panel)   │
              │  - 生命周期钩子              │
              │  - 注册的事件/菜单           │
              └──────────────────────────────┘
```

## 插件加载流程

1. 用户在 **Settings → Plugins** 上传 `.zip` 包
2. 宿主解压到 `<app_data>/plugins/<plugin-id>/`
3. 宿主从 Rust 端读取插件元数据（id / name / hasBackend）
4. JS 端通过 `import()` 动态加载 `index.js` / `index.tsx`
5. 解析 manifest，渲染 icon → 触发 `onLoad` → 渲染 panel
6. 用户切换到面板时触发 `onActivate` / `onMount`，离开时触发 `onDeactivate` / `onUnmount`
7. 卸载时按顺序 `onUnload` → `clearPluginMenuItems` → `clear storage cache`

## 沙箱边界

> **重要**：插件运行在宿主渲染进程内，**没有沙箱**。恶意插件可以：
> - 读取任何 Zustand store
> - 调用任何 Tauri command（仅受 Rust capabilities 限制）
> - 注册任意事件 / 菜单项
>
> 加载未签名的第三方包之前请先审查源码。

## 独立开发

**无需 clone SwallowNote 源码**。使用 [`@swallow-note/plugin-sdk`](../plugin-sdk) 即可在任意项目里开发、调试、构建插件：

```
docs/
├── plugin-sdk/         # 零依赖 SDK（types + stub + hooks）
├── plugin-template/    # Vite + React 起步项目
└── plugin-system/      # 本目录（API 文档）
```

SDK 把所有类型和 React hooks 抽到一个 npm 包，stub 实现允许在浏览器中独立运行（事件走 EventTarget、存储走 localStorage、菜单注册表走内存 Map）。构建产物上传到 SwallowNote 后，宿主通过 `setHost(...)` 替换 stub，代码无需修改。

推荐起步路径：[plugin-template](../plugin-template)。

## 源码引用

| 模块 | 路径 |
| --- | --- |
| 类型定义 | `src/types/plugin.ts` |
| 事件总线 | `src/lib/plugin-host.ts` |
| 持久化存储 | `src/lib/plugin-host.ts` (`PluginStorageImpl`) |
| 菜单注册表 | `src/lib/plugin-menu.ts` |
| 插件加载 | `src/lib/plugin-loader.ts` |
| 宿主上下文 | `src/lib/plugin-host.ts` (`buildPluginContext`) |
| 示例插件 | `src/lib/core-plugins/recent-notes-counter.tsx` |
| 插件管理 UI | `src/components/Plugin/PluginManagerView.tsx` |
