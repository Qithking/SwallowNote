# 独立开发指南

> 不依赖 SwallowNote 源码，独立完成插件的开发、调试、构建、发布。

## 适用场景

- 你是一个**第三方开发者**，不想 clone 整个 SwallowNote 仓库
- 你的插件代码**跨多个项目复用**，需要作为独立 npm 包发布
- 你想要**更快的 dev loop**（HMR + 浏览器 devtools，无 Electron 重启）

## 三种开发方式对比

| 维度 | 项目内开发 | 独立开发（SDK + template） | 单文件 |
| --- | --- | --- | --- |
| 起步 | 把 `index.tsx` 放到 `src/lib/core-plugins/` | 拷贝 `plugin-template/` 到任意目录 | 把 `index.tsx` 拷到任意位置 |
| 调试 | 必须启动 Electron | 浏览器 + Vite HMR | 浏览器（手动） |
| 类型 | 引用项目内 `@/types/plugin` | `@swallow-note/plugin-sdk` | 手写或 vendored |
| 运行时 | 宿主真实实现 | Stub（localStorage / EventTarget） | 全部手写 mock |
| 构建 | 不需要（项目直接 import） | `npm run build` 出 `dist/plugin.js` | 手工打包 |
| 上传 | 拖入内置 sample | `dist/` 打包成 zip | 手工 |
| 推荐场景 | 改 SwallowNote 源码时顺便改插件 | 商业/开源插件 | 一锤子 demo |

**推荐**：99% 的场景用第二种。

## 起步

### 方法 A：使用 template（推荐）

```bash
# 1. 拷贝模板
cp -r docs/plugin-template ~/code/my-plugin
cd ~/code/my-plugin

# 2. 安装依赖（自动通过 file: 协议 link 到本地 SDK）
npm install

# 3. 启动 dev preview
npm run dev
# → http://localhost:5173

# 4. 改 src/plugin/index.tsx，热更新即时生效
# 5. 完成后打包
npm run build
# → dist/plugin.js + dist/manifest.json
```

### 方法 B：添加到现有 React 项目

```bash
npm install @swallow-note/plugin-sdk react react-dom
```

在 `src/MyPlugin.tsx`：

```typescript
import { type PluginDefinition, usePluginStorage } from '@swallow-note/plugin-sdk'

// ... 实现你的 manifest
export default manifest
```

构建时用 Vite library mode：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/MyPlugin.tsx', formats: ['iife'], name: 'MyPlugin', fileName: () => 'plugin.js' },
    rollupOptions: {
      external: [
        'react', 'react-dom', 'react/jsx-runtime',
        'sonner', 'react-i18next', 'i18next',
      ],
      output: {
        inlineDynamicImports: true,  // 必须禁用代码分割，插件加载器使用 blob URL，无法解析相对路径的 chunk 导入
      },
    },
  },
})
```

> **external 说明**：`react` / `react-dom` / `react/jsx-runtime` 由宿主通过 `window.React` / `window.ReactDOM` 提供；`sonner` 由宿主通过 `window.SonnerToast` 提供；`react-i18next` / `i18next` 由宿主通过 `window.ReactI18Next` 提供。这些依赖不需要打包进插件产物，否则会导致体积膨胀或运行时冲突。

> **`inlineDynamicImports` 说明**：插件加载器使用 blob URL 加载插件代码，blob URL 无法解析相对路径的 chunk 文件导入。因此必须设置 `inlineDynamicImports: true` 禁用代码分割，确保所有代码输出到单个 `plugin.js` 文件中。

## SDK 双模式详解

SDK 的设计核心：**一份代码、两种运行模式、零分支**。

### Standalone 模式（默认）

```typescript
// 浏览器 / dev preview
import { pluginEventBus, getPluginStorage, registerContextMenu } from '@swallow-note/plugin-sdk'

pluginEventBus.emit('note:open', { noteId: '1', path: '/a.md' })
// → 内部 EventTarget.dispatchEvent
// → usePluginEvent 回调被触发
```

Stub 实现细节：

| 能力 | Stub 实现 | 持久化？ |
| --- | --- | --- |
| 事件总线 | `EventTarget` + `CustomEvent` | 否（in-process） |
| 持久化 | `Map` 镜像到 `localStorage` | 是（5-10MB 限制） |
| 右键菜单注册表 | `Map<pluginId, items[]>` + 位置索引 | 否（in-process） |
| 后端调用 | `console.warn` + `null` | — |

### Host 模式（运行在 SwallowNote 内）

宿主加载插件时调用：

```typescript
import { setHost } from '@swallow-note/plugin-sdk'
import { getPluginStorage, pluginEventBus, pluginMenuRegistry } from '@/lib/...'

const restore = setHost({
  // Storage
  getPluginStorage: (id) => getPluginStorage(id),
  // Events
  on: (e, h) => pluginEventBus.on(e, h),
  off: (e, h) => pluginEventBus.off(e, h),
  emit: (e, p) => pluginEventBus.emit(e, p),
  // Context menu
  registerContextMenu: (id, item) => pluginMenuRegistry.register(id, item),
  unregisterContextMenu: (id, itemId) => pluginMenuRegistry.unregister(id, itemId),
  clearPluginMenuItems: (id) => pluginMenuRegistry.clearPlugin(id),
  getContextMenuItems: (loc, ctx) => pluginMenuRegistry.query(loc, ctx),
  // Backend
  invokeBackend: async (cmd, args) => invoke('plugin_' + cmd, args),
})

// 插件卸载
restore()  // 恢复 stub
```

调用 `setHost` 后，**所有后续 SDK 调用走宿主真实实现**。插件代码不需要 `if (host) ... else ...` 分支。

## Dev Preview 详解

`plugin-template/src/preview.tsx` 是一个完整的 dev 框架，提供：

### 左侧：插件面板

渲染 `manifest.panel`，传入真实的 `PluginPanelProps`（含 `store` / `events` / `invokeBackend`）。

### 右侧：Dev Tools

| 工具 | 用途 |
| --- | --- |
| **Emit events** | 一键触发 `note:open` / `note:save` / `theme:change` / `settings:change` 等宿主事件 |
| **Custom note:change** | 表单输入自定义 path + content 长度，发射 `note:change` |
| **Storage** | 列出当前插件已知的 storage key（count / config / history / installedAt） |
| **Clear storage** | 一键清空 stub localStorage |
| **Event log** | 实时显示最近 30 条事件（来自所有订阅方） |

### 顶栏

| 控件 | 行为 |
| --- | --- |
| Plugin name | 来自 `manifest.name` |
| Plugin id | 来自 `manifest.id` |
| `isActive` 复选框 | 切换 → 触发 `onActivate` / `onDeactivate` |
| close 按钮 | 调用 `panel.close()` → 触发 `onDeactivate` |
| 右键面板 | 弹出 `getContextMenuItems('editor', ctx)` 返回的菜单项 |

### 启动顺序

```
Preview 挂载
  → runLifecycleHook(onLoad)
  → runLifecycleHook(onMount)
  → emitAppReady()
  → 订阅所有事件做 log

isActive 切换
  → runLifecycleHook(onActivate 或 onDeactivate)

Preview 卸载
  → runLifecycleHook(onUnmount)
  → runLifecycleHook(onUnload)
  → clearPluginMenuItems(pluginId)
```

## 发布

```bash
npm run build
# → dist/plugin.js
# → dist/manifest.json

# 打包成 zip
cd dist && zip -r ../my-plugin-v0.1.0.zip . && cd ..

# 在 SwallowNote 中：Settings → Plugins → Upload my-plugin-v0.1.0.zip
```

## 常见错误

| 错误 | 原因 | 解决 |
| --- | --- | --- |
| `Cannot find module '@swallow-note/plugin-sdk'` | 没装 SDK / 没建软链 | `npm install` 或创建 `node_modules/@swallow-note/plugin-sdk` 软链到 SDK dist |
| dev 模式不响应事件 | 检查是否多个 tab 同时打开（EventTarget 跨 tab 不共享） | 只开一个 tab |
| `registerContextMenu` 在 preview 中看不到 | 菜单项的 `when` 谓词返回 false | 在右侧右键空白处测试，菜单项 location 默认覆盖全部 5 个位置 |
| `usePluginStorage` 拿到旧值 | localStorage 缓存 | 浏览器 devtools → Application → Local Storage → 右键 Clear |
| 构建产物 `dist/plugin.js` 太大 | 引入了完整 React 而不是 `react/jsx-runtime` | 检查 `vite.config.ts` 的 `rollupOptions.output.manualChunks` |

## 下一步

- 改 `src/plugin/index.tsx` 实现你的插件
- 用右侧 dev tools 调试事件 / 存储 / 菜单
- `npm run build` 打包上传
- 上线后收到用户反馈时，可在 dev mode 中复现大部分问题
