# 持久化存储

每个插件都有一个独立的 JSON 文件存储，路径为 `<app_data>/plugins/<pluginId>/storage.json`。**键以插件 id 命名空间隔离**，所以两个插件用 `theme` 键不会冲突。

## API

```typescript
interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

值必须 JSON 安全（无函数、无循环引用）。

## 用法

### 1. panel 内 React hook（推荐）

```typescript
import type { PluginPanelProps } from '@/types/plugin'
import { usePluginStorage } from '@/lib/plugin-hooks'

function CounterPanel(panel: PluginPanelProps) {
  // 初始化值 0；存储中有同名 key 时覆盖
  const [count, setCount] = usePluginStorage<number>(panel, 'count', 0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
      <button onClick={() => setCount(0)}>Reset</button>
      <button onClick={() => setCount(null)}>Delete key</button>
    </div>
  )
}
```

`setValue` 三种用法：

| 形式 | 效果 |
| --- | --- |
| `setCount(5)` | 覆盖为 5 |
| `setCount(prev => prev + 1)` | 函数式更新，读最新值 |
| `setCount(null)` | 删除 key（fallback 到 initialValue） |

### 2. 模块级 helper

```typescript
import { getPluginStorage } from '@/lib/plugin-host'

const store = getPluginStorage('com.example.my-plugin')

await store.set('lastLogin', new Date().toISOString())
const last = await store.get<string>('lastLogin')
await store.delete('lastLogin')
await store.clear()  // 删掉本插件所有键
```

> 模块级 API 适合在 `onLoad` / `onUnload` 中调用，或者在事件 handler 中读写。

### 3. 异步并发

- `set` 内部串行化写盘（同一时刻只有一个写操作）
- `get` 总是返回当前文件内容
- 不保证 `get` 之后 `set` 之前的中间状态可被 `get` 看到 —— 但对于单 key 读写不会有问题

## 存储布局

```
<app_data>/                          # Tauri 解析的 app data dir
  └── plugins/
      ├── com.example.hello-world/
      │   └── storage.json           # {"count": 42, "viewMode": "list"}
      └── com.example.my-plugin/
          └── storage.json
```

Rust 端命令 `get_plugin_storage_path` 负责解析路径（跨平台）。

## 完整示例：带历史的计数器

```typescript
import type { PluginPanelProps } from '@/types/plugin'
import { usePluginStorage } from '@/lib/plugin-hooks'

interface CounterState {
  value: number
  history: number[]
}

const initial: CounterState = { value: 0, history: [] }

function CounterWithHistory(panel: PluginPanelProps) {
  const [state, setState] = usePluginStorage<CounterState>(panel, 'state', initial)

  const increment = () => {
    setState(prev => {
      const next: CounterState = {
        value: prev.value + 1,
        history: [...prev.history, prev.value + 1].slice(-10),
      }
      return next
    })
  }

  return (
    <div>
      <p>Value: {state.value}</p>
      <p>History: {state.history.join(' → ')}</p>
      <button onClick={increment}>+1</button>
      <button onClick={() => setState(null)}>Reset</button>
    </div>
  )
}
```

## 卸载时

- 磁盘文件保留：再次安装同 id 插件会复用旧数据
- 内存缓存丢弃：下次访问会从磁盘重新读
- 显式调用 `clear()` 可清空

## 异常

- 磁盘读写失败 → `set` 抛异常；`get` 返回 `null`
- 存储值非 JSON → `get` 抛解析异常
- 插件卸载后 `getPluginStorage` 仍可用（缓存已 drop，会重新读盘）；但已卸载的插件 `panel.store` 不可用

## 源码引用

- 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginStorage`
- React hook：[src/lib/plugin-hooks.ts](../../src/lib/plugin-hooks.ts) `usePluginStorage`
- 运行时实现：[src/lib/plugin-host.ts](../../src/lib/plugin-host.ts) `getPluginStorage` / `PluginStorageImpl`
- Rust 端命令：[src-tauri/src/commands/plugin.rs](../../src-tauri/src/commands/plugin.rs)
