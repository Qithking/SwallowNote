# Command Palette 示例

展示 `registerCommand` + `unregisterCommand` + `usePluginCommands`，向命令面板贡献命令。

**学习目标**：让插件命令出现在宿主命令面板（Ctrl/Cmd+P），可绑定快捷键。

## 文件

- [manifest.json](./manifest.json) — 元数据
- [index.tsx](./index.tsx) — 命令注册 + 面板展示

## PluginCommand 接口

```typescript
interface PluginCommand {
  id: string                  // 跨重载稳定的唯一 id，宿主按 <pluginId>:<id> 索引
  label: string               // 面板显示文字
  iconName?: string           // 图标名（宿主图标库，如 'Clock' / 'List'）
  category?: string           // 可选分组类别（如 'Tools'）
  when?: () => boolean        // 可见性谓词，返回 false 时面板隐藏但注册表保留
  onTrigger: () => void | Promise<void>  // 触发回调（无参）
}
```

## 注册流程

1. **onLoad** 中调用 `registerCommand(pluginId, command)` 注册命令
2. 宿主自动按 `<pluginId>:<id>` 去重（同 id 覆盖）
3. 用户在命令面板选择命令 → 宿主调用 `onTrigger()`
4. **onUnload** 中 `clearPluginCommands(pluginId)` 批量清理

### 命令通信

`onTrigger` 在命令面板上下文中执行（不在 React 内）。若需通知面板刷新，应使用**模块级内部总线**（本示例的 `internalListeners`），不要用宿主事件总线 `events.emit`（宿主总线是单向的 host → plugin，插件不能 emit）。

## 本示例注册的 3 个命令

| id | label | iconName | category | when |
| --- | --- | --- | --- | --- |
| `insert-timestamp` | Insert Timestamp | Clock | — | — |
| `insert-toc` | Insert Table of Contents | List | — | `() => true` |
| `word-count` | Show Word Count | FileText | Tools | — |

## usePluginCommands hook

```typescript
const commands = usePluginCommands()
```

返回当前注册表中所有可见命令（`when()` 返回 true 的）的快照，自动订阅注册表变更。`when()` 返回 false 的命令被过滤但保留在注册表中，下次 `when()` 翻转时自动恢复显示。

## 预期效果

1. 侧边栏出现命令图标，点击展开面板
2. 面板列出已注册的 3 个命令（id / label / iconName / category）
3. 打开命令面板（Ctrl/Cmd+P）→ 看到 3 个命令
4. 触发任一命令 → 面板"最近触发"区域显示命令名与时间

## 权限

`permissions: []` —— 命令注册不依赖受保护能力（不调 `store` / `events` / `backend`），无需声明权限。命令的 `onTrigger` 若需调用受保护 API（如读写存储），则需补充对应权限。
