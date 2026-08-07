/**
 * EditorToolbar contentLayout（内容排版设置）按钮与面板显隐测试
 *
 * 排版设置（字体/行距/段距）仅对 BlockNote 富文本有意义：
 * - 按钮：只在 markdown preview（BlockNote）模式显示
 * - 面板：切到非 markdown 富文本模式（source 等）时自动关闭
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// --- Mock stores ---
const mockBaseTab = {
  id: 'tab1',
  path: '/test/note.md',
  name: 'note.md',
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

let mockTabs = [mockBaseTab]
let mockActiveTabId = 'tab1'
let mockRightPanelType: string | null = null
const setRightPanelTypeMock = vi.fn()

vi.mock('@/stores', () => ({
  useEditorStore: ((selector: any) => {
    const state = { tabs: mockTabs, activeTabId: mockActiveTabId, toggleViewMode: vi.fn() }
    return selector ? selector(state) : state
  }) as any,
  useUIStore: ((selector: any) => {
    const state = {
      rightPanelType: mockRightPanelType,
      setRightPanelType: setRightPanelTypeMock,
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

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// 透传 Tooltip，避免 Radix Provider 依赖
vi.mock('@/components', () => ({
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ children }: any) => children,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => children,
}))

vi.mock('@/lib/plugin-utils', () => ({
  pluginRightPanelType: vi.fn(),
  renderPluginIcon: vi.fn(),
  pluginSidebarView: vi.fn(),
  createToolbarButtonProps: vi.fn(),
  renderPluginToolbarButton: vi.fn(),
}))

vi.mock('@/lib/download-coordinator', () => ({
  downloadCoordinator: { isBusy: false, onBusyChange: vi.fn(() => vi.fn()) },
}))

import { EditorToolbar } from '@/components/EditorToolbar'

describe('EditorToolbar contentLayout button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTabs = [mockBaseTab]
    mockActiveTabId = 'tab1'
    mockRightPanelType = null
  })

  it('markdown preview (BlockNote) 模式应显示内容排版设置按钮', () => {
    mockTabs = [{ ...mockBaseTab, viewMode: 'preview' as const }]
    render(<EditorToolbar />)
    expect(screen.getByTitle('editorToolbar.contentLayout')).toBeInTheDocument()
  })

  it('markdown source (CodeMirror) 模式应隐藏内容排版设置按钮', () => {
    mockTabs = [{ ...mockBaseTab, viewMode: 'source' as const }]
    render(<EditorToolbar />)
    expect(screen.queryByTitle('editorToolbar.contentLayout')).not.toBeInTheDocument()
  })

  it('切到 source 模式时自动关闭已打开的 editorSettings 面板', () => {
    // 初始 preview 模式且面板已打开
    mockTabs = [{ ...mockBaseTab, viewMode: 'preview' as const }]
    mockRightPanelType = 'editorSettings'
    const { rerender } = render(<EditorToolbar />)
    expect(setRightPanelTypeMock).not.toHaveBeenCalled()

    // 切到 source 模式
    mockTabs = [{ ...mockBaseTab, viewMode: 'source' as const }]
    act(() => {
      rerender(<EditorToolbar />)
    })
    expect(setRightPanelTypeMock).toHaveBeenCalledWith(null)
  })

  it('preview 模式下不误关闭 editorSettings 面板', () => {
    mockTabs = [{ ...mockBaseTab, viewMode: 'preview' as const }]
    mockRightPanelType = 'editorSettings'
    render(<EditorToolbar />)
    expect(setRightPanelTypeMock).not.toHaveBeenCalled()
  })
})
