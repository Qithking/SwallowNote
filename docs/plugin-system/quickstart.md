# 5 分钟上手：第一个插件

我们写一个最小可运行插件：一个侧边栏图标 + 点击后显示 "Hello, world!" 的全屏面板。

## 第 1 步：创建文件结构

```
hello-world/
├── manifest.json     # 静态字段唯一来源（工程根，Rust 端与前端共用）
├── src/
│   └── index.tsx     # 插件入口（kit 约定路径，动态 import）
├── vite.config.ts    # 打包配置（3 行调 definePluginViteConfig）
└── README.md
```

## 第 2 步：写 `manifest.json`

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
  "entry": "src/index.tsx"
}
```

> `manifest.json` 是插件**静态字段的唯一来源**：Rust 端读取它，前端入口也会 `import manifestJson from '../manifest.json'` 复用同一份数据——不再在 index.tsx 里维护第二份 manifest 副本。`entry` 字段是 JS 入口文件名（kit 约定为 `src/index.tsx`）。完整字段含义见 [manifest.md](./manifest.md)。

## 第 3 步：写 `src/index.tsx`

```tsx
import { definePlugin } from '@swallow-note/plugin-sdk'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
// 必须保留 re-export：tree-shaker 会丢弃该符号，
// 宿主在模块加载完成后、首个 API 调用前通过 setHost 注入真实实现（权限检查、真实存储等）。
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'

// ─── 图标（侧边栏） ────────────────────────────────────────────
function HelloIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
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

// ─── manifest 单一来源：静态字段来自 manifest.json，组件由运行时参数注入 ───
export default definePlugin(manifestJson, {
  icon: HelloIcon,
  panel: HelloPanel,
})
```

> 完整 manifest 字段含义见 [manifest.md](./manifest.md)。独立开发用 `@swallow-note/plugin-sdk` 导入类型；项目内开发用 `@/types/plugin`。两者字段一致。

> **可用 Props**：`PluginPanelProps` 和 `ToolbarButtonProps` 中还包含 `activeNoteContent`（当前活动笔记的 Markdown 内容）和 `activeNotePath`（当前活动笔记的文件路径）两个由宿主注入的只读字段。插件可以直接从 props 中解构使用，无需订阅额外事件。例如：`function MyPanel({ pluginId, activeNoteContent, activeNotePath }: PluginPanelProps) { ... }`。完整 Props 字段列表见 [manifest.md](./manifest.md)。

> **调用后端与错误处理**：`panel.invokeBackend<T>(command, args?)` 返回 `Promise<T>`；后端返回 JSON-RPC error 时，宿主会把 `code`/`data` 一并透传，前端捕获到的是 SDK 的 `PluginError` 实例，可按 `err.code`/`err.data` 做业务分支。详见 [backend.md](./backend.md)。

## 第 4 步：配置 `vite.config.ts`

插件构建样板已收敛到 plugin-kit 的配置工厂，工程根目录的 `vite.config.ts` 只需 3 行：

```ts
import { definePluginViteConfig } from '@swallow-note/plugin-kit'

export default definePluginViteConfig()
```

> **关键点**：`definePluginViteConfig` 内聚了全部样板——宿主全家桶依赖 external 化（React / ReactDOM / sonner / react-i18next 等经 `window.*` 全局变量由宿主提供，插件打包时不能重复包含，否则会出现多实例冲突如 React hooks 崩溃）、构建产物顶部注入 `// @swallow-manifest` 注释（宿主据此读取插件元数据）、关闭代码分割（插件加载器使用 blob URL，无法解析分块导入）。它约定入口为 `src/index.tsx`、`manifest.json` 位于工程根、产物为 `dist/index.js`（ESM 单文件）。需要追加 external 时传 `{ externals: [...] }`，dev server 默认端口 5177。

> **安装依赖**：在插件工程 `package.json` 的 `devDependencies` 中以 `file:` 形式引入 SDK 与 kit（如 `"@swallow-note/plugin-sdk": "file:../../docs/plugin-sdk"`、`"@swallow-note/plugin-kit": "file:../../docs/plugin-kit"`），然后 `npm install`。

## 第 5 步：打包上传

1. 把 `hello-world/` 目录压缩成 `.zip`
2. 在 SwallowNote 中打开 **Settings → Plugins**
3. 点击 **Upload** 选择 `.zip`
4. 插件出现在卡片列表，启用后侧边栏出现新图标

> 也可以用 kit 的 `swallow-plugin package` 一键完成「构建 → zip → 签名 → repo.json 同步」，签名链路与手动 zip 上传不变。

## 第 6 步：验证

点击侧边栏图标 → 主区域出现 "Hello, world!" 面板。

## 下一步

- 添加 [持久化存储](./storage.md) → [storage-counter 示例](../plugin-samples/storage-counter)
- 订阅 [事件总线](./events.md) → [event-listener 示例](../plugin-samples/event-listener)
- 添加 [设置面板](./settings.md) → [settings-dialog 示例](../plugin-samples/settings-dialog)
- 贡献 [右键菜单](./context-menu.md) → [context-menu-item 示例](../plugin-samples/context-menu-item)
- 贡献 [命令面板](./DEVELOPER_GUIDE.md#命令面板贡献)（`registerCommand`）
- 声明 [自定义文件编辑器](./DEVELOPER_GUIDE.md#自定义文件编辑器)（manifest 声明 `editorFileExtensions` + `editorComponent`，宿主自动注册，无需手动配对）
- 使用 [编辑器 Tab API](./DEVELOPER_GUIDE.md#编辑器-tab-api)（`openEditorTab`）
- 使用 [设置 API](./DEVELOPER_GUIDE.md#设置-api)（`getSetting` / `setSetting`）
- 使用 [Frontmatter API](./DEVELOPER_GUIDE.md#frontmatter-api)（`getActiveNoteFrontmatter`）
- 完整示例（5 项能力）→ [full-stack 示例](../plugin-samples/full-stack)

## 常见错误

| 错误 | 原因 | 解决 |
| --- | --- | --- |
| 上传后无图标 | `iconPosition` 不是 `sidebar` | 改 `iconPosition: 'sidebar'` |
| 点击无反应 | `contentPosition` 与触发器不匹配 | `fullPanel` 用于全屏；`rightPanel` / `leftPanel` 配合 sidebar |
| 控制台报 `Cannot find module '@swallow-note/plugin-sdk'` | 未安装 SDK 或未建软链 | `npm install` 或将 `node_modules/@swallow-note/plugin-sdk` 软链到 SDK dist |
| 打包后体积巨大 | 包含 `node_modules` | 只打包源码 + 锁定第三方依赖到具体路径 |
| 插件管理界面显示的名称/位置与实际不符 | 构建产物 `dist/index.js` 头部缺少 `// @swallow-manifest` 注释 | 确认 vite.config.ts 使用 `definePluginViteConfig`（内含注入逻辑）；自定义配置时需手动包含 `inject-manifest-comment` 插件 |
