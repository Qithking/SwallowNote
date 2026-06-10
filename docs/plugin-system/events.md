# 事件总线

宿主在状态变化时向事件总线 emit 事件，插件通过订阅响应。

## 事件类型

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `note:open` | `{ noteId, path }` | 编辑器创建新 tab |
| `note:close` | `{ noteId, path }` | 编辑器关闭 tab |
| `note:save` | `{ noteId, path }` | 写盘成功 |
| `note:change` | `{ noteId, path, content }` | 编辑器内容变化 |
| `theme:change` | `{ theme }` | 用户切换主题 |
| `locale:change` | `{ locale }` | 用户切换语言（i18n 已就绪，待接入） |
| `settings:change` | `{ key, value }` | 用户修改任意设置项 |
| `app:ready` | `{}` | 应用启动完成 |
| `app:exit` | `{}` | 应用开始关闭 |

## 订阅方式

### 方式 1：panel 内用 hook（推荐）

```typescript
import type { PluginPanelProps } from '@/types/plugin'
import { usePluginEvent } from '@/lib/plugin-hooks'

function MyPanel(panel: PluginPanelProps) {
  // 订阅单一事件
  usePluginEvent(panel, 'theme:change', (payload) => {
    console.log('Theme is now:', payload.theme)
  })

  // 订阅多个事件
  // usePluginEvents(panel, ['note:open', 'note:close'], (event, payload) => {
  //   console.log(event, payload)
  // })

  return <div>...</div>
}
```

### 方式 2：直接用 bus（模块级）

```typescript
import { pluginEventBus } from '@/lib/plugin-host'

const unsub = pluginEventBus.on('note:save', (payload) => {
  console.log('saved:', payload.path)
})

// 卸载时调用 unsub()
```

> 模块级订阅适合在 `onLoad` 中注册，`onUnload` 中清理。

### 方式 3：Rust 后端

后端可以通过 Tauri `event::emit` 发事件，前端用同样 API 监听（详见 [backend.md](./backend.md)）。

## unsubscribe

`on(event, handler)` 返回一个 unsubscribe 函数：

```typescript
useEffect(() => {
  const unsub = bus.on('note:change', handler)
  return unsub
}, [bus])
```

也可以用 `off(event, handler)` 显式解绑（需要保持 handler 引用稳定）：

```typescript
useEffect(() => {
  bus.on('note:change', handler)
  return () => bus.off('note:change', handler)
}, [bus, handler])
```

## 完整示例：监听所有 note 事件

```typescript
import type { PluginPanelProps } from '@/types/plugin'
import { usePluginEvents } from '@/lib/plugin-hooks'

function NoteActivityLogger(panel: PluginPanelProps) {
  usePluginEvents(panel, ['note:open', 'note:close', 'note:save'], (event, payload) => {
    const time = new Date().toISOString()
    console.log(`[${time}] ${event} ${payload.path}`)
  })

  return null
}
```

## 错误隔离

订阅者抛异常不会影响其他订阅者：

```typescript
bus.on('note:change', (payload) => {
  throw new Error('oops')
})

bus.on('note:change', (payload) => {
  console.log('still fires')
})
```

## 类型安全

每个事件都有强类型 payload，handler 形参自动推导：

```typescript
bus.on('theme:change', (payload) => {
  // payload.theme: string  ✅ 类型安全
  // payload.bogus          ❌ 编译错误
})
```

新增事件时需要修改 `PluginEvent` 联合类型 + `PluginEventPayloadMap` 映射，详见 [src/types/plugin.ts](../../src/types/plugin.ts) `PluginEvent`。

## 副作用

```typescript
function onLoad(ctx: { pluginId: string }) {
  // 在模块级订阅（不在 React 里）
  const unsub = pluginEventBus.on('note:change', (payload) => {
    // 写入存储
    const store = getPluginStorage(ctx.pluginId)
    void store.set('lastChangedPath', payload.path)
  })

  // 存到 module 局部变量，onUnload 时清理
  ;(ctx as any).__unsub = unsub
}

function onUnload(ctx: { pluginId: string }) {
  ;(ctx as any).__unsub?.()
}
```

> 上面的 `as any` 仅是示例。生产环境建议把 unsubscribe 存到 module 级 closure。

## 源码引用

- 事件类型：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginEvent` / `PluginEventPayloadMap`
- emit helper：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `emitNoteOpened` / `emitThemeChanged` / ...
- React hook：[src/lib/plugin-hooks.ts](../../src/lib/plugin-hooks.ts) `usePluginEvent` / `usePluginEvents`
- bus 实现：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `PluginEventBusImpl`
- emit 注入点：[src/stores/editor.ts](../../src/stores/editor.ts) / [src/stores/ui.ts](../../src/stores/ui.ts) / [src/App.tsx](../../src/App.tsx)
