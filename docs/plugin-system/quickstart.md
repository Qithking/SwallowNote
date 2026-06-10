# 5 分钟上手：第一个插件

我们写一个最小可运行插件：一个侧边栏图标 + 点击后显示 "Hello, world!" 的全屏面板。

## 第 1 步：创建文件结构

```
hello-world/
├── manifest.json     # 插件元数据（仅 Rust 端读取）
├── index.tsx         # 插件入口（动态 import）
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
  "entry": "index.tsx"
}
```

> `manifest.json` 是 Rust 端读取的元数据文件。`entry` 字段是 JS 入口文件名。完整字段含义见 [manifest.md](./manifest.md)。

## 第 3 步：写 `index.tsx`

```tsx
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'

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
  pluginPath: '',  // 加载时由 loader 填充
  hasBackend: false,
}

export default manifest
```

> 完整 manifest 字段含义见 [manifest.md](./manifest.md)。`pluginPath` 留空即可，loader 会自动填上。

## 第 4 步：打包上传

1. 把 `hello-world/` 目录压缩成 `.zip`
2. 在 SwallowNote 中打开 **Settings → Plugins**
3. 点击 **Upload** 选择 `.zip`
4. 插件出现在卡片列表，启用后侧边栏出现新图标

## 第 5 步：验证

点击侧边栏图标 → 主区域出现 "Hello, world!" 面板。

## 下一步

- 添加 [持久化存储](./storage.md) → [storage-counter 示例](../plugin-samples/storage-counter)
- 订阅 [事件总线](./events.md) → [event-listener 示例](../plugin-samples/event-listener)
- 添加 [设置面板](./settings.md) → [settings-dialog 示例](../plugin-samples/settings-dialog)
- 贡献 [右键菜单](./context-menu.md) → [context-menu-item 示例](../plugin-samples/context-menu-item)
- 完整示例（5 项能力）→ [full-stack 示例](../plugin-samples/full-stack)

## 常见错误

| 错误 | 原因 | 解决 |
| --- | --- | --- |
| 上传后无图标 | `iconPosition` 不是 `sidebar` | 改 `iconPosition: 'sidebar'` |
| 点击无反应 | `contentPosition` 与触发器不匹配 | `fullPanel` 用于全屏；`rightPanel` / `leftPanel` 配合 sidebar |
| 控制台报 `Cannot find module '@/types/plugin'` | 路径别名仅在 SwallowNote 项目内解析 | 在本地 demo 项目里也配置相同别名（参考 `tsconfig.json` 的 `paths`） |
| 打包后体积巨大 | 包含 `node_modules` | 只打包源码 + 锁定第三方依赖到具体路径 |
