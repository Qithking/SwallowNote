/**
 * 回归测试：从最近记录点击打开文件夹/工作区「加载错误及慢」
 * - 根因 A：switchMode 先 loadLatestByMode 预加载非目标路径（sessionContextPath/history 首条），
 *   再加载用户点击目标 → 双重串行加载 + 失效路径重试放大（慢）
 * - 根因 C：loadWorkspaceFile 读 .swallow-workspace 时 workspaceRoot 缺失（rootPath 仅 folder
 *   模式设置），Rust ensure_path_allowed 只允许 app_data → 工作区文件被误拒（加载错误）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from '@/lib/tauri'

const { uiMock, fileTreeMock, editorMock } = vi.hoisted(() => {
  const state = {
    workspaceMode: 'workspace',
    setWorkspaceMode: vi.fn((mode: string) => {
      state.workspaceMode = mode
    }),
    initWorkspaceMode: vi.fn(),
  }
  return {
    uiMock: state,
    fileTreeMock: {
      loadRoot: vi.fn().mockResolvedValue(true),
      addRoots: vi.fn().mockResolvedValue(true),
      clearAll: vi.fn(),
      clearExpanded: vi.fn(),
      collapseAllExceptPath: vi.fn(),
    },
    editorMock: {
      filterTabs: vi.fn(),
      activeTabId: null as string | null,
      tabs: [] as unknown[],
    },
  }
})

vi.mock('@/lib/tauri', () => ({
  readFile: vi.fn(),
  saveFolderHistory: vi.fn().mockResolvedValue(undefined),
  watchDirectory: vi.fn().mockRejectedValue(new Error('noop')),
  getFolderHistory: vi.fn().mockResolvedValue([]),
  getLatestFolder: vi.fn().mockResolvedValue(null),
  unwatchDirectory: vi.fn(),
  getSessionState: vi.fn().mockResolvedValue(null),
  registerAssetScope: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/utils/searchQuery', () => ({
  triggerFrontmatterScan: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: { getState: () => uiMock },
}))

vi.mock('@/stores/filetree', () => ({
  useFileTreeStore: { getState: () => fileTreeMock },
}))

vi.mock('@/stores/editor', () => ({
  useEditorStore: { getState: () => editorMock },
}))

vi.mock('@/stores/git', () => ({
  useGitStore: { getState: () => ({ scanAndCacheRepos: vi.fn() }) },
}))

import { useWorkspaceStore } from '@/stores/workspace'
import type { Mock } from 'vitest'

describe('workspace 从最近记录打开（根因 A + C 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uiMock.workspaceMode = 'workspace'
    fileTreeMock.loadRoot.mockResolvedValue(true)
    fileTreeMock.addRoots.mockResolvedValue(true)
  })

  it('loadWorkspaceFile 读取 .swallow-workspace 时传入文件所在目录作为允许根（根因 C）', async () => {
    ;(readFile as Mock).mockResolvedValue(JSON.stringify({ version: 1, folders: ['/data/ws'] }))

    await useWorkspaceStore.getState().loadWorkspaceFile('/data/ws/.swallow-workspace')

    expect(readFile).toHaveBeenCalledWith('/data/ws/.swallow-workspace', '/data/ws')
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/data/ws/.swallow-workspace')
  })

  it('switchMode 传入目标路径时直接加载目标，不预加载 sessionContextPath/history（根因 A）', async () => {
    const openFolderSpy = vi.spyOn(useWorkspaceStore.getState(), 'openFolder')
    const loadLatestSpy = vi.spyOn(useWorkspaceStore.getState(), 'loadLatestByMode')

    await useWorkspaceStore.getState().switchMode('folder', '/tmp/target')

    expect(loadLatestSpy).not.toHaveBeenCalled()
    expect(openFolderSpy).toHaveBeenCalledWith('/tmp/target')
    expect(useWorkspaceStore.getState().rootPath).toBe('/tmp/target')
  })
})
