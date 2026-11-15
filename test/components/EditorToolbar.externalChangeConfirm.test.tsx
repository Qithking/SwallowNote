/**
 * I3 回归锚点：外部修改警告 chip 点击行为
 *
 * 因果链：脏 tab（isDirty/frontmatterDirty）点击「文件已被外部修改」chip
 * → 原实现直接 loadTabContent(id, 0, true) 强制重载，force 分支 isDirty: false
 * → 未保存修改被磁盘版本覆盖且无任何确认（与 TabBar 刷新对脏 tab 有 confirm 不一致）。
 * 修复后：脏 tab 先 confirm，确认才重载、取消不动；非脏 tab 保持一键重载。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const loadTabContentMock = vi.fn().mockResolvedValue(undefined)

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
  hasExternalChange: true,
  toolbarConfig: {},
}

let mockTabs = [mockBaseTab]
let mockActiveTabId = 'tab1'

vi.mock('@/stores', () => ({
  // 组件订阅用函数式选择器；chip 点击处理器另走 getState() 读实时脏标记
  useEditorStore: Object.assign(
    ((selector: any) => {
      const state = { tabs: mockTabs, activeTabId: mockActiveTabId, toggleViewMode: vi.fn() }
      return selector ? selector(state) : state
    }) as any,
    {
      getState: () => ({ tabs: mockTabs, loadTabContent: loadTabContentMock }),
    }
  ),
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

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

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

describe('EditorToolbar 外部修改 chip（I3：脏 tab 强制重载先确认）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadTabContentMock.mockResolvedValue(undefined)
    mockTabs = [mockBaseTab]
    mockActiveTabId = 'tab1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const clickChip = () => {
    render(<EditorToolbar />)
    fireEvent.click(screen.getByText('editorToolbar.externalChange'))
  }

  it('脏 tab 点击 chip 先 confirm；确认后才强制重载', async () => {
    mockTabs = [{ ...mockBaseTab, isDirty: true }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    clickChip()
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(loadTabContentMock).toHaveBeenCalledWith('tab1', 0, true)
  })

  it('脏 tab 点击 chip：confirm 取消则不重载（本地修改保留）', async () => {
    mockTabs = [{ ...mockBaseTab, isDirty: true }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    clickChip()
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(loadTabContentMock).not.toHaveBeenCalled()
  })

  it('frontmatterDirty 也视为脏，取消后不重载', async () => {
    mockTabs = [{ ...mockBaseTab, frontmatterDirty: true }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    clickChip()
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(loadTabContentMock).not.toHaveBeenCalled()
  })

  it('非脏 tab 点击 chip 保持一键重载（不弹确认）', async () => {
    mockTabs = [{ ...mockBaseTab, isDirty: false }]
    const confirmSpy = vi.spyOn(window, 'confirm')
    clickChip()
    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(loadTabContentMock).toHaveBeenCalledWith('tab1', 0, true))
  })
})
