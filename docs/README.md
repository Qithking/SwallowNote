# SwallowNote 文档

> SwallowNote 插件系统 API 文档与示例插件源码

## 目录

### 插件系统文档

| 文档 | 简介 |
| --- | --- |
| [plugin-system/README.md](plugin-system/README.md) | 插件系统总览与架构 |
| [plugin-system/DEVELOPER_GUIDE.md](plugin-system/DEVELOPER_GUIDE.md) | **完整开发指南**（推荐主入口） |
| [plugin-system/quickstart.md](plugin-system/quickstart.md) | 5 分钟上手：第一个插件 |
| [plugin-system/manifest.md](plugin-system/manifest.md) | manifest 字段说明 |
| [plugin-system/lifecycle.md](plugin-system/lifecycle.md) | 生命周期钩子 |
| [plugin-system/events.md](plugin-system/events.md) | 事件总线 |
| [plugin-system/storage.md](plugin-system/storage.md) | 持久化存储 |
| [plugin-system/settings.md](plugin-system/settings.md) | 设置面板 |
| [plugin-system/context-menu.md](plugin-system/context-menu.md) | 右键菜单贡献 |
| [plugin-system/backend.md](plugin-system/backend.md) | Rust 后端（可选） |

### 示例插件

| 示例 | 能力 |
| --- | --- |
| [plugin-samples/hello-world](plugin-samples/hello-world) | 最小可运行插件 |
| [plugin-samples/storage-counter](plugin-samples/storage-counter) | 持久化存储 |
| [plugin-samples/event-listener](plugin-samples/event-listener) | 事件订阅 |
| [plugin-samples/settings-dialog](plugin-samples/settings-dialog) | 设置面板 |
| [plugin-samples/context-menu-item](plugin-samples/context-menu-item) | 右键菜单贡献 |
| [plugin-samples/full-stack](plugin-samples/full-stack) | 综合示例（5 项能力） |

### 独立开发工具

| 工具 | 简介 |
| --- | --- |
| [plugin-sdk](plugin-sdk) | `@swallow-note/plugin-sdk` — 零依赖 SDK，无需 clone SwallowNote 源码 |
| [plugin-template](plugin-template) | Vite + React 起步项目，开箱即用 dev preview |

---

## 快速链接

- **我想独立开发一个插件** → [plugin-template](plugin-template)（推荐先看这个）
- **我想看 SDK API 文档** → [plugin-sdk/README.md](plugin-sdk/README.md)
- **我想写一个插件（项目内开发）** → [quickstart.md](plugin-system/quickstart.md)
- **我想看一个能跑的插件** → [plugin-samples/hello-world](plugin-samples/hello-world)
- **我想知道 manifest 怎么写** → [manifest.md](plugin-system/manifest.md)
- **我想用某个具体 API** → 上方表格里找对应文档
- **有问题先看 API 参考** → 每个文档底部都有对应源代码引用
