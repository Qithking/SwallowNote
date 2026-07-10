# Frontmatter Tagger 示例

展示 `getActiveNoteFrontmatter` + `setActiveNoteFrontmatter` + `onNoteFrontmatterChanged`，读写活动笔记的 frontmatter。

**学习目标**：读写笔记顶部的 YAML 元数据块（tags / title / date 等），并实时响应外部变更。

## 文件

- [manifest.json](./manifest.json) — 元数据
- [index.tsx](./index.tsx) — 标签管理面板

## Frontmatter API

三个 API 均在 `PluginPanelProps` 上（也存在于 `ToolbarButtonProps`）：

| API | 签名 | 说明 |
| --- | --- | --- |
| `getActiveNoteFrontmatter()` | `() => Record<string, unknown> \| null` | 读取活动笔记 frontmatter；无活动笔记时返回 `null` |
| `setActiveNoteFrontmatter(data)` | `(data: Record<string, unknown>) => void` | **合并写入**：只更新传入字段，保留其他字段 |
| `onNoteFrontmatterChanged(cb)` | `(cb) => () => void` | 订阅变更，返回取消订阅函数 |

## 合并策略

`setActiveNoteFrontmatter` 是**浅合并**：

```typescript
// 假设当前 frontmatter = { title: '笔记', tags: ['a'], date: '2026-07-10' }

// 只更新 tags，其他字段保留
panel.setActiveNoteFrontmatter({ tags: ['a', 'b'] })
// 结果 = { title: '笔记', tags: ['a', 'b'], date: '2026-07-10' }

// 传入字段会整体覆盖（不深合并）
panel.setActiveNoteFrontmatter({ tags: ['x'] })
// 结果 = { title: '笔记', tags: ['x'], date: '2026-07-10' }
```

> 因此增删标签时，应先读取现有 tags，与新标签合并后整体写回（本示例的做法）。

## null 处理

`getActiveNoteFrontmatter()` 在无活动笔记时返回 `null`。本示例在 `frontmatter === null` 时展示提示文案，避免对 `null` 调用 `frontmatter.tags` 导致崩溃。

## 实时刷新

`onNoteFrontmatterChanged` 在 frontmatter 被任意来源修改时触发：
- 本插件调用 `setActiveNoteFrontmatter`
- 其他插件修改
- 用户在源码视图直接编辑 YAML

本示例在 `useEffect` 中订阅，收到变更后更新 state 重新渲染。订阅返回的取消函数作为 effect 清理，避免内存泄漏。

## 预期效果

1. 打开一个 Markdown 笔记，侧边栏点击标签图标
2. 面板显示该笔记的 frontmatter 与现有 tags
3. 输入标签名回车 → tags 数组新增一项，frontmatter 原始 JSON 实时更新
4. 点击标签的 × → 移除该标签
5. 在源码视图手动改 frontmatter → 面板自动同步
6. 无活动笔记时显示"请打开一个 Markdown 笔记"提示

## 权限

`permissions: ['storage']` —— frontmatter 读写涉及笔记元数据持久化，声明 `storage` 权限。
