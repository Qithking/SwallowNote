# @swallow-note/plugin-sdk

零依赖插件开发 SDK。**无需 clone SwallowNote 源码** 即可在任意 TypeScript 项目中开发、调试、构建插件。

## 为什么需要这个

此前插件作者必须在 SwallowNote 源码内开发（因为示例 import `@/types/plugin` `@/lib/...`）。SDK 解决了三个痛点：

1. **路径别名** — SDK 把所有类型 + stub 实现 + React hooks 集中到一个 npm 包，import 路径稳定
2. **浏览器内调试** — stub 实现提供 localStorage 模拟、EventTarget 事件总线、内存右键菜单注册表，dev server 即可运行
3. **双模式构建** — 同一份源码同时支持 standalone 模式（带 stub）和 host 模式（stub 被宿主覆盖）

## 安装

```bash
npm install @swallow-note/plugin-sdk react react-dom
```

或使用 `plugin-template/` 起步项目：

```bash
cp -r docs/plugin-template my-plugin
cd my-plugin
npm install
npm run dev
```

## 起步

```typescript
// src/index.tsx
import {
  type PluginDefinition,
  type PluginPanelProps,
  pluginEventBus,
  registerContextMenu,
  usePluginStorage,
} from '@swallow-note/plugin-sdk'

function Icon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24">…</svg>
}

function Panel(panel: PluginPanelProps) {
  const [count, setCount] = usePluginStorage<number>(panel, 'count', 0)
  return (
    <div style={{ padding: 16 }}>
      <h2>Count: {count}</h2>
      <button onClick={() => setCount((c) => c + 1)}>+</button>
    </div>
  )
}

const manifest: PluginDefinition = {
  id: 'com.example.demo',
  name: 'Demo',
  description: 'My first plugin',
  version: '0.1.0',
  author: 'You',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 100,
  enabled: true,
  icon: Icon,
  panel: Panel,
  pluginPath: '',
  hasBackend: false,
}

export default manifest
```

## 导出清单

| 类别 | 名称 |
| --- | --- |
| **类型** | `PluginDefinition`, `PluginManifest`（=Definition）, `PluginContext`, `PluginPanelProps`, `PluginStorage`, `PluginEventBus`, `PluginEvent`, `PluginEventPayloadMap`, `PluginEventHandler`, `PluginLifecycleHook`, `IconPosition`, `ContentPosition`, `ContextMenuItem`, `ContextMenuContext`, `ContextMenuLocation`, `ContextMenuRegistry`, `HostOverrides` |
| **运行时** | `pluginEventBus`, `getPluginStorage`, `registerContextMenu`, `unregisterContextMenu`, `clearPluginMenuItems`, `getContextMenuItems`, `buildPluginContext`, `runLifecycleHook` |
| **React hooks** | `usePluginStorage`, `usePluginEvent`, `usePluginEvents` |
| **Emit 助手** | `emitNoteOpened`, `emitNoteClosed`, `emitNoteSaved`, `emitNoteChanged`, `emitThemeChanged`, `emitLocaleChanged`, `emitSettingChanged`, `emitAppReady`, `emitAppExit` |
| **宿主接管** | `setHost(overrides): () => void` |
| **版本** | `SDK_VERSION` |

## 双模式

### Standalone（默认）

```bash
npm run dev      # vite dev server，带 preview 框架
npm run build    # 产出 dist/index.js（含 stub），可在浏览器中独立运行
```

### Host 模式

打包后 `index.js` + `manifest.json` 上传至 SwallowNote。宿主加载时：

```typescript
import { setHost } from '@swallow-note/plugin-sdk'
import { getPluginStorage, pluginEventBus, pluginMenuRegistry } from '@/lib/...'

setHost({
  getPluginStorage: (id) => getPluginStorage(id),
  on: (e, h) => pluginEventBus.on(e, h),
  off: (e, h) => pluginEventBus.off(e, h),
  emit: (e, p) => pluginEventBus.emit(e, p),
  registerContextMenu: (id, item) => pluginMenuRegistry.register(id, item),
  unregisterContextMenu: (id, itemId) => pluginMenuRegistry.unregister(id, itemId),
  clearPluginMenuItems: (id) => pluginMenuRegistry.clearPlugin(id),
  getContextMenuItems: (loc, ctx) => pluginMenuRegistry.query(loc, ctx),
  invokeBackend: async (cmd, args) => invoke('plugin_' + cmd, args),
})
```

调用 `setHost` 之后，stub 全部失效，所有后续 SDK 调用走宿主真实实现。卸载时 `setHost` 返回的函数可恢复 stub。

## 设计要点

- **零运行时依赖**（仅 `react` peer dep）— bundle 小
- **API 稳定** — `src/types/plugin.ts` 变更时 SDK 同步更新；类型对插件作者完全可预测
- **Host takeover 是无侵入的** — 插件代码不需要 `if (host) ... else ...` 分支
- **Stub 是 real-world 的 subset** — 仅 API 行为接近宿主，但存储走 localStorage，事件总线走 EventTarget，菜单注册表走内存 Map
- **`usePluginStorage` 行为镜像宿主** — 同 hydrate 流程、同函数式 setter、同 null 删除语义

## 限制

- **Rust 后端** — `invokeBackend` 在 standalone 模式返回 `null` 并 console.warn。需要真实 Tauri 调用必须用 host 模式。
- **持久化** — standalone 模式持久化到 localStorage（域名下 5-10MB 限制）。Host 模式无此限制（走 Tauri 文件系统）。
- **事件载荷** — stub 转发 payload 的引用相同；宿主可能 clone payload，插件代码不应依赖引用相等。
