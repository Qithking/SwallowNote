# Custom Editor 示例

展示 `registerEditor` + `editorFileExtensions` + `editorComponent` 三层机制，为 `.smm` 文件注册自定义编辑器。

**学习目标**：让插件接管特定扩展名文件的渲染，替代内置 Markdown / 代码编辑器。

## 三层机制

| 层级 | 字段 / API | 作用 |
| --- | --- | --- |
| 静态声明 | manifest.`editorFileExtensions` | 加载前供宿主做权限/冲突预检 |
| 静态声明 | manifest.`editorComponent` | 声明匹配扩展名时挂载的组件 |
| 运行时注册 | `registerEditor(pluginId, ext, component)` | 把组件写入运行时注册表，宿主打开文件时查表 |

三者缺一不可：
- 只写 manifest 字段，宿主预检通过但运行时查不到组件 → 文件回落到内置编辑器；
- 只调 `registerEditor`，宿主预检看不到声明 → 可能在权限审计时漏报。

## 文件

- [manifest.json](./manifest.json) — 元数据（`hasBackend: false`）
- [index.tsx](./index.tsx) — `SmmEditor` 组件 + `onLoad`/`onUnload` 注册

## editorComponent props

`editorComponent` 接收 `{ content, onChange }`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | `string` | 文件原始内容（字符串） |
| `onChange` | `(content: string) => void` | 用户编辑后回调，传回新内容；宿主据此标记文件未保存 |

> 注意：与 `panel` 的 `PluginPanelProps` 不同，`editorComponent` 只接收这两个字段，不包含 `store` / `events` / `invokeBackend` 等。如需这些能力，应在 `onLoad` 中通过 `getPluginStorage(pluginId)` 等模块级 API 获取。

## 预期效果

1. 侧边栏出现文件图标，点击展开面板显示 `.smm` 注册状态
2. `onLoad` 触发时调用 `registerEditor`，面板"注册状态"变为"已注册"
3. 打开任意 `.smm` 文件 → 主区域挂载 `SmmEditor`：左侧编辑 JSON 源码，右侧实时预览解析结果
4. 编辑内容 → `onChange` 触发，宿主标记文件未保存
5. 卸载插件 → `onUnload` 调用 `unregisterEditor`，`.smm` 回落到内置编辑器

## 冲突检测

宿主在 `registerEditor` 时检测扩展名冲突：同一扩展名若已被其他插件注册，会抛出错误并 toast 提示。本示例使用 `.smm`（SwallowNote Memo 的缩写），不易与常见格式冲突。

## 权限

`permissions: ['editor']` —— 注册文件编辑器必须声明 `editor` 权限。宿主在 `registerEditor` 调用时通过 `assertPermission(pluginId, 'editor', ...)` 校验，未授权抛 `PluginPermissionDeniedError`。

## 相关 API

- `registerEditor(pluginId, extension, component)` — 注册
- `unregisterEditor(pluginId)` — 卸载本插件所有编辑器
- `getActivePluginExtensions()` — 查询当前注册表快照
- `getEditorForExtension(ext)` — 按扩展名查组件（宿主打开文件时用）
