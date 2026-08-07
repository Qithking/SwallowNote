/**
 * Editor.tsx 集成测试:验证 registry 查表渲染器行为
 * 锁定现有编辑器路由行为,确保迁移到 registry 后行为不变
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { EditorTab } from '@/stores/editor'

// Mock 所有重依赖,避免拉起 BlockNote/CodeMirror
vi.mock('@/stores', () => ({
  useEditorStore: vi.fn(() => ({
    activeTabId: null,
    tabs: [],
    updateTabContent: vi.fn(),
    loadTabContent: vi.fn(),
    setActiveTab: vi.fn(),
  })),
  useUIStore: vi.fn(() => ({
    uploadPath: '',
    showToast: vi.fn(),
  })),
  useWorkspaceStore: vi.fn(() => ({
    rootPath: '',
  })),
}))

vi.mock('@/stores/editor', () => ({
  setEditorContainerEl: vi.fn(),
  setLastScrollTop: vi.fn(),
}))

vi.mock('@/stores/pluginEditor', () => ({
  usePluginEditors: vi.fn(() => ({ extensions: new Set<string>(), revision: 0 })),
  pluginEditorRegistry: {
    getActivePluginExtensions: vi.fn(() => new Set<string>()),
    getEditorForExtension: vi.fn(() => null),
  },
  getEditorForExtension: vi.fn(() => null),
}))

vi.mock('@/lib/tauri', () => ({
  openFolderDialog: vi.fn(),
  openFileDialog: vi.fn(),
  getFolderHistory: vi.fn(),
}))

vi.mock('@/lib/shortcuts', () => ({
  formatShortcutForDisplay: vi.fn(() => ''),
  getShortcutKey: vi.fn(() => ''),
}))

vi.mock('@/lib/utils/fileTypeUtils', () => ({
  detectFileType: vi.fn((name: string) => {
    if (name.endsWith('.md')) return 'markdown'
    if (name.endsWith('.smm')) return 'mindmap'
    if (name.endsWith('.png')) return 'binary'
    return 'code'
  }),
}))

vi.mock('@/lib/utils/frontmatter', () => ({
  serializeFrontmatter: vi.fn((_f, body) => body),
  parseFrontmatter: vi.fn((c) => ({ data: {}, body: c })),
}))

vi.mock('@/lib/scroll-position', () => ({
  restoreScrollTop: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: () => <div data-testid="progress" />,
}))

// Mock 各编辑器组件
const MockMarkdownEditor = vi.fn(() => <div data-testid="markdown-editor" />)
const MockCodeEditor = vi.fn(() => <div data-testid="code-editor" />)
const MockDiffViewer = vi.fn(() => <div data-testid="diff-viewer" />)
const MockConflictResolver = vi.fn(() => <div data-testid="conflict-resolver" />)
const MockMindMapEditor = vi.fn(() => <div data-testid="mindmap-editor" />)

vi.mock('@/components/editors/MarkdownEditor', () => ({
  MarkdownEditor: MockMarkdownEditor,
}))
vi.mock('@/components/editors/CodeEditor', () => ({
  CodeEditor: MockCodeEditor,
}))
vi.mock('@/components/DiffViewer/DiffViewer', () => ({
  default: MockDiffViewer,
}))
vi.mock('@/components/DiffViewer/ConflictResolver', () => ({
  default: MockConflictResolver,
}))
vi.mock('@/components/editors/MindMapEditor', () => ({
  MindMapEditor: MockMindMapEditor,
}))

import { detectFileType } from '@/lib/utils/fileTypeUtils'
import { builtinEditorRegistry, registerBuiltinEditors } from '@/components/editors/builtin-editors'

function makeTab(partial: Partial<EditorTab>): EditorTab {
  return {
    id: 't1',
    path: 'test.md',
    name: 'test.md',
    content: '',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    type: 'file',
    ...partial,
  } as EditorTab
}

describe('Editor registry integration', () => {
  beforeEach(() => {
    registerBuiltinEditors()
    vi.clearAllMocks()
  })

  it('diff tab → resolve 到 DiffViewer', () => {
    const tab = makeTab({ type: 'diff', diffContent: '@@ diff @@' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: detectFileType(tab.name, tab.content) as any,
      pluginExtensions: new Set(),
    })
    expect(desc?.id).toBe('diff-viewer')
  })

  it('markdown + preview → resolve 到 MarkdownEditor(BlockNote)', () => {
    const tab = makeTab({ viewMode: 'preview' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'markdown',
      pluginExtensions: new Set(),
    })
    expect(desc?.id).toBe('markdown-blocknote')
  })

  it('markdown + source → resolve 到 CodeEditor', () => {
    const tab = makeTab({ viewMode: 'source' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'markdown',
      pluginExtensions: new Set(),
    })
    expect(desc?.id).toBe('markdown-source-codemirror')
  })

  it('code file → resolve 到 CodeEditor', () => {
    const tab = makeTab({ name: 'main.js', path: 'main.js' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'code',
      pluginExtensions: new Set(),
    })
    expect(desc?.id).toBe('code-codemirror')
  })

  it('mindmap + 无插件 → resolve 到 MindMapEditor shim', () => {
    const tab = makeTab({ name: 'test.smm', path: 'test.smm' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'mindmap',
      pluginExtensions: new Set(),
    })
    expect(desc?.id).toBe('mindmap-shim')
  })

  it('mindmap + 有插件 → 不 resolve 到 shim', () => {
    const tab = makeTab({ name: 'test.smm', path: 'test.smm' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'mindmap',
      pluginExtensions: new Set(['.smm']),
    })
    expect(desc?.id).not.toBe('mindmap-shim')
  })

  it('binary → resolve 返回 null', () => {
    const tab = makeTab({ name: 'test.png', path: 'test.png' })
    const desc = builtinEditorRegistry.resolve({
      tab,
      fileType: 'binary',
      pluginExtensions: new Set(),
    })
    expect(desc).toBeNull()
  })
})
