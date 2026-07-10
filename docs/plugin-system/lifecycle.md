# 生命周期钩子

插件从加载到卸载的整个生命周期由 8 个钩子覆盖。它们都接收 `PluginContext` 作为参数，可以是同步或异步函数；宿主会 await 异步钩子并隔离异常。

## 钩子列表

| 钩子 | 时机 | 典型用途 |
| --- | --- | --- |
| `onLoad` | 模块首次加载 | 注册右键菜单、初始化全局 store、种子数据 |
| `onEnable` | 启用切换 | 启动后台任务、连接外部服务 |
| `onDisable` | 禁用切换 | 暂停任务、断连外部服务 |
| `onMount` | panel 组件挂载 | 读取 store、订阅事件、加载缓存 |
| `onActivate` | panel 变可见 | 刷新面板、聚焦输入 |
| `onDeactivate` | panel 隐藏 | 保存草稿、暂停动画 |
| `onUnmount` | panel 组件卸载 | 取消订阅、清理 timer |
| `onUnload` | 插件完全卸载 | 释放资源、清理全局副作用 |

## 触发顺序

### 首次加载启用

```
loadAllPlugins()
  ├─ import('index.tsx')
  ├─ 解析 manifest
  ├─ onLoad(ctx)
  ├─ 注册到 plugin store
  └─ 渲染 panel
       ├─ onMount(ctx)
       └─ (面板可见时) onActivate(ctx)
```

### 关闭应用

```
tauri://close-requested
  ├─ 标记 isQuitting
  ├─ emit('app:exit')
  └─ 关闭窗口
       └─ 所有面板 onUnmount → onUnload
```

### 切换面板

```
切换到本面板:
  onActivate(ctx)   ← 上一个面板 onDeactivate
切换离开:
  onDeactivate(ctx)
```

## PluginContext

```typescript
interface PluginContext {
  pluginId: string              // 插件 id，可用于存储命名空间
  pluginPath: string            // 插件包在磁盘上的绝对路径
  invokeBackend(cmd, args?): Promise<unknown>  // 调用 Rust 后端
}
```

### `invokeBackend` 在不同模式下的行为

`PluginContext.invokeBackend` 的具体实现由构造 context 的代码决定：

- **host 模式**（生产）：宿主构造的 `PluginContext` 把 `invokeBackend` 桥接到 `@tauri-apps/api/core` 的 `invoke`，正常调用 Rust 后端命令。
- **standalone 模式**（`npm run dev` 独立预览，无 Tauri runtime）：SDK 的 `buildPluginContext(plugin)` 返回的 `invokeBackend` 会先检查 host 是否注入了 `invokeBackend` override；若未注入，则打印 `console.warn` 并返回 `null`，方便插件在无 Rust 后端时也能跑通 UI 预览。

```typescript
// SDK 中的 standalone 兜底实现（简化）
import { buildPluginContext } from '@swallow-note/plugin-sdk'

const ctx = buildPluginContext({ id: 'com.example.demo', pluginPath: '/tmp/demo' })
const result = await ctx.invokeBackend('count_words', { text: 'hi' })
// host 未注入时：打印 warn，result === null
```

> 因此生命周期钩子里调用 `invokeBackend` 时应处理 `null` 兜底（standalone 模式）。如果钩子需要调用后端，建议在 `onMount`/`onActivate` 中调用（此时面板已挂载，可通过 `panel.invokeBackend` 调用），而非在 `onLoad` 中。详见 [backend.md](./backend.md)。

## 完整示例

```typescript
import type { PluginDefinition, PluginContext, PluginPanelProps } from '@/types/plugin'
import { getPluginStorage, pluginEventBus } from '@/lib/plugin-host'
import { registerContextMenu } from '@/lib/plugin-menu'

let unsubscribeNoteChange: (() => void) | null = null

// 模块加载时注册全局副作用
async function onLoad(ctx: PluginContext): Promise<void> {
  // 种子数据
  const store = getPluginStorage(ctx.pluginId)
  if (!(await store.get('installedAt'))) {
    await store.set('installedAt', new Date().toISOString())
  }

  // 全局事件订阅
  unsubscribeNoteChange = pluginEventBus.on('note:change', (payload) => {
    console.log(`[${ctx.pluginId}] note changed:`, payload.path)
  })

  // 右键菜单贡献
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:reindex',
    label: 'Reindex current note',
    iconName: 'RefreshCw',
    locations: ['editor'],
    when: (mctx) => !!mctx.path,
    onClick: (mctx) => console.log('reindex', mctx.path),
  })
}

// panel 挂载时建立组件级订阅
async function onMount(ctx: PluginContext): Promise<void> {
  // 这里可以拿不到 React state，但可以做模块级的 store 预热
  const store = getPluginStorage(ctx.pluginId)
  await store.set('lastMountedAt', new Date().toISOString())
}

function onUnmount(): void {
  // 不需要做面板级清理：useEffect 已经管了
}

// 卸载时清理所有全局副作用
function onUnload(): void {
  unsubscribeNoteChange?.()
  unsubscribeNoteChange = null
  // 右键菜单 / 存储 cache 会被 host 自动清理（但显式清理是好习惯）
}

const manifest: PluginDefinition = {
  id: 'com.example.lifecycle',
  name: 'Lifecycle Demo',
  // ...
  hooks: { onLoad, onMount, onUnmount, onUnload },
}

export default manifest
```

## 异常隔离

宿主对所有钩子都做了 `try / catch`：

```typescript
// host 内部实现
async function runLifecycleHook(hook, ctx) {
  if (!hook) return
  try {
    await hook(ctx)
  } catch (err) {
    console.error(`[plugin ${ctx.pluginId}] hook failed:`, err)
  }
}
```

→ **钩子抛异常不会阻塞宿主**，但建议在钩子内部用 `try / catch` 处理可恢复错误。

## React 集成

在 panel 组件内部，**不要**在生命周期钩子里读 `useState` —— 钩子在 React 树之外运行。应改用 React hook：

```typescript
function MyPanel(panel: PluginPanelProps) {
  // 这里才是 React 的世界
  const [count, setCount] = usePluginStorage(panel, 'count', 0)
  usePluginEvent(panel, 'note:change', (payload) => {
    console.log('note changed', payload.path)
  })
  return <div>{count}</div>
}
```

`usePluginStorage` / `usePluginEvent` 详见 [storage.md](./storage.md) / [events.md](./events.md)。

## 源码引用

- 钩子类型：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginLifecycleHook`
- 钩子调度：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `runLifecycleHook`
- store 钩子触发点：[src/stores/plugin.ts](../../src/stores/plugin.ts) `registerPlugin` / `unregisterPlugin`
