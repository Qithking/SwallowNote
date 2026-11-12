# Custom Editor 示例

展示**声明式自定义编辑器机制**：在 manifest.json 声明 `editorFileExtensions`，入口经 `definePlugin` 注入 `editorComponent`，宿主在插件启用时自动把组件注册到编辑器注册表并广播 `editor:registered` 事件，卸载/禁用时自动清理。

**学习目标**：让插件接管特定扩展名文件的渲染，替代内置 Markdown / 代码编辑器。

## 声明式机制

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 静态声明 | manifest.json `editorFileExtensions` | 声明能渲染的扩展名（如 `['.smm']`），需同时声明 `editor` 权限 |
| 组件注入 | 入口 `definePlugin(manifestJson, { editorComponent: SmmEditor })` | 声明匹配扩展名时挂载的组件 |
| 宿主自动注册 | 宿主 plugin-loader | 插件 enabled 且同时具备 `editorFileExtensions` + `editorComponent` 时，逐扩展自动注册（同插件同扩展替换语义，重扫幂等） |
| 生命周期事件 | `editor:registered` | 注册完成后宿主广播，面板或其他插件可订阅感知 |

无需（也不应）手动调用 `registerEditor` / `unregisterEditor` —— 注册与清理由宿主依据 manifest 自动配对，插件代码只保留组件本体。

## 文件

- [manifest.json](./manifest.json) — 静态声明（`editorFileExtensions` / `permissions`，`hasBackend: false`）
- [src/index.tsx](./src/index.tsx) — `SmmEditor` 组件 + `definePlugin` 入口

## editorComponent props

`editorComponent` 接收 `{ content, onChange }`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | `string` | 文件原始内容（字符串） |
| `onChange` | `(content: string) => void` | 用户编辑后回调，传回新内容；宿主据此标记文件未保存 |

> 注意：与 `panel` 的 `PluginPanelProps` 不同，`editorComponent` 只接收这两个字段，不包含 `store` / `events` / `invokeBackend` 等。如需这些能力，应在 `onLoad` 中通过 `getPluginStorage(pluginId)` 等模块级 API 获取。

## 预期效果

1. 侧边栏出现文件图标，点击展开面板显示 `.smm` 注册状态
2. 插件启用时宿主自动注册，面板"注册状态"变为"已注册"（可订阅 `editor:registered` 事件感知）
3. 打开任意 `.smm` 文件 → 主区域挂载 `SmmEditor`：左侧编辑 JSON 源码，右侧实时预览解析结果
4. 编辑内容 → `onChange` 触发，宿主标记文件未保存
5. 卸载/禁用插件 → 宿主自动清理注册，`.smm` 回落到内置编辑器

## 冲突检测

宿主自动注册时检测扩展名冲突：同一扩展名若已被其他插件注册，会抛出错误并 toast 提示。本示例使用 `.smm`（SwallowNote Memo 的缩写），不易与常见格式冲突。

## 权限

manifest `permissions: ['editor']` —— 注册文件编辑器必须声明 `editor` 权限。宿主在自动注册时校验，未授权抛 `PluginPermissionDeniedError`。

## 相关 API

- `definePlugin(manifestJson, { editorComponent })` — 入口帮手，manifest 单一来源
- `getActivePluginExtensions()` — 查询当前注册表快照
- `getEditorForExtension(ext)` — 按扩展名查组件（宿主打开文件时用）
