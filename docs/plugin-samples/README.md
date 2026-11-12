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
| [toolbar-button](./toolbar-button) | 编辑器工具栏按钮 | ⭐⭐ |
| [custom-editor](./custom-editor) | 自定义文件编辑器 | ⭐⭐⭐ |
| [command-palette](./command-palette) | 命令面板贡献 | ⭐⭐⭐ |
| [editor-tab](./editor-tab) | 编辑器 Tab API | ⭐⭐⭐ |
| [frontmatter-tagger](./frontmatter-tagger) | Frontmatter 读写 | ⭐⭐ |
| [rust-backend](./rust-backend) | Rust 后端通信（JSON-RPC，后端基于 plugin-rpc crate） | ⭐⭐⭐⭐ |
| [full-stack](./full-stack) | 5 项能力综合 | ⭐⭐⭐⭐ |

> **统一构建链**：12 个示例已全部迁移到 `definePlugin` 单一来源入口——`manifest.json` 是静态字段唯一来源，icon/panel/toolbarButton/settings/editorComponent 与生命周期钩子由 runtime 参数注入；构建走 [plugin-kit](../plugin-kit) 链路（见下方构建说明）。

## 使用方式

每个示例目录下有：

```
<example>/
├── manifest.json   # 静态字段唯一来源（Rust 端元数据也取自这里）
├── vite.config.ts  # 3 行 definePluginViteConfig
├── src/
│   └── index.tsx   # JS 入口：definePlugin(manifestJson, {...})（编译后变 index.js）
└── README.md       # 该示例的说明
```

### 在项目内引用

示例通过本地 `file:` 引用依赖 `@swallow-note/plugin-sdk` 与 `@swallow-note/plugin-kit`（见各示例的 `package.json`）。入口统一为 `definePlugin` 单一来源形式：

```typescript
import manifestJson from '../manifest.json'
import { definePlugin } from '@swallow-note/plugin-sdk'
// 必须 re-export setHost，宿主通过它注入权限检查等真实实现
export { setHost } from '@swallow-note/plugin-sdk'

export default definePlugin(manifestJson, {
  icon: MyIcon,
  panel: MyPanel, // toolbarButton / settings / editorComponent / 生命周期钩子按需注入
})
```

> **`setHost` re-export 的必要性**：宿主加载插件 bundle 后，需要调用 `setHost(...)` 注入真实实现（storage、事件总线、权限检查等）。如果入口文件没有 re-export `setHost`，tree-shaker 会将其移除，宿主只能回退到 SDK 的内存 stub，导致权限检查失效、数据不持久化。

> **复制到仓库外使用**：示例通过 `file:../../plugin-sdk` / `file:../../plugin-kit` 本地引用 SDK 与 kit。
> 复制到仓库外时，需要同步复制 `docs/plugin-sdk/` 与 `docs/plugin-kit/` 目录，或将依赖路径改为 npm 发布版本 `^0.1.0`。

### 构建说明

每个示例的 `vite.config.ts` 只需 3 行，调用 plugin-kit 的 `definePluginViteConfig`：

```typescript
import { definePluginViteConfig } from '@swallow-note/plugin-kit'

export default definePluginViteConfig()
```

它已内置：

- **ES 模块格式**（`formats: ['es']`），产物为 `dist/index.js`
- React / react-dom / sonner / react-i18next 等全部 external，使用宿主实例避免多实例冲突
- `inlineDynamicImports`，禁用代码分割（blob URL 无法解析分块）
- production 构建自动复制 `manifest.json` 到 `dist/`，并在 `index.js` 头部注入 `// @swallow-manifest` 元数据注释

构建与打包：

```bash
npm run build              # 等价于 swallow-plugin build
npx swallow-plugin package # 构建 + 把 dist/ 打包成 .zip
```

然后把 zip 在 SwallowNote 中 **Settings → Plugins → Upload** 上传即可。

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
