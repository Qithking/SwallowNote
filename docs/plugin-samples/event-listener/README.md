# Event Listener 示例

实时显示宿主事件流：note 增删改、theme 切换、settings 变化等。

**学习目标**：
- `usePluginEvent` 订阅单一事件
- `usePluginEvents` 订阅多事件
- 模块级订阅（`pluginEventBus.on`）+ onLoad/onUnload 生命周期
- 显示 payload 完整结构

## 文件

- [manifest.json](./manifest.json)
- [index.tsx](./index.tsx)

## 预期效果

- 右侧面板，事件流实时滚动
- 显示最近 50 条事件
- 颜色区分不同事件类型
- 主题切换时面板实时刷新
- 关闭笔记时面板收到 `note:close` 事件

## 事件订阅三种方式

| 方式 | 适用场景 |
| --- | --- |
| `usePluginEvent(panel, event, handler)` | panel 内单一事件 |
| `usePluginEvents(panel, events, handler)` | panel 内多事件 + event 名 |
| `pluginEventBus.on(event, handler)` | onLoad/onUnload 中的模块级订阅 |

## 完整 API

参见 [events.md](../../plugin-system/events.md)
