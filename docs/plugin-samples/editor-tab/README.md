# Editor Tab 示例

展示 `openEditorTab` + `closeEditorTab` + `closePluginTabs` + `EditorToolbarConfig`，在主编辑区打开与管理自定义 tab。

**学习目标**：让插件把内部数据（加密笔记、数据库摘要等）以 Markdown 形式渲染到主编辑区，复用宿主 MarkdownEditor。

## 文件

- [manifest.json](./manifest.json) — 元数据
- [index.tsx](./index.tsx) — 打开/关闭 tab 的面板

## OpenEditorTabProps

`openEditorTab(pluginId, props)` 的 `props` 类型：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | tab 唯一标识，相同 id 复用已有 tab（不重复创建） |
| `name` | `string` | tab 标题文字 |
| `icon?` | `ReactNode` | tab 标题图标（替换默认 FileText） |
| `content` | `string` | 初始内容（Markdown 字符串） |
| `onChange?` | `(content: string) => void` | 用户编辑后宿主回调，传回新内容 |
| `toolbarConfig?` | `EditorToolbarConfig` | 工具栏按钮显隐配置 |

## EditorToolbarConfig

控制 tab 工具栏各按钮的显示/隐藏，未设置的字段默认显示（向后兼容）。本示例隐藏两个无意义按钮：

```typescript
const toolbarConfig: EditorToolbarConfig = {
  openLocation: false,  // 插件 tab 无文件路径，隐藏「在文件夹中显示」
  openHistory: false,   // 插件 tab 无历史记录，隐藏「历史记录」
}
```

完整字段列表（均为可选 `boolean`，默认 `true`）：

| 字段 | 控制按钮 |
| --- | --- |
| `copyPath` | 复制完整路径 |
| `openLocation` | 在文件夹中显示 |
| `openHistory` | 打开历史记录 |
| `noteProperties` | 笔记属性面板 |
| `directory` | 大纲/目录 |
| `sourceView` | 源码视图切换 |
| `noteWidth` | 宽窄模式切换 |
| `contentLayout` | 内容布局 |
| `downloadRemoteImages` | 下载远程图片 |
| `showFilePath` | 左侧文件路径显示 |
| `externalChangeWarning` | 外部变更警告 |
| `conflictIndicator` | 冲突指示器 |

## 三个 API 对比

| API | 作用 | 适用场景 |
| --- | --- | --- |
| `openEditorTab(pluginId, props)` | 打开/复用一个 tab | 展示插件数据 |
| `closeEditorTab(pluginId, tabId)` | 关闭指定 tab | 删除单个笔记 |
| `closePluginTabs(pluginId)` | 关闭本插件所有 tab | 插件锁定/卸载 |

## 数据流

```
插件 panel ──openEditorTab(content)──▶ 宿主 MarkdownEditor
                                            │
                                     用户编辑内容
                                            │
插件 panel ◀──onChange(newContent)──────────┘
        │
        └─▶ 插件负责持久化（如 store.set / 加密数据库）
```

> 注意：`onChange` 只在用户于主编辑区编辑时触发；插件通过 `setContent` 更新本地 state 不会触发 `onChange`，避免循环。

## 预期效果

1. 侧边栏出现 tab 图标，点击展开面板
2. 面板有 tab 名称输入框、内容文本框、三个按钮
3. 点击「打开 Tab」→ 主编辑区出现新 tab，标题为输入的名称
4. 在主编辑区编辑内容 → 面板文本框同步更新（onChange 回调）
5. 点击「关闭 Tab」→ 关闭最后一个 tab
6. 点击「关闭所有」→ 关闭本插件所有 tab

## 权限

`permissions: []` —— `openEditorTab` / `closeEditorTab` / `closePluginTabs` 不属于受保护能力，无需声明权限。若 `onChange` 回调中需要持久化（`store.set`），则需补充 `'storage'` 权限。
