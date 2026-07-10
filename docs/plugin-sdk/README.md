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
  registerEditor,   // ← SDK 把组件推入 host 的 editor 注册表
  unregisterEditor, // ← 配套的清理 API
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
 * ⚠️ 注意：声明 `editorFileExtensions` + `editorComponent` **本身不会**让
 * host 把 .smm 文件的渲染权交给你 —— host 的 Editor.tsx 在渲染一个
 * 文件时会去查 `pluginEditorRegistry`，但这个注册表是空的，直到你
 * 从生命周期钩子调用 `registerEditor` 把它填进去。
 *
 * 因此带 editor 的插件必须实现 `onLoad` / `onUnload`（或 `onEnable` /
 * `onDisable`）钩子来注册/反注册。
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
  pluginPath: '',
  hasBackend: false,

  // ① 静态声明：让 host 在安装时知道这个插件"想要"处理哪些扩展名
  editorFileExtensions: ['.smm'],
  editorComponent: MindMapEditorView,

  // ② 权限：必须包含 'editor'，否则 registerEditor 调用会被拒绝
  permissions: ['editor', 'events', 'storage'],

  // ③ 运行时注入：必须从生命周期钩子调用 registerEditor，host 才
  //    会在 Editor.tsx 的查表路径中真正找到你的组件
  onLoad: ({ pluginId }) => {
    registerEditor(pluginId, '.smm', MindMapEditorView)
  },
  onUnload: ({ pluginId }) => {
    unregisterEditor(pluginId)
  },
  // 启用/禁用切换时同样需要维护注册表，否则用户在禁用→启用
  // 之间打开 .smm 会看到兼容垫片
  onEnable: ({ pluginId }) => {
    registerEditor(pluginId, '.smm', MindMapEditorView)
  },
  onDisable: ({ pluginId }) => {
    unregisterEditor(pluginId)
  },
}

export default manifest

// 宿主加载插件时需调用 setHost 接管 stub，必须 re-export 让宿主拿到
export { setHost } from '@swallow-note/plugin-sdk'
```

## 导出清单

| 类别 | 名称 |
| --- | --- |
| **类型** | `PluginManifest`, `PluginDefinition`, `PluginDependency`, `PluginContext`, `PluginPanelProps`, `PluginStorage`, `PluginEventBus`, `PluginEvent`, `PluginEventPayloadMap`, `PluginEventHandler`, `PluginLifecycleHook`, `IconPosition`, `ContentPosition`, `ContextMenuItem`, `ContextMenuContext`, `ContextMenuLocation`, `ContextMenuRegistry`, `PluginCommand`, `PluginPermission`, `EditorToolbarConfig`, `OpenEditorTabProps`, `ToolbarButtonProps`, `HostOverrides`, `RunLifecycleHookOptions` |
| **运行时** | `pluginEventBus`, `getPluginStorage`, `dropPluginStorage`, `SETTINGS_CACHE_KEY`, `getSetting`, `setSetting`, `getAllSettings`, `onSettingsChange`, `dropPluginSettings`, `registerContextMenu`, `unregisterContextMenu`, `clearPluginMenuItems`, `getContextMenuItems`, `getStubMenuRegistry`, `registerCommand`, `unregisterCommand`, `clearPluginCommands`, `listPluginCommands`, `subscribePluginCommands`, `getStubCommandRegistry`, `registerEditor`, `unregisterEditor`, `getEditorForExtension`, `getActivePluginExtensions`, `openEditorTab`, `closeEditorTab`, `closePluginTabs`, `buildPluginContext`, `runLifecycleHook`, `setHost`, `clearHost` |
| **React hooks** | `usePluginStorage`, `usePluginServices`, `usePluginCommands`, `usePluginEvent`, `usePluginEvents` |
| **Emit 助手** | `emitNoteOpened`, `emitNoteClosed`, `emitNoteSaved`, `emitNoteChanged`, `emitThemeChanged`, `emitLocaleChanged`, `emitSettingChanged`, `emitAppReady`, `emitAppExit`, `emitPluginSettingsChanged` |
| **错误类** | `PluginPermissionDeniedError`, `PluginLifecycleTimeoutError` |
| **版本** | `SDK_VERSION`（当前 `'0.1.0'`） |

## 注册文件编辑器

插件可以**接管一种或多种文件扩展名的渲染**——让 host 在打开 `.smm` / `.drawio` / `.excalidraw` 等"非 Markdown 文件"时，把渲染权交给你而不是内置的 markdown / 代码编辑器。

整套机制分三层，**三层必须齐备** host 才会真正调用你的组件：

### 1. 静态声明（在 `manifest` 上）

```typescript
const manifest: PluginManifest = {
  // … 其他字段 …
  editorFileExtensions: ['.smm'],
  editorComponent: MindMapEditorView,
  permissions: ['editor'],   // ← 必须有 'editor' 权限
}
```

- `editorFileExtensions`：扩展名清单，**带点、全部小写**（如 `.smm` / `.drawio`）。host 在解析 manifest 时会静态检查。
- `editorComponent`：你的 React 组件，签名固定为 `{ content: string; onChange: (content: string) => void } => JSX.Element`。`onChange` 把新内容推回 host，host 负责落盘。
- `permissions`：必须包含 `'editor'`。未声明的插件即使写了上面两个字段，host 也会在安装时打 warning，并拒绝 `registerEditor` 注入。

### 2. 运行时注入（必须从生命周期钩子）

```typescript
onLoad:    ({ pluginId }) => registerEditor(pluginId, '.smm', MindMapEditorView),
onUnload:  ({ pluginId }) => unregisterEditor(pluginId),
onEnable:  ({ pluginId }) => registerEditor(pluginId, '.smm', MindMapEditorView),
onDisable: ({ pluginId }) => unregisterEditor(pluginId),
```

⚠️ **关键约束**：必须从生命周期钩子调 `registerEditor`，**不能**在顶层 `manifest` 字面量中副作用调用。原因：`registerEditor` 走 `setHost(overrides).registerEditor` 桥接到 host 的注册表，host 只能在 `onLoad` / `onEnable` 调用前后通过 `setHost` 装上 hostOverrides。顶层调用会落到 SDK 的本地 stub，host 的 `Editor.tsx` 看不到。

`unregisterEditor` 不带扩展名参数——插件卸载时一次性清空该插件注册的所有扩展名。

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

// 读取单个设置（类型安全）
const theme = await getSetting<string>(pluginId, 'theme')

// 持久化单个设置（写穿 SQLite / 缓存）
await setSetting(pluginId, 'theme', 'dark')

// 读取所有设置为扁平 key/value map
const all = await getAllSettings(pluginId)

// 订阅设置变更，handler 收到完整 values map
const unsub = onSettingsChange(pluginId, (values) => {
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

## 错误类与清理 API

### 错误类

- **`PluginPermissionDeniedError`** — 插件尝试执行未授权操作时抛出。携带 `pluginId`、`permission`、`operation` 字段。SDK 不依赖宿主的类（无法 `instanceof`），按 `name` 字段匹配。`registerEditor` 在 host 模式下会先走宿主的权限断言。
- **`PluginLifecycleTimeoutError`** — `runLifecycleHook` 在 `timeoutMs` 内未完成时抛出。携带 `elapsedMs`、`timeoutMs` 字段。宿主默认 5s 超时，用于标记插件为不健康状态。

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
- **`dropPluginSettings(pluginId)`** — 仅清理指定插件的设置缓存与本地监听器（`dropPluginStorage` 内部会调用它）。
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
  invokeBackend: async (cmd, args) => invoke('plugin_' + cmd, args),
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
