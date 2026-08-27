/**
 * 内置编辑器注册模块
 * 将 MarkdownEditor / CodeEditor / DiffViewer / ConflictResolver / MindMapEditor
 * 注册到统一 EditorRegistry,通过 adapter 适配到统一的 EditorProps 契约
 */
import { lazy, useMemo, type ComponentType } from 'react'
import {
  createEditorRegistry,
  type EditorAdapterContext,
  type EditorDescriptor,
  type EditorProps,
  type EditorRegistry,
} from './editor-registry'
import { useEditorStore } from '@/stores'
import { serializeFrontmatter, parseFrontmatter } from '@/lib/utils/frontmatter'
import { pluginEditorRegistry, usePluginEditors } from '@/stores/pluginEditor'

// lazy 加载各编辑器
const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
)
const CodeEditor = lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditor })),
)
const DiffViewer = lazy(() => import('../DiffViewer/DiffViewer'))
const ConflictResolver = lazy(() => import('../DiffViewer/ConflictResolver'))
const MindMapEditor = lazy(() =>
  import('./MindMapEditor').then((m) => ({ default: m.MindMapEditor })),
)
const ImagePreviewEditor = lazy(() =>
  import('./ImagePreviewEditor').then((m) => ({ default: m.ImagePreviewEditor })),
)

// ---- Adapter wrappers: 统一 EditorProps → 各编辑器原始 props ----

const MarkdownEditorWrapper: ComponentType<EditorProps> = ({ tab, onChange }) => (
  <MarkdownEditor content={tab.content} onChange={onChange} />
)

const CodeEditorWrapper: ComponentType<EditorProps> = ({ tab, onChange }) => (
  <CodeEditor content={tab.content} filename={tab.name} onChange={onChange} className="flex-1" />
)

const DiffViewerWrapper: ComponentType<EditorProps> = ({ tab }) => (
  <DiffViewer diffContent={tab.diffContent || ''} />
)

const ConflictResolverWrapper: ComponentType<EditorProps> = ({ tab }) => (
  <ConflictResolver
    repoPath={tab.conflictRepoPath || ''}
    repoName={tab.conflictRepoName || ''}
    initialSelectedFile={tab.conflictSelectedFile}
    initialCursorLine={tab.conflictCursorLine}
    autoHideTree={tab.conflictAutoHideTree}
  />
)

const MindMapEditorWrapper: ComponentType<EditorProps> = ({ tab, onChange }) => (
  <MindMapEditor content={tab.content} onChange={onChange} filename={tab.name} />
)

// ---- adapter 工厂 ----

/** 默认适配器:透传 tab + onChange,不做转换 */
function defaultAdapter({ tab, onChange }: EditorAdapterContext): EditorProps {
  return { tab, onChange }
}

/**
 * source mode 适配器:处理 markdown frontmatter
 * - content: 合成 frontmatter + body → 完整源码供 CodeMirror 显示
 * - onChange: 解析 frontmatter,分离存储到 store(frontmatter + body)
 * - guard: 用模块级 Set 防止 store 更新 → re-render → CodeMirror dispatch → onChange 循环
 */
const sourceModeUpdating = new Set<string>()

function sourceModeAdapter({ tab, onChange }: EditorAdapterContext): EditorProps {
  const sourceContent =
    tab.frontmatter && Object.keys(tab.frontmatter).length > 0
      ? serializeFrontmatter(tab.frontmatter, tab.content ?? '')
      : tab.content ?? ''

  const wrappedOnChange = (rawContent: string) => {
    if (sourceModeUpdating.has(tab.id)) return
    const isMarkdown = tab.name.toLowerCase().endsWith('.md')
    if (isMarkdown) {
      sourceModeUpdating.add(tab.id)
      const { data, body } = parseFrontmatter(rawContent)
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, frontmatter: data, frontmatterDirty: false } : t
        ),
      }))
      onChange(body)
      queueMicrotask(() => sourceModeUpdating.delete(tab.id))
    } else {
      onChange(rawContent)
    }
  }

  return {
    tab: { ...tab, content: sourceContent },
    onChange: wrappedOnChange,
  }
}

// ---- 内置编辑器 descriptors ----

const descriptors: EditorDescriptor[] = [
  {
    id: 'diff-viewer',
    match: (c) => c.tab.type === 'diff',
    component: DiffViewerWrapper,
    adapter: defaultAdapter,
    priority: 10,
  },
  {
    id: 'conflict-resolver',
    match: (c) => c.tab.type === 'conflict',
    component: ConflictResolverWrapper,
    adapter: defaultAdapter,
    priority: 10,
  },
  {
    id: 'markdown-blocknote',
    match: (c) => c.fileType === 'markdown' && c.tab.viewMode !== 'source',
    component: MarkdownEditorWrapper,
    adapter: defaultAdapter,
    priority: 10,
  },
  {
    id: 'markdown-source-codemirror',
    match: (c) => c.fileType === 'markdown' && c.tab.viewMode === 'source',
    component: CodeEditorWrapper,
    adapter: sourceModeAdapter,
    priority: 10,
  },
  {
    id: 'code-codemirror',
    match: (c) => c.fileType === 'code',
    component: CodeEditorWrapper,
    adapter: defaultAdapter,
    priority: 10,
  },
  {
    id: 'mindmap-shim',
    match: (c) => {
      if (c.fileType !== 'mindmap') return false
      // 插件编辑器存在时,shim 不匹配(留给插件编辑器)
      const ext = '.' + (c.tab.name.split('.').pop() || '').toLowerCase()
      return !c.pluginExtensions.has(ext)
    },
    component: MindMapEditorWrapper,
    adapter: defaultAdapter,
    priority: 1, // shim 优先级最低
  },
  {
    id: 'image-preview',
    match: (c) => c.fileType === 'image',
    component: ImagePreviewEditor,
    adapter: defaultAdapter,
    priority: 10,
  },
]

let registered = false

export function registerBuiltinEditors(): void {
  if (registered) return
  for (const desc of descriptors) {
    builtinEditorRegistry.register(desc)
  }
  registered = true
}

export const builtinEditorRegistry: EditorRegistry = createEditorRegistry()

// ---- 插件编辑器桥接:把活跃插件编辑器同步注册到统一 registry ----
// pluginEditor.ts 仍是权限/冲突检测的 source of truth,统一 registry 只负责渲染路由

const PLUGIN_DESCRIPTOR_PREFIX = 'plugin:'

/**
 * 把当前活跃的插件编辑器同步注册到统一 registry。
 * 先清除上一次注册的插件 descriptor,再按 pluginEditorRegistry 快照重新注册。
 * 插件 descriptor priority=100,高于内置(10)和 shim(1),resolve 时优先命中。
 */
export function syncPluginEditors(): void {
  for (const desc of builtinEditorRegistry.listDescriptors()) {
    if (desc.id.startsWith(PLUGIN_DESCRIPTOR_PREFIX)) {
      builtinEditorRegistry.unregister(desc.id)
    }
  }
  for (const ext of pluginEditorRegistry.getActivePluginExtensions()) {
    const entry = pluginEditorRegistry.getEditorForExtension(ext)
    if (!entry) continue
    const matchedExt = ext
    const PluginComp = entry.component
    builtinEditorRegistry.register({
      id: `${PLUGIN_DESCRIPTOR_PREFIX}${entry.pluginId}:${matchedExt}`,
      match: (c) => {
        if (c.tab.type === 'diff' || c.tab.type === 'conflict') return false
        const tabExt = '.' + (c.tab.name.split('.').pop() || '').toLowerCase()
        return tabExt === matchedExt
      },
      component: ({ tab, onChange }: EditorProps) => (
        <PluginComp content={tab.content} onChange={onChange} />
      ),
      adapter: defaultAdapter,
      priority: 100,
    })
  }
}

/**
 * 订阅插件编辑器变化并同步到统一 registry。
 * 复用 usePluginEditors 的 revision 信号,避免重复订阅 pluginEventBus。
 * sync 在 render 阶段(useMemo)执行,确保本次 render 的 resolve 用到最新插件 descriptor;
 * sync 幂等(清除再重注册),render 中调用安全。
 * 返回 revision 供 EditorView 用作 key 后缀,插件 enable/disable 时强制 remount。
 */
export function usePluginEditorBridge(): { revision: number } {
  const { revision } = usePluginEditors()
  useMemo(() => {
    syncPluginEditors()
  }, [revision])
  return { revision }
}
