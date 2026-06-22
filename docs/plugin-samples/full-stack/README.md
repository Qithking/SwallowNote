# Full Stack 示例

综合 5 项能力：持久化 + 事件订阅 + 设置面板 + 右键菜单 + 生命周期钩子。

**学习目标**：
- 真实场景下多 API 协同
- 模块级订阅 + 组件级 hook 的搭配
- 完整生命周期管理（onLoad 注册、onUnload 清理）
- 复杂 UI 状态机

## 场景

一个"最近笔记"侧边栏插件：

- 监听 `note:open` / `note:save`，记录最近 20 个笔记
- 持久化到 storage（关闭应用不丢失）
- 设置面板可配置：最大记录数 / 是否按时间排序 / 列表视图 vs 计数视图
- 右键菜单：清空历史 / 导出 JSON
- 卸载时清理注册项

## 文件

- [manifest.json](./manifest.json)
- [index.tsx](./index.tsx)

## 完整 API

参见 [README.md](../../plugin-system/README.md) 总览
