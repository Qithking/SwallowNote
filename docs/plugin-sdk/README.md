# @swallow-note/plugin-sdk

零依赖插件开发 SDK。**无需 clone SwallowNote 源码** 即可在任意 TypeScript 项目中开发、调试、构建插件。

## 为什么需要这个

此前插件作者必须在 SwallowNote 源码内开发（因为示例 import `@/types/plugin` `@/lib/...`）。SDK 解决了三个痛点：

1. **路径别名** — SDK 把所有类型 + stub 实现 + React hooks 集中到一个 npm 包，import 路径稳定
2. **浏览器内调试** — stub 实现提供 localStorage 模拟、EventTarget 事件总线、内存右键菜单注册表，dev server 即可运行
3. **双模式构建** — 同一份源码同时支持 standalone 模式（带 stub）和 host 模式（stub 被宿主覆盖）

## 安装

```bash
npm install @swallow-note/plugin-sdk react react-dom
```

或使用 `plugin-template/` 起步项目：

```bash
cp -r docs/plugin-template my-plugin
cd my-plugin
npm install
npm run dev
```

## 起步

```typescript
// src/index.tsx
import {
  type PluginManifest,
  type PluginPanelProps,
  pluginEventBus,
  registerContextMenu,
  usePluginStorage,
} from '@swallow-note/plugin-sdk'

function Icon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24">…</svg>
}

function Panel(panel: PluginPanelProps) {
  const [count, setCount] = usePluginStorage<number>(panel, 'count', 0)
  return (
    <div style={{ padding: 16 }}>
      <h2>Count: {count}</h2>
      <button onClick={() => setCount((c) => c + 1)}>+</button>
    </div>
  )
}

/**
 * 接管 .smm 文件的编辑器组件。
 *
 * 声明式注册：manifest 声明 `editorFileExtensions` + `editorComponent` 后，
 * 宿主在插件加载时自动完成 registerEditor（幂等），禁用/卸载时自动清理
 * ——无需在生命周期钩子里手动 registerEditor/unregisterEditor 配对。
 */
function MindMapEditorView({ content, onChange }) {
  // ... 完整的 .smm 编辑器实现
  return <div>…</div>
}

const manifest: PluginManifest = {
  id: 'com.example.demo',
  name: 'Demo',
  description: 'My first plugin',
  version: '0.1.0',
  author: 'You',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 100,
  enabled: true,
  icon: Icon,
  panel: Panel,

  // ① 静态声明：宿主 loadAllPlugins 加载时按这两个字段自动 registerEditor
  //    （幂等），禁用/卸载时自动 unregisterEditor，插件侧无需手动维护
  editorFileExtensions: ['.smm'],
  editorComponent: MindMapEditorView,

  // ② 权限：必须包含 'editor'，否则自动注册会被拒绝
  permissions: ['editor', 'events', 'storage'],
}

export default manifest

// 宿主加载插件时需调用 setHost 接管 stub，必须 re-export 让宿主拿到
export { setHost } from '@swallow-note/plugin-sdk'
```

## definePlugin 入口模式

`definePlugin` 让 **manifest.json 成为静态字段的唯一来源**（id / version / permissions / editorFileExtensions 等）：静态字段直接从 `manifest.json` import，React 组件与生命周期钩子由第二参注入，入口收敛为十来行且无需 `as PluginManifest` 断言。

```typescript
// src/index.tsx
import { definePlugin } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'   // Vite JSON import，单一来源

function Icon({ size = 18 }: { size?: number }) { /* … */ }
function Panel(panel: PluginPanelProps) { /* … */ }

export default definePlugin(manifestJson, {
  icon: Icon,
  panel: Panel,
  // editorComponent: MindMapEditorView,   // 带编辑器的插件在此注入组件
  onLoad: async () => { /* 钩子均可选，空壳可省略 */ },
})

// 必须保留：宿主从插件 bundle 调用 setHost 完成接管；打包器
// tree-shake 不得移除该导出，否则宿主无法安装 override 层。
export { setHost } from '@swallow-note/plugin-sdk'
```

要点：

- **manifest.json 单一来源** — 第一参类型为 `PluginManifestJson`（`PluginManifest` 去掉组件字段与钩子后的形状；`iconPosition` / `contentPosition` / `permissions` 放宽为 string，适配 resolveJsonModule 的 JSON 字面量宽化）。版本、权限等静态字段只维护 manifest.json 一处。
- **生命周期钩子均可选** — 空壳钩子直接省略。宿主在插件模块加载完成、首个 API 调用之前即安装宿主接管（`setHost`），SDK API 在钩子内外全程可用。

## 导出清单

| 类别 | 名称 |
| --- | --- |
| **类型** | `PluginManifest`, `PluginManifestJson`, `PluginDefinition`, `PluginDependency`, `PluginContext`, `PluginPanelProps`, `PluginPanelRequest`, `PluginStorage`, `PluginEventBus`, `PluginEvent`, `PluginEventPayloadMap`, `PluginEventHandler`, `PluginLifecycleHook`, `IconPosition`, `ContentPosition`, `ContextMenuItem`, `ContextMenuContext`, `ContextMenuLocation`, `ContextMenuRegistry`, `PluginCommand`, `PluginPermission`, `EditorToolbarConfig`, `OpenEditorTabProps`, `ToolbarButtonProps`, `PluginEditorApi`, `PluginEditorSelection`, `PluginFilesApi`, `PluginSecureStorage`, `InvokeBackendStreamOptions`, `HostOverrides`, `RunLifecycleHookOptions` |
| **运行时** | `pluginEventBus`, `getPluginStorage`, `dropPluginStorage`, `SETTINGS_CACHE_KEY`, `getSetting`, `setSetting`, `getAllSettings`, `onSettingsChange`, `dropPluginSettings`, `registerContextMenu`, `unregisterContextMenu`, `clearPluginMenuItems`, `getContextMenuItems`, `getStubMenuRegistry`, `registerCommand`, `unregisterCommand`, `clearPluginCommands`, `listPluginCommands`, `subscribePluginCommands`, `getStubCommandRegistry`, `registerEditor`, `unregisterEditor`, `getEditorForExtension`, `getActivePluginExtensions`, `openEditorTab`, `closeEditorTab`, `closePluginTabs`, `getSecure`, `setSecure`, `deleteSecure`, `listSecureKeys`, `editor`, `files`, `buildPluginContext`, `runLifecycleHook`, `setHost`, `clearHost` |
| **React hooks** | `usePluginStorage`, `usePluginServices`, `usePluginCommands`, `usePluginEvent`, `usePluginEvents` |
| **Emit 助手** | `emitNoteOpened`, `emitNoteClosed`, `emitNoteSaved`, `emitNoteChanged`, `emitThemeChanged`, `emitLocaleChanged`, `emitSettingChanged`, `emitAppReady`, `emitAppExit`, `emitPluginSettingsChanged` |
| **错误类** | `PluginError`, `PluginPermissionDeniedError`, `PluginLifecycleTimeoutError` |
| **版本** | `SDK_VERSION`（当前 `'0.1.0'`） |

## 注册文件编辑器

插件可以**接管一种或多种文件扩展名的渲染**——让 host 在打开 `.smm` / `.drawio` / `.excalidraw` 等"非 Markdown 文件"时，把渲染权交给你而不是内置的 markdown / 代码编辑器。

整套机制是**声明式**的：manifest 声明 `editorFileExtensions` + `editorComponent`，宿主自动完成注册与清理。插件侧**不需要**（也不应）手动 `registerEditor` / `unregisterEditor` 配对。

### 1. 静态声明（在 `manifest` 上）

```typescript
// manifest.json（单一来源）：扩展名清单与权限
// "editorFileExtensions": [".smm"],
// "permissions": ["editor", ...]

// src/index.tsx：组件无法放进 JSON，经 definePlugin 第二参注入
export default definePlugin(manifestJson, {
  editorComponent: MindMapEditorView,
})
```

- `editorFileExtensions`：扩展名清单，**带点、全部小写**（如 `.smm` / `.drawio`）。host 在解析 manifest 时会静态检查。
- `editorComponent`：你的 React 组件，签名固定为 `{ content: string; onChange: (content: string) => void } => JSX.Element`。`onChange` 把新内容推回 host，host 负责落盘。
- `permissions`：必须包含 `'editor'`。未声明的插件自动注册会失败——host 记录 warning，不中断其余扩展与其余插件的加载。

### 2. 宿主自动注册

宿主 `loadAllPlugins` 在插件模块加载完成后调用 `registerEditorsFromManifest`，对声明的每个扩展名自动 `registerEditor`。两条路径保证启用状态正确：

- 加载时已启用的插件，模块加载完成即注册；
- 加载时被禁用、随后被用户启用的插件，由插件 store 的启用路径补注册。

幂等性：`registerEditor` 对「同插件同扩展」是替换语义，加载重扫 / 启用重放导致的重复调用不会产生重复注册，只会以相同组件覆盖（仅不同插件抢注同一扩展才抛冲突）。禁用与卸载时宿主自动 `unregisterEditor` 清理，该插件注册的所有扩展名一次性清空。

### 3. host 侧分发

`src/components/Editor.tsx` 在渲染一个文件时：

1. 算 `fileType = detectFileType(filename)`（`fileTypeUtils.ts` 会读 `getActivePluginExtensions()` 决定 `.smm` 是 `'mindmap'` 还是默认 code）
2. 查 `pluginEditorRegistry.getEditorForExtension(ext)`：命中 → 渲染 `PluginEditor`；未命中 → 渲染兼容垫片（一个轻量"请安装 X 插件"占位）
3. 注册表每次变更会 emit `editor:registered` / `editor:unregistered` 事件，host 的 `Editor.tsx` 和文件树右键菜单都订阅了这两事件——插件装/卸时**实时**反映

### 检测 helper

```typescript
// 当前已激活的插件扩展名集合，用于自定义 UI 判断
const exts = getActivePluginExtensions()
if (exts.has('.smm')) {
  // 显示"新建思维导图"等菜单项
}
```

### 完整示例

完整可运行的 `.smm` 思维导图插件源码在 `plugins/mindmap/`，参考 [plugins/mindmap/src/index.tsx](../../plugins/mindmap/src/index.tsx)。

## 命令面板 API

插件可向命令面板（Ctrl/Cmd+P）贡献条目，并支持绑定快捷键。`PluginCommand` 的 `id` 需跨重载稳定，宿主按 `<pluginId>:<id>` 索引。

```typescript
import {
  type PluginCommand,
  registerCommand,
  unregisterCommand,
  clearPluginCommands,
} from '@swallow-note/plugin-sdk'

const cmd: PluginCommand = {
  id: 'insert-timestamp',
  label: '插入时间戳',
  iconName: 'clock',
  category: '编辑',
  when: () => true,            // 可选：返回 false 时命令面板隐藏该项
  onTrigger: () => {
    // 命令被触发时执行
  },
}

// 在生命周期钩子中注册 / 反注册
onLoad:    ({ pluginId }) => registerCommand(pluginId, cmd),
onUnload:  ({ pluginId }) => unregisterCommand(pluginId, 'insert-timestamp'),
onDisable: ({ pluginId }) => clearPluginCommands(pluginId), // 清空该插件全部命令
```

配套的查询 / 订阅 API：

- `listPluginCommands()` — 返回当前已注册的全部 `PluginCommand[]`
- `subscribePluginCommands(listener)` — 订阅注册表变更，返回取消订阅函数
- `getStubCommandRegistry()` — 读取 standalone 模式的内存注册表（调试用）

### `usePluginCommands()` hook

React 组件中获取命令面板实时快照，自动过滤 `when()` 返回 `false` 的条目：

```typescript
import { usePluginCommands } from '@swallow-note/plugin-sdk'

function CommandList() {
  const commands = usePluginCommands()
  return commands.map((c) => <div key={c.id}>{c.label}</div>)
}
```

## 编辑器 Tab API

让插件在主编辑区打开 / 关闭 tab，由宿主用内置 `MarkdownEditor` 渲染 `content`。用户编辑后宿主通过 `onChange` 把新内容回传插件，插件负责落盘。

```typescript
import {
  type OpenEditorTabProps,
  type EditorToolbarConfig,
  openEditorTab,
  closeEditorTab,
  closePluginTabs,
} from '@swallow-note/plugin-sdk'

const toolbarConfig: EditorToolbarConfig = {
  openHistory: false,      // 隐藏历史记录按钮
  directory: false,        // 隐藏大纲按钮
  // 未设置的字段默认显示
}

const props: OpenEditorTabProps = {
  id: 'note-1',            // 相同 id 复用已有 tab
  name: '加密笔记',
  icon: <LockIcon />,      // 可选，替换默认 FileText 图标
  content: '# Hello',
  onChange: (next) => {
    // 用户编辑后回传新内容，插件负责保存
  },
  toolbarConfig,
}

openEditorTab(pluginId, props)        // 打开 / 复用 tab
closeEditorTab(pluginId, 'note-1')    // 关闭指定 tab
closePluginTabs(pluginId)             // 关闭该插件打开的全部 tab（卸载/锁定场景）
```

> ⚠️ standalone 预览模式下没有主编辑区，这三个 API 会打印警告并 no-op；host 模式下由宿主 bridge 接管。

## 设置 API

按 schema 读写单个插件设置，独立于 `PluginStorage` 的 JSON 存储。Host 模式走 SQLite（`plugin_settings_<id>` 表），standalone 模式走内存缓存（持久化到 `PluginStorage` 的 `__settings__` key）。

```typescript
import {
  getSetting,
  setSetting,
  getAllSettings,
  onSettingsChange,
} from '@swallow-note/plugin-sdk'

// pluginId 无需（也无法）显式传入：SDK 把当前插件 ID 绑定在宿主安装的
// override 层上，模块级 API 自动解析目标插件——类型层面不存在跨插件读写入口。

// 读取单个设置（类型安全）
const theme = await getSetting<string>('theme')

// 持久化单个设置（写穿 SQLite / 缓存）
await setSetting('theme', 'dark')

// 读取所有设置为扁平 key/value map
const all = await getAllSettings()

// 订阅设置变更，handler 收到完整 values map
const unsub = onSettingsChange((values) => {
  console.log('settings changed:', values)
})
// 卸载时调用 unsub() 取消订阅
```

`PluginPanelProps` 同样暴露 `getSetting` / `setSetting` / `getAllSettings` / `onSettingsChange`（已绑定到当前 `pluginId`，无需显式传 id）：

```typescript
function Panel(panel: PluginPanelProps) {
  const [theme, setTheme] = useState(null)
  useEffect(() => {
    panel.getSetting<string>('theme').then(setTheme)
    return panel.onSettingsChange((values) => setTheme(values.theme as string))
  }, [panel])
  // ...
}
```

设置变更会通过 `plugin-settings:change` 事件广播，可用 `emitPluginSettingsChanged(pluginId, values)` 手动触发（通常由宿主在 SQLite 写入后调用）。

## Frontmatter API

`PluginPanelProps` 与 `ToolbarButtonProps` 都提供活动笔记 frontmatter 的读写与订阅能力：

```typescript
function Panel(panel: PluginPanelProps) {
  // 读取当前笔记 frontmatter（无则返回 null）
  const fm = panel.getActiveNoteFrontmatter()

  // 合并更新 frontmatter（宿主负责落盘）
  panel.setActiveNoteFrontmatter({ tags: ['demo'] })

  // 订阅 frontmatter 变更
  useEffect(() => {
    return panel.onNoteFrontmatterChanged((next) => {
      console.log('frontmatter updated:', next)
    })
  }, [panel])
}
```

## 面板一次性请求

宿主调用 `openPluginPanel(pluginId, payload)` 打开插件右侧面板时，可携带一段**一次性 payload**（结构由插件自定义，宿主不解析）。面板组件通过 props 的 `pendingRequest` 字段读到它：

```typescript
function Panel(panel: PluginPanelProps) {
  // 宿主 openPluginPanel('my-plugin', { selection: '...' }) 打开时收到 payload；
  // 未携带 payload 打开、或本次触发非本插件时为 null。
  if (panel.pendingRequest) {
    // 一次性语义：面板挂载（props 送达）后宿主即清空，下次打开不再重复收到；
    // 连续触发时以最新请求覆盖。
  }
}
```

> 携带 payload 的 `backend` 权限插件同时会预热后端进程（仅拉起子进程，无 JSON-RPC 请求），消除首请求冷启动延迟。

## 后端调用 API

插件通过 Rust 后端执行重计算 / 本地工具类命令时，使用 `invokeBackend`（非流式）与 `invokeBackendStream`（流式）。两个方法在生命周期钩子的 `context` 与面板 / 工具栏组件的 props（`panel` / `toolbar`）上均可用。**权限要求**：manifest 必须声明 `'backend'`。

IPC 形态：宿主统一经 `invoke('invoke_plugin', { pluginId, command, args })` 调到 Tauri 命令，插件侧不感知。

### invokeBackend（泛型）

```typescript
const count = await panel.invokeBackend<number>('count_words', { text: 'hello world' })
```

签名 `invokeBackend<T>(command, args?): Promise<T>`：第一参为后端命令名（JSON-RPC method），第二参为可选参数对象，Promise 以后端响应帧的 `result` 兑现，泛型参数标注返回类型。

### invokeBackendStream（流式 + 取消）

```typescript
const total = await panel.invokeBackendStream<{ index: number; line: string }, number>(
  'my_plugin_stream_lines',
  { path: '/path/to/big.txt' },
  (chunk) => console.log('收到行', chunk.index, chunk.line),
  {
    // 可选：流式首块超时秒数（默认 90s，最小 1s，适配推理模型首 token 延迟）
    firstChunkTimeoutSecs: 120,
    // 可选：通道建立时回调，携带宿主生成的 requestId
    onStart: (info) => { requestId = info.requestId },
  },
)
```

- `onChunk` 逐块回调增量，Promise 以**最终响应帧**的结果终结（通知帧只负责逐块回调）。
- 第四参 `InvokeBackendStreamOptions`：`firstChunkTimeoutSecs` 覆盖首块超时；`onStart` 在通道建立时回传宿主生成的 `requestId`，插件据此调用**后端自身的取消命令**实现流式中断——前提是后端实现了对应逻辑（如 AI 插件的 `stopStream`）：

```typescript
let requestId: number | undefined
const result = await panel.invokeBackendStream<Chunk, Result>(
  'my_plugin_stream',
  args,
  (chunk) => render(chunk),
  { onStart: (info) => { requestId = info.requestId } },
)
// 用户点停止时：
await panel.invokeBackend('stopStream', { requestId })
```

## 编辑器写 API 与工作区文件 API

插件可向当前编辑器写入内容、在工作区内创建/列出笔记。**两条通路**：面板/工具栏组件用 props 上注入的 `panel.editor` / `panel.files`（pluginId 显式绑定）；生命周期钩子内用模块级 `editor` / `files`（override 闭包自持 pluginId）。

**权限要求**：manifest 必须声明 `'editor-write'`（editor API）与 `'files'`（files API），未授权时宿主桥接抛 `PluginPermissionDeniedError`。

```typescript
// 面板场景：把 AI 生成的 markdown 写回编辑器
async function applyResult(panel: PluginPanelProps, markdown: string) {
  // 查询当前选区（无选区/编辑器未挂载返回 null）
  const selection = await panel.editor.getSelection()
  // 替换当前选区；无选区时拒绝并返回 false（绝不整文替换，防数据破坏）
  const ok = await panel.editor.replaceSelection(markdown)
  if (!ok) {
    // 退而求其次：在光标处插入
    await panel.editor.insertAtCursor(markdown)
  }
}

// 生命周期钩子场景：模块级命名空间
onLoad: async () => {
  const notes = await files.listWorkspace('meeting')   // 相对路径，大小写不敏感过滤
  if (!notes.includes('meetings/2026-10-21.md')) {
    await files.createNote('meetings/2026-10-21.md', '# Meeting\n')  // 已存在抛错；父目录自动创建
  }
}
```

| API | 签名 | 语义 |
| --- | --- | --- |
| `editor.insertAtCursor` | `(text: string) => Promise<boolean>` | 光标处插入 markdown；编辑器未挂载/解析失败返回 false |
| `editor.replaceSelection` | `(text: string) => Promise<boolean>` | 替换当前选区；**无选区拒绝返回 false** |
| `editor.replaceContent` | `(text: string) => Promise<void>` | 整文替换当前笔记 |
| `editor.getSelection` | `() => Promise<PluginEditorSelection \| null>` | 查询当前选区 `{ text, lineRange }`（1-based 行号）；无选区/编辑器未挂载返回 null |
| `files.createNote` | `(relPath: string, content: string) => Promise<void>` | 工作区内建笔记；`..` 逃逸与已存在路径抛错 |
| `files.listWorkspace` | `(query?: string) => Promise<string[]>` | 递归列出 Markdown 文件（正斜杠相对路径），query 大小写不敏感过滤 |

## 安全存储 API

插件可持久化加密的敏感值（API 密钥、token 等）。值经 Rust 侧 **AES-256-GCM** 加密落盘，加密密钥按 machine_id + pluginId 派生——数据库文件被拷走也无法解出原文，插件之间互不可见。**两条通路**（与 editor / files 同构）：面板/工具栏组件用 props 上注入的 `panel.secureStorage`（pluginId 显式绑定）；生命周期钩子内用模块级 `getSecure` / `setSecure` / `deleteSecure` / `listSecureKeys`（override 层隐式绑定当前插件，调用方无法指定其他插件 ID）。

**权限要求**：manifest 必须声明 `'secure-storage'`，未授权时宿主桥接抛 `PluginPermissionDeniedError`。

```typescript
// 面板场景：保存用户配置的模型 API 密钥
async function saveKey(panel: PluginPanelProps, key: string) {
  await panel.secureStorage.set('apiKey', key)
}

// 生命周期钩子场景：模块级命名空间（pluginId 隐式解析自当前 override 层）
onLoad: async () => {
  const apiKey = await getSecure('apiKey')
  if (apiKey === null) {
    // null = 该键从未存储过
    await setSecure('apiKey', 'sk-...')
  }
  const keys = await listSecureKeys()   // 键名列表（不含值），字典序
  await deleteSecure('oldKey')          // 幂等：键不存在也不报错
}
```

| API | 签名 | 语义 |
| --- | --- | --- |
| `getSecure` | `(key: string) => Promise<string \| null>` | 读取本插件的加密值；**`null` = 从未存储**；密文无法解密（如数据库被恢复到另一台机器）时**抛错**，与「未存储」可区分 |
| `setSecure` | `(key: string, value: string) => Promise<void>` | 加密并持久化；同键覆盖旧值 |
| `deleteSecure` | `(key: string) => Promise<void>` | 删除一个键；幂等 |
| `listSecureKeys` | `() => Promise<string[]>` | 列出本插件全部键名（不含值），字典序 |

> **standalone 模式**：npm run dev 预览时无宿主 override 层，四函数退化为进程内 in-memory stub（不持久、不加密），`dropPluginSettings` 会联动清空 stub；真实加密语义仅在宿主内运行时生效。

## 错误类与清理 API

### 错误类

- **`PluginError`** — 后端调用（`invokeBackend` / `invokeBackendStream`）失败时抛出。宿主把后端 JSON-RPC 错误的 `code` 与附加 `data` 一并透传（Rust 侧 `JsonRpcWithCode` 经 `__pluginError` 标记的错误帧传回，前端规范化为 `PluginError`），供插件按业务错误码分支。
- **`PluginPermissionDeniedError`** — 插件尝试执行未授权操作时抛出。携带 `pluginId`、`permission`、`operation` 字段。SDK 不依赖宿主的类（无法 `instanceof`），按 `name` 字段匹配。`registerEditor` 在 host 模式下会先走宿主的权限断言。
- **`PluginLifecycleTimeoutError`** — `runLifecycleHook` 在 `timeoutMs` 内未完成时抛出。携带 `elapsedMs`、`timeoutMs` 字段。宿主默认 5s 超时，用于标记插件为不健康状态。

`PluginError` 的典型用法——catch 后判型读取 `code` / `data`：

```typescript
import { PluginError } from '@swallow-note/plugin-sdk'

try {
  await panel.invokeBackend<MyStruct>('my_plugin_parse', { data: '...' })
} catch (err) {
  if (err instanceof PluginError) {
    // err.code：后端 JSON-RPC error 的 code（未透传时 undefined）
    // err.data：后端 JSON-RPC error 的附加载荷（未携带时 undefined）
    console.error('parse failed:', err.code, err.data)
  } else {
    throw err  // 传输层错误等，原样上抛
  }
}
```

```typescript
import {
  PluginPermissionDeniedError,
  PluginLifecycleTimeoutError,
  runLifecycleHook,
  type RunLifecycleHookOptions,
} from '@swallow-note/plugin-sdk'

const opts: RunLifecycleHookOptions = {
  timeoutMs: 5000,
  onTimeout: (elapsedMs) => console.warn(`hook overran ${elapsedMs}ms`),
}
await runLifecycleHook(plugin.hooks?.onLoad, ctx, opts)
```

### 清理 API

- **`dropPluginStorage(pluginId)`** — 释放指定插件的 storage 缓存，并联动清理设置缓存与监听器。插件卸载时调用，避免内存泄漏。
- **`dropPluginSettings(pluginId)`** — 仅清理指定插件的设置缓存、本地监听器与安全存储 standalone stub（`dropPluginStorage` 内部会调用它）。
- **`clearHost()`** — 清空全部 host override 层（测试重置场景用，生产代码应使用 `setHost` 返回的 `restore` 回调）。

## 双模式

### Standalone（默认）

```bash
npm run dev      # vite dev server，带 preview 框架
npm run build    # 产出 dist/index.js（含 stub），可在浏览器中独立运行
```

生产构建使用 **ES 模块**格式，React 等运行时需 external 以复用宿主实例（避免多实例冲突）：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  if (mode !== 'production') return { plugins: [react()] }
  return {
    plugins: [react()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/plugin/index.tsx'),
        formats: ['es'],          // ← ES 格式，宿主以 ES module 加载
        fileName: () => 'index.js',
      },
      rollupOptions: {
        // React 全家桶需 external，使用宿主实例
        external: [
          'react', 'react-dom', 'react-dom/client',
          'react/jsx-runtime', 'react/jsx-dev-runtime',
        ],
        output: { inlineDynamicImports: true }, // blob URL 无法解析分块
      },
    },
  }
})
```

### Host 模式

打包后 `index.js` + `manifest.json` 上传至 SwallowNote。宿主加载时：

```typescript
import { invoke } from '@tauri-apps/api/core'
import { setHost } from '@swallow-note/plugin-sdk'
import { getPluginStorage, pluginEventBus, pluginMenuRegistry } from '@/lib/...'

setHost({
  getPluginStorage: (id) => getPluginStorage(id),
  on: (e, h) => pluginEventBus.on(e, h),
  off: (e, h) => pluginEventBus.off(e, h),
  emit: (e, p) => pluginEventBus.emit(e, p),
  registerContextMenu: (id, item) => pluginMenuRegistry.register(id, item),
  unregisterContextMenu: (id, itemId) => pluginMenuRegistry.unregister(id, itemId),
  clearPluginMenuItems: (id) => pluginMenuRegistry.clearPlugin(id),
  getContextMenuItems: (loc, ctx) => pluginMenuRegistry.query(loc, ctx),
  // 统一 IPC 形态：invoke_plugin 命令 + { pluginId, command, args }
  invokeBackend: async <T>(cmd, args) =>
    invoke<T>('invoke_plugin', { pluginId, command: cmd, args }),
})
```

调用 `setHost` 之后，stub 全部失效，所有后续 SDK 调用走宿主真实实现。卸载时 `setHost` 返回的函数可恢复 stub。

## 设计要点

- **零运行时依赖**（仅 `react` peer dep）— bundle 小
- **API 稳定** — `src/types/plugin.ts` 变更时 SDK 同步更新；类型对插件作者完全可预测
- **Host takeover 是无侵入的** — 插件代码不需要 `if (host) ... else ...` 分支
- **Stub 是 real-world 的 subset** — 仅 API 行为接近宿主，但存储走 localStorage，事件总线走 EventTarget，菜单注册表走内存 Map
- **`usePluginStorage` 行为镜像宿主** — 同 hydrate 流程、同函数式 setter、同 null 删除语义

## 限制

- **Rust 后端** — `invokeBackend` 在 standalone 模式返回 `null` 并 console.warn。需要真实 Tauri 调用必须用 host 模式。
- **持久化** — standalone 模式持久化到 localStorage（域名下 5-10MB 限制）。Host 模式无此限制（走 Tauri 文件系统）。
- **事件载荷** — stub 转发 payload 的引用相同；宿主可能 clone payload，插件代码不应依赖引用相等。
- **命令面板 / 编辑器注册表** — standalone 模式同样提供内存版 stub（`registerCommand` / `registerEditor` 等走 `StubCommandRegistry` / `StubEditorRegistry`），dev server 内端到端可用；但快捷键绑定、权限校验、SQLite 设置落盘等宿主能力仅在 host 模式下生效。`getStubMenuRegistry()` / `getStubCommandRegistry()` 可读取 stub 供调试。
- **编辑器 Tab** — `openEditorTab` / `closeEditorTab` / `closePluginTabs` 在 standalone 模式下没有主编辑区可挂载，仅打印警告并 no-op；host 模式下由宿主 bridge 接管。
- **权限断言** — `__assertPluginPermission` 仅由宿主安装，standalone 模式下 `registerEditor` 等放行所有注册，下次加载时由 host 重新校验。
