/**
 * Bug 复现测试：重启后恢复 tab 概率性全部消失。
 *
 * 根因：目录上下文（workspaceMode + workspacePath/rootPath）未随会话持久化，
 * 启动时用 folder_history 最新一条推断模式（initWorkspaceMode → getLatestFolder）。
 * 用户在 workspace 模式日常使用中，一旦打开过普通文件夹，history 顶部被污染
 * → 下次启动模式误判为 folder → 恢复过滤（tab.path.startsWith(rootPath)）
 * 全部不匹配 → 所有 tab 静默丢弃（validTabs.length === 0 无任何日志）。
 *
 * 修复方向（用户已确认）：持久化目录上下文，启动时优先还原上次会话的
 * workspaceMode 与 workspacePath/rootPath，folder_history 仅作兼容回退。
 *
 * 复现链：savedSessionState 中 tabs 属于 /ws/Workdoc，但 folder_history
 * 顶部是普通文件夹 /plain/SwallowNote（模拟污染）→ 修复前恢复全灭。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorStore, type EditorTab } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/filetree'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'

// 捕获保存的会话状态，喂回 getSessionState 形成闭环
let savedSessionState: Record<string, string> = {}

vi.mock('@/lib/tauri', () => ({
  saveSessionState: vi.fn(async (states: Record<string, string>) => {
    savedSessionState = { ...states }
  }),
  getSessionState: vi.fn(async () => savedSessionState),
  loadFileContent: vi.fn().mockResolvedValue('hello world'),
  getFileMetadata: vi.fn().mockResolvedValue({ modified_time: '', size: 0 }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  pathExists: vi.fn().mockResolvedValue(true),
  getLatestFolder: vi.fn().mockResolvedValue('/plain/SwallowNote'),
  getFolderHistory: vi.fn().mockResolvedValue(['/plain/SwallowNote']),
  saveFolderHistory: vi.fn().mockResolvedValue(undefined),
  watchDirectory: vi.fn().mockResolvedValue(undefined),
  unwatchDirectory: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{"folders":["/ws/Workdoc"]}'),
  getConflictRepoRecords: vi.fn().mockResolvedValue([]),
  gitGetConflictFiles: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn(async (path: string) => [
    { path: `${path}/a.md`, name: 'a.md', type: 'file', isDirectory: false },
  ]),
  loadDirectoriesBatch: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/utils/searchQuery', () => ({
  triggerFrontmatterScan: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    isFullscreen: vi.fn().mockResolvedValue(false),
    innerSize: vi.fn().mockResolvedValue({ width: 1000, height: 700 }),
    scaleFactor: vi.fn().mockResolvedValue(1),
    outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  }),
  availableMonitors: vi.fn().mockResolvedValue([]),
}))

import { useSessionPersistence } from '@/hooks/useSessionPersistence'
import { saveSessionState, getLatestFolder, getFolderHistory, readFile } from '@/lib/tauri'

const mockedSaveSessionState = vi.mocked(saveSessionState)
const mockedGetLatestFolder = vi.mocked(getLatestFolder)
const mockedGetFolderHistory = vi.mocked(getFolderHistory)
const mockedReadFile = vi.mocked(readFile)

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    path: '/tmp/note.md',
    name: 'note.md',
    content: 'hello world',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    ...overrides,
  }
}

/** 复位所有 store 至干净状态（模拟应用刚启动） */
function resetStores() {
  useEditorStore.getState().tabs = []
  useEditorStore.setState({ activeTabId: null })
  useFileTreeStore.getState().clearAll()
  useWorkspaceStore.setState({ rootPath: null, workspaceFolders: [], currentWorkspacePath: null })
  useUIStore.setState({ workspaceMode: 'folder' })
}

describe('会话目录上下文持久化与恢复（tab 概率性全灭 bug）', () => {
  beforeEach(() => {
    savedSessionState = {}
    vi.clearAllMocks()
    // clearAllMocks 后重新 seed mock 实现
    mockedSaveSessionState.mockImplementation(async (states: Record<string, string>) => {
      savedSessionState = { ...states }
    })
    resetStores()
  })

  it('folder history 被污染时，仍按持久化目录上下文恢复 workspace 模式与 tabs', async () => {
    // 1. 模拟上次会话保存的数据：tabs 属于 workspace 目录 /ws/Workdoc，
    //    并持久化了目录上下文（mode=workspace, path=workspace 文件）
    savedSessionState = {
      sessionDirContext: JSON.stringify({ mode: 'workspace', path: '/ws/x.swallow-workspace' }),
      tabs: JSON.stringify([
        { id: 'tab-1', path: '/ws/Workdoc/a.md', name: 'a.md', viewMode: 'preview' },
      ]),
      activeTabId: 'tab-1',
    }

    // 2. folder_history 被普通文件夹污染（顶层是 /plain/SwallowNote）
    mockedGetLatestFolder.mockResolvedValue('/plain/SwallowNote')

    // 3. 跑启动恢复链：initMode → loadLatestByMode → restoreSessionState
    await act(async () => {
      await useWorkspaceStore.getState().initMode()
      await useWorkspaceStore.getState().loadLatestByMode()
    })

    // 启动目录上下文应还原为 workspace 模式 + 上次会话的 workspace 文件
    expect(useUIStore.getState().workspaceMode).toBe('workspace')
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/ws/x.swallow-workspace')

    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.restoreSessionState()
    })
    // loadTabContent 有 100ms 延迟，等待其入队执行
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })

    // 4. tabs 应完整恢复（修复前：模式误判为 folder → 过滤全灭）
    const tabs = useEditorStore.getState().tabs
    expect(tabs.length).toBe(1)
    expect(tabs[0].path).toBe('/ws/Workdoc/a.md')
  })

  it('workspace 模式下保存会话时持久化目录上下文', async () => {
    // 1. 进入 workspace 模式（模式由 initMode/用户切换设置，loadWorkspaceFile 仅加载目录）
    useUIStore.getState().setWorkspaceMode('workspace')
    await act(async () => {
      await useWorkspaceStore.getState().loadWorkspaceFile('/ws/x.swallow-workspace')
    })

    // 2. 打开一个属于 workspace 的 tab
    useEditorStore.getState().addTab(makeTab({ id: 'tab-1', path: '/ws/Workdoc/a.md', name: 'a.md' }))

    // 3. 保存会话
    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.saveSessionStateNow()
    })

    // 4. 目录上下文应被精确持久化（mode 与 path 配对）
    expect(savedSessionState.sessionDirContext).toBe(
      JSON.stringify({ mode: 'workspace', path: '/ws/x.swallow-workspace' }),
    )
  })

  it('folder 模式下保存会话时持久化目录上下文', async () => {
    useUIStore.getState().setWorkspaceMode('folder')
    useWorkspaceStore.getState().setRootPath('/plain/folder')
    useEditorStore.getState().addTab(makeTab({ id: 'tab-1', path: '/plain/folder/a.md', name: 'a.md' }))

    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.saveSessionStateNow()
    })

    expect(savedSessionState.sessionDirContext).toBe(
      JSON.stringify({ mode: 'folder', path: '/plain/folder' }),
    )
  })

  it('无持久化上下文时（旧数据）回退 folder_history 推断，行为不回归', async () => {
    // 旧版本数据：没有 sessionDirContext；folder_history 未被污染，
    // 最新一条是 workspace 文件（回退场景的本质）
    savedSessionState = {
      tabs: JSON.stringify([
        { id: 'tab-1', path: '/ws/Workdoc/a.md', name: 'a.md', viewMode: 'preview' },
      ]),
      activeTabId: 'tab-1',
    }
    mockedGetLatestFolder.mockResolvedValue('/ws/x.swallow-workspace')
    mockedGetFolderHistory.mockResolvedValue(['/ws/x.swallow-workspace', '/plain/SwallowNote'])

    await act(async () => {
      await useWorkspaceStore.getState().initMode()
      await useWorkspaceStore.getState().loadLatestByMode()
    })

    // 回退路径：history 最新一条是 workspace 文件 → workspace 模式正常加载
    expect(useUIStore.getState().workspaceMode).toBe('workspace')
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/ws/x.swallow-workspace')
  })

  it('持久化的 workspace 文件已被删除时，降级回 history 推断', async () => {
    // session 上下文指向的 workspace 文件已不存在，history 中另有有效的 workspace 文件
    savedSessionState = {
      sessionDirContext: JSON.stringify({ mode: 'workspace', path: '/ws/gone.swallow-workspace' }),
      tabs: JSON.stringify([
        { id: 'tab-1', path: '/ws/Workdoc/a.md', name: 'a.md', viewMode: 'preview' },
      ]),
      activeTabId: 'tab-1',
    }
    mockedGetFolderHistory.mockResolvedValue(['/ws/gone.swallow-workspace', '/ws/ok.swallow-workspace', '/plain/SwallowNote'])
    // 第一次读已删除文件抛错，之后读有效文件成功
    mockedReadFile.mockRejectedValueOnce(new Error('file not found'))
    mockedReadFile.mockResolvedValue('{"folders":["/ws/Workdoc"]}')

    await act(async () => {
      await useWorkspaceStore.getState().initMode()
      await useWorkspaceStore.getState().loadLatestByMode()
    })

    // 降级后应成功加载 history 中的有效 workspace 文件
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/ws/ok.swallow-workspace')
  })
})
