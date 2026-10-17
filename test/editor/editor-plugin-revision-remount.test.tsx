/**
 * Editor.tsx 集成测试:插件编辑器注册(revision bump)不应重建无关编辑器的 DOM
 *
 * 复现 bug:"应用重启恢复tab时会先定位到上一次位置，然后马上置顶显示"
 *
 * 因果链:启动后插件异步加载 → mindmap onLoad → registerEditor →
 * editor:registered → usePluginEditors revision +1 → Editor.tsx 的
 * editorKey 含全局 revision → 所有已打开编辑器 remount → scrollTop 归零,
 * 且恢复守卫(每 tab 仅恢复一次)阻止再次恢复 → 停在顶部。
 *
 * 本测试用可变 mockRevision 模拟 editor:registered 触发的 revision bump,
 * 断言 revision 变化后编辑器 DOM 节点不重建、已恢复的 scrollTop 保持。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { EditorTab } from '@/stores/editor'

// 可变 revision,模拟 usePluginEditors 订阅 editor:registered 后的 bump
let mockRevision = 0

vi.mock('@/stores/pluginEditor', () => ({
  usePluginEditors: vi.fn(() => ({ extensions: new Set<string>(), revision: mockRevision })),
  pluginEditorRegistry: {
    getActivePluginExtensions: vi.fn(() => new Set<string>()),
    getEditorForExtension: vi.fn(() => null),
  },
}))

// Mock 编辑器组件:渲染带布局 stub 的 Radix viewport(jsdom 无布局,需手动定义
// scrollHeight/clientHeight/scrollTop 才能模拟可滚动与滚动位置)
const stubLayout = (el: HTMLDivElement | null) => {
  if (!el) return
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => { top = v },
    configurable: true,
  })
}
const MockMarkdownEditor = vi.fn(() => (
  <div ref={stubLayout} data-testid="md-viewport" data-radix-scroll-area-viewport>
    <div style={{ height: 2000 }} />
  </div>
))

vi.mock('@/components/editors/MarkdownEditor', () => ({
  MarkdownEditor: MockMarkdownEditor,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: () => null,
}))

vi.mock('@/lib/tauri', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  openFolderDialog: vi.fn().mockResolvedValue(null),
  openFileDialog: vi.fn().mockResolvedValue(null),
  getFolderHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn(),
}))

vi.mock('@/lib/shortcuts', () => ({
  formatShortcutForDisplay: vi.fn(() => ''),
  getShortcutKey: vi.fn(() => ''),
}))

vi.mock('@/lib/utils/fileTypeUtils', () => ({
  detectFileType: vi.fn((name: string) => {
    if (name.endsWith('.md')) return 'markdown'
    return 'code'
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}))

// '@/stores' 用真实 editor store + stub UI/workspace(Editor.tsx 从 barrel 导入)
vi.mock('@/stores', async () => {
  const editorStore = await import('@/stores/editor')
  const uiState = {
    customShortcuts: {},
    workspaceMode: 'single',
    rightPanelType: null,
    setRightPanelType: vi.fn(),
  }
  const wsState = {
    rootPath: '/tmp',
    workspaceFolders: [],
    loadWorkspaceFile: vi.fn(),
    openFolder: vi.fn(),
    switchMode: vi.fn(),
  }
  const useUIStore: any = (selector?: any) => (selector ? selector(uiState) : uiState)
  const useWorkspaceStore: any = (selector?: any) => (selector ? selector(wsState) : wsState)
  useUIStore.getState = () => uiState
  useWorkspaceStore.getState = () => wsState
  return { ...editorStore, useUIStore, useWorkspaceStore }
})

import { EditorView } from '@/components/Editor'
import { useEditorStore } from '@/stores/editor'

function makeTab(): EditorTab {
  return {
    id: 't1',
    path: '/tmp/note.md',
    name: 'note.md',
    content: '# hello',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    type: 'file',
    scrollTop: 500,
  }
}

describe('插件 revision bump 不应重建无关编辑器(滚动位置保持)', () => {
  beforeEach(() => {
    mockRevision = 0
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
  })

  afterEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('editor:registered 触发 revision bump 后,编辑器 DOM 不重建且 scrollTop 保持', async () => {
    const { rerender } = render(<EditorView />)

    // 等待懒加载的 mock 编辑器 mount + restoreScrollTop 把位置恢复到 500
    const viewport = await screen.findByTestId('md-viewport')
    await waitFor(() => expect(viewport.scrollTop).toBe(500))

    // 模拟启动时插件 onLoad → registerEditor → editor:registered → revision bump
    act(() => {
      mockRevision = 1
      rerender(<EditorView />)
    })

    // 修复前:editorKey 含 revision → remount → 新 viewport scrollTop=0
    expect(screen.getByTestId('md-viewport')).toBe(viewport)
    expect(viewport.scrollTop).toBe(500)
  })
})
