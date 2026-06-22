# 插件示例

这里存放独立的插件示例源码，每个目录是一个完整可打包的插件包。复制到 `<app_data>/plugins/<id>/` 或打包成 `.zip` 上传即可使用。

## 目录索引

| 目录 | 能力 | 难度 |
| --- | --- | --- |
| [hello-world](./hello-world) | 最小骨架 | ⭐ |
| [storage-counter](./storage-counter) | 持久化存储 | ⭐⭐ |
| [event-listener](./event-listener) | 事件订阅 | ⭐⭐ |
| [settings-dialog](./settings-dialog) | 设置面板 | ⭐⭐ |
| [context-menu-item](./context-menu-item) | 右键菜单贡献 | ⭐⭐⭐ |
| [full-stack](./full-stack) | 5 项能力综合 | ⭐⭐⭐⭐ |

## 使用方式

每个示例目录下有：

```
<example>/
├── manifest.json   # Rust 端元数据
├── index.tsx       # JS 入口（编译后变 index.js）
└── README.md       # 该示例的说明
```

### 在项目内引用

示例使用 `@/types/plugin` / `@/lib/...` 路径别名，**仅在项目内构建时有效**。当插件作为外部 `.zip` 上传时：

1. 在本地用 TypeScript 编译示例为 `index.js`（Vite / esbuild / tsc 都行）
2. 把 `manifest.json` 一起打包
3. 在 SwallowNote 中 **Settings → Plugins → Upload**

### 路径别名替代

如果不想配置 Vite alias，可以用相对路径：

```typescript
// from '@/types/plugin'
import type { PluginDefinition } from '../../../types/plugin'
```

或者把整个 `src/types/plugin.ts` 内联到插件包里（去掉 `PluginContext` 的 host-only 部分）。

## 教程推荐顺序

```
hello-world → storage-counter → event-listener → settings-dialog
           → context-menu-item → full-stack
```

每个示例都在前一个的基础上增加 1 项能力，确保平滑过渡。

## 调试技巧

1. **打开 DevTools**（Cmd+Option+I / Ctrl+Shift+I）查看 console
2. **事件流可视化**：装上 [event-listener](./event-listener) 实例
3. **存储可视化**：装上 [storage-counter](./storage-counter) 配合 Chrome DevTools Application 标签
4. **右键菜单贡献计数**：[context-menu-item](./context-menu-item) 的 main panel 里有 `pluginMenuRegistry.getByLocation(...).length`
