# Storage Counter 示例

带持久化存储的计数器：跨会话保留历史记录。

**学习目标**：
- `usePluginStorage` hook 用法
- 函数式更新 `setValue(prev => ...)`
- 复杂对象作为存储值
- 卸载时 `setValue(null)` 删除 key

## 文件

- [manifest.json](./manifest.json)
- [index.tsx](./index.tsx)

## 预期效果

- 侧边栏图标 + 右侧面板
- 面板显示：
  - 当前 count
  - 最近 10 次递增历史
  - "Reset" 按钮（删除存储 key）
  - 持久化时间戳

## 关键代码

```typescript
const [state, setState] = usePluginStorage<State>(panel, 'state', { value: 0, history: [] })

const increment = () => {
  setState(prev => ({
    value: prev.value + 1,
    history: [...prev.history, prev.value + 1].slice(-10),
  }))
}

const reset = () => setState(null)  // 删除 key，回到 initialValue
```

## API 细节

- `usePluginStorage<T>(panel, key, initialValue): [T, setter]`
- setter 接受 `T | ((prev: T) => T) | null`
- `null` 表示删除（fallback 到 initialValue）
- 类型 `T` 必须是 JSON 安全（无函数、无循环）

## 完整 API

参见 [storage.md](../../plugin-system/storage.md)
