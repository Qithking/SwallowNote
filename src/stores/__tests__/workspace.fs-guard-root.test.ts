/**
 * fs_guard 白名单根回归测试（dev-fix: fs-guard-root-null）
 *
 * 根因：fs_guard 收编给 list_directory 等命令接闸后，前端注入的 workspaceRoot()
 * 在「打开工作区流程」中恒为 null（folder 模式 rootPath 尚未设置；workspace 模式
 * rootPath 永远为 null），导致打开流程的目录列举被后端 ensure_path_allowed 误拒。
 *
 * 断言契约：list_directory / list_directories_batch 收到的 workspaceRoot 必须
 *  - 打开流程（loadRoot/addRoot/addRoots）：目标目录自身（授权型语义）
 *  - 树内操作（toggleNode）：目标路径所属的工作区根
 *  - 批量（revealPath/refreshExpanded/restoreTreeState）：全部路径共同所属的 folder，
 *    跨 folder 时由调用方 sequential fallback 逐个按各自所属 folder 选根
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke as invokeMock } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileTreeStore } from '@/stores/filetree'

// ui store 用轻量 mock（提供 workspaceMode/showAllFiles/markdownOnly，测试可切换）
const uiState = {
  workspaceMode: 'folder' as 'folder' | 'workspace',
  showAllFiles: false,
  markdownOnly: false,
  setWorkspaceMode: vi.fn((mode: 'folder' | 'workspace') => {
    uiState.workspaceMode = mode
  }),
  initWorkspaceMode: vi.fn(),
}
vi.mock('@/stores/ui', () => ({
  useUIStore: {
    getState: () => uiState,
    setState: (patch: Partial<typeof uiState>) => Object.assign(uiState, patch),
    subscribe: vi.fn(),
  },
}))

vi.mock('@/stores/editor', () => ({
  useEditorStore: {
    getState: () => ({
      filterTabs: vi.fn(),
      tabs: [],
      activeTabId: null,
    }),
  },
}))

vi.mock('@/stores/git', () => ({
  useGitStore: {
    getState: () => ({
      scanAndCacheRepos: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/utils/searchQuery', () => ({
  triggerFrontmatterScan: vi.fn().mockResolvedValue(undefined),
}))

const WS_PATH = '/data/ws/code.swallow-workspace'
const FOLDERS = ['/data/ws/impl', '/data/other/proj']

// list_directory / list_directories_batch 的参数捕获
let listDirCalls: Record<string, unknown>[]

beforeEach(() => {
  listDirCalls = []
  vi.clearAllMocks()
  vi.mocked(invokeMock).mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>
    switch (cmd) {
      case 'read_file':
        if (a.path === WS_PATH) {
          return JSON.stringify({ version: 1, folders: FOLDERS })
        }
        return ''
      case 'list_directory':
      case 'list_directories_batch':
        listDirCalls.push(a)
        return []
      case 'get_folder_history':
        return [WS_PATH]
      case 'path_exists':
        return true
      default:
        return undefined
    }
  })
})

describe('打开工作区流程的 fs_guard 允许根注入', () => {
  it('workspace 启动恢复：addRoots 列举各 folder 时允许根为 folder 自身而非 null', async () => {
    uiState.workspaceMode = 'workspace'
    useWorkspaceStore.setState({ sessionContextPath: WS_PATH, workspaceFolders: [], currentWorkspacePath: null, rootPath: null })

    await useWorkspaceStore.getState().loadLatestByMode()

    // 加载应成功（当前实现被白名单误拒 → currentWorkspacePath 为 null）
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe(WS_PATH)
    expect(listDirCalls.length).toBe(FOLDERS.length)
    for (const call of listDirCalls) {
      expect(call.workspaceRoot).toBe(call.path)
    }
  })

  it('openFolder（folder 启动恢复/最近记录打开）加载根时允许根为目标目录自身而非 null', async () => {
    uiState.workspaceMode = 'folder'
    useWorkspaceStore.setState({ sessionContextPath: '/data/folder', rootPath: null, workspaceFolders: [], currentWorkspacePath: null })

    await useWorkspaceStore.getState().openFolder('/data/folder')

    // 加载应成功（当前实现被白名单误拒 → rootPath 为 null）
    expect(useWorkspaceStore.getState().rootPath).toBe('/data/folder')
    expect(listDirCalls.length).toBe(1)
    expect(listDirCalls[0]).toMatchObject({ path: '/data/folder', workspaceRoot: '/data/folder' })
  })

  it('workspace 模式树内展开子目录时允许根为目标所属 folder 而非 null', async () => {
    uiState.workspaceMode = 'workspace'
    useWorkspaceStore.setState({ rootPath: null, workspaceFolders: ['/data/a', '/data/b'], currentWorkspacePath: null })
    useFileTreeStore.setState({
      nodes: [{ id: '1', name: 'sub', path: '/data/a/sub', isDirectory: true }],
      expanded: new Set(),
      selectedPath: null,
    })

    await useFileTreeStore.getState().toggleNode('/data/a/sub')

    expect(listDirCalls.length).toBe(1)
    expect(listDirCalls[0]).toMatchObject({ path: '/data/a/sub', workspaceRoot: '/data/a' })
  })

  it('revealPath 批量加载同属一个 folder 的目录链时允许根为该 folder', async () => {
    uiState.workspaceMode = 'workspace'
    useWorkspaceStore.setState({ rootPath: null, workspaceFolders: ['/data/a', '/data/b'], currentWorkspacePath: null })
    useFileTreeStore.setState({ nodes: [], expanded: new Set(), selectedPath: null })

    await useFileTreeStore.getState().revealPath('/data/a/deep/file.md', '/data/a')

    // 沿途目录（root + 中间层）批量加载，允许根应为目标所属 folder 而非 null
    expect(listDirCalls.length).toBe(1)
    const call = listDirCalls[0]
    expect(call.workspaceRoot).toBe('/data/a')
    const paths = call.paths as string[]
    expect(paths).toContain('/data/a')
  })
})
