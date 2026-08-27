/**
 * EditorToolbar 查找/替换集成测试
 * Source: plan/editor-find-replace step 9
 *
 * AC-1: Search 图标在 file/plugin tab 中可见,copyPath 前
 * AC-2: 点击 Search 图标切换 FindReplacePanel 显隐
 * AC-11: 切换 tab 时面板自动关闭
 * AC-14: showFindReplace=false 时隐藏图标
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// --- Mock stores ---
const mockActiveTab = {
  id: 'tab1',
  path: '/test/file.ts',
  name: 'file.ts',
  content: '',
  isDirty: false,
  viewMode: 'preview' as const,
  type: 'file' as const,
  fileSize: 0,
  modifiedTime: 0,
  wordCount: 0,
  cursorPosition: 0,
  hasExternalChange: false,
  toolbarConfig: {},
}

let mockTabs = [mockActiveTab]
let mockActiveTabId = 'tab1'

vi.mock('@/stores', () => ({
  useEditorStore: ((selector: any) => {
    const state = {
      tabs: mockTabs,
      activeTabId: mockActiveTabId,
      toggleViewMode: vi.fn(),
    }
    return selector ? selector(state) : state
  }) as any,
  useUIStore: ((selector: any) => {
    const state = {
      rightPanelType: null,
      setRightPanelType: vi.fn(),
      noteWidth: 'normal',
      setNoteWidth: vi.fn(),
      sidebarView: 'explorer',
      sidebarVisible: true,
      settingsPanelVisible: false,
      workspaceMode: 'single',
    }
    return selector ? selector(state) : state
  }) as any,
  useWorkspaceStore: ((selector: any) => {
    const state = { rootPath: '/test', workspaceFolders: [] }
    return selector ? selector(state) : state
  }) as any,
  useGitStore: ((selector: any) => {
    const state = { conflictFilesMap: {}, conflictRepos: [] }
    return selector ? selector(state) : state
  }) as any,
  usePluginStore: ((selector: any) => {
    const state = { registry: { editorToolbar: [] } }
    return selector ? selector(state) : state
  }) as any,
}))

// --- Mock Tauri invoke ---
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// --- Mock i18n ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'editorToolbar.findReplace.matchCount' && params) {
        return `${params.current}/${params.total}`
      }
      return key
    },
  }),
}))

// --- Mock Tooltip (avoid Radix Provider requirement) ---
vi.mock('@/components', () => ({
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ children }: any) => children,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => children,
}))

// --- Mock plugin utils ---
vi.mock('@/lib/plugin-utils', () => ({
  pluginRightPanelType: vi.fn(),
  renderPluginIcon: vi.fn(),
  pluginSidebarView: vi.fn(),
  createToolbarButtonProps: vi.fn(),
  renderPluginToolbarButton: vi.fn(),
}))

// --- Mock download coordinator ---
vi.mock('@/lib/download-coordinator', () => ({
  downloadCoordinator: {
    isBusy: false,
    onBusyChange: vi.fn(() => vi.fn()),
  },
}))

// --- Mock FindReplacePanel to track props ---
let findReplacePanelProps: any = {}
vi.mock('@/components/FindReplacePanel', () => ({
  FindReplacePanel: (props: any) => {
    findReplacePanelProps = props
    return props.visible ? <div data-testid="find-replace-panel" /> : null
  },
}))

import { EditorToolbar } from '@/components/EditorToolbar'

describe('EditorToolbar find/replace integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findReplacePanelProps = {}
    mockTabs = [mockActiveTab]
    mockActiveTabId = 'tab1'
  })

  afterEach(() => {
    // Clean up any event listeners
    window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
  })

  it('AC-1: 应在工具栏渲染查找图标按钮(Search icon)', () => {
    render(<EditorToolbar />)
    const btn = screen.getByTitle('editorToolbar.findReplace.toggle')
    expect(btn).toBeInTheDocument()
  })

  it('AC-2: 点击查找图标应切换 FindReplacePanel 可见性', () => {
    render(<EditorToolbar />)
    const btn = screen.getByTitle('editorToolbar.findReplace.toggle')
    // 初始不可见
    expect(screen.queryByTestId('find-replace-panel')).not.toBeInTheDocument()
    // 点击后可见
    fireEvent.click(btn)
    expect(screen.getByTestId('find-replace-panel')).toBeInTheDocument()
    // 再次点击收起
    fireEvent.click(btn)
    expect(screen.queryByTestId('find-replace-panel')).not.toBeInTheDocument()
  })

  it('再次点击查找图标关闭面板时应派发 editor:find-replace:clear', () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    render(<EditorToolbar />)
    const btn = screen.getByTitle('editorToolbar.findReplace.toggle')
    fireEvent.click(btn)
    spy.mockClear()
    fireEvent.click(btn)
    const hasClear = spy.mock.calls.some((call) => (call[0] as Event).type === 'editor:find-replace:clear')
    expect(hasClear).toBe(true)
    spy.mockRestore()
  })

  it('AC-14: toolbarConfig.showFindReplace=false 时隐藏查找图标', () => {
    mockTabs = [{ ...mockActiveTab, toolbarConfig: { showFindReplace: false } }]
    render(<EditorToolbar />)
    expect(screen.queryByTitle('editorToolbar.findReplace.toggle')).not.toBeInTheDocument()
  })

  it('AC-11: 切换 tab 时 FindReplacePanel 自动关闭', () => {
    const { rerender } = render(<EditorToolbar />)
    // 打开面板
    fireEvent.click(screen.getByTitle('editorToolbar.findReplace.toggle'))
    expect(screen.getByTestId('find-replace-panel')).toBeInTheDocument()
    // 模拟切换 tab:修改 activeTabId
    mockActiveTabId = 'tab2'
    mockTabs = [
      mockActiveTab,
      { ...mockActiveTab, id: 'tab2', path: '/test/other.md', name: 'other.md' },
    ]
    rerender(<EditorToolbar />)
    // 面板应自动关闭
    expect(screen.queryByTestId('find-replace-panel')).not.toBeInTheDocument()
  })

  it('AC-2 变体: editor:toggle-find-replace 事件应切换面板显隐', () => {
    render(<EditorToolbar />)
    // 初始不可见
    expect(screen.queryByTestId('find-replace-panel')).not.toBeInTheDocument()
    // 派发事件打开
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
    })
    expect(screen.getByTestId('find-replace-panel')).toBeInTheDocument()
    // 再次派发关闭
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
    })
    expect(screen.queryByTestId('find-replace-panel')).not.toBeInTheDocument()
  })

  it('editor:toggle-find-replace 事件关闭面板时应派发 editor:find-replace:clear', () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    render(<EditorToolbar />)
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
    })
    spy.mockClear()
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
    })
    const hasClear = spy.mock.calls.some((call) => (call[0] as Event).type === 'editor:find-replace:clear')
    expect(hasClear).toBe(true)
    spy.mockRestore()
  })

  it('markdown source 视图下应使用 codemirror editorType', () => {
    mockTabs = [{ ...mockActiveTab, path: '/test/file.md', name: 'file.md', viewMode: 'source' as const }]
    render(<EditorToolbar />)
    fireEvent.click(screen.getByTitle('editorToolbar.findReplace.toggle'))
    expect(findReplacePanelProps.visible).toBe(true)
    expect(findReplacePanelProps.editorType).toBe('codemirror')
  })

  it('markdown preview 视图下应显示查找图标并使用 blocknote 模式(查找+替换)', () => {
    mockTabs = [{ ...mockActiveTab, path: '/test/file.md', name: 'file.md', viewMode: 'preview' as const }]
    render(<EditorToolbar />)
    fireEvent.click(screen.getByTitle('editorToolbar.findReplace.toggle'))
    expect(findReplacePanelProps.visible).toBe(true)
    expect(findReplacePanelProps.editorType).toBe('blocknote')
  })

  it('普通代码文件应显示查找图标并使用 codemirror 模式', () => {
    mockTabs = [{ ...mockActiveTab, path: '/test/file.ts', name: 'file.ts', viewMode: 'preview' as const }]
    render(<EditorToolbar />)
    fireEvent.click(screen.getByTitle('editorToolbar.findReplace.toggle'))
    expect(findReplacePanelProps.visible).toBe(true)
    expect(findReplacePanelProps.editorType).toBe('codemirror')
  })

  it('应监听 editor:find-replace:replace-text 事件并同步给 FindReplacePanel', () => {
    render(<EditorToolbar />)
    fireEvent.click(screen.getByTitle('editorToolbar.findReplace.toggle'))
    expect(findReplacePanelProps.initialReplaceText).toBe('')

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', { detail: { text: 'replacement' } }))
    })
    // 模拟组件重渲染后 props 应更新
    expect(findReplacePanelProps.initialReplaceText).toBe('replacement')
  })
})
