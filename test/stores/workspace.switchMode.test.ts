/**
 * workspace 挂起问题定案（审计 I15 伴生）：switchMode 对称清理 + 路径 normalize。
 *
 * 根因 A：switchMode 只加载新模式状态、从不清理对侧字段——
 *   folder→workspace 后 rootPath 残留旧目录，workspaceRootFor 首选 rootPath，
 *   导致 workspace 内所有文件解析到旧 folder 根，fs_guard fail-closed 拒绝
 *   （审计日志 [bug-ws-expand-null]）。
 * 根因 B：入口路径形态不归一（尾斜杠 / ~ 前缀），前缀匹配 `startsWith(f + '/')` 失败。
 * 行为契约:
 * - switchMode('workspace') 后 rootPath 必须为 null，且 workspaceRootFor 按 folders 解析
 * - switchMode('folder') 后 workspaceFolders / currentWorkspacePath 必须清空
 * - openFolder / loadWorkspaceFile 入口 normalize：展开 ~、去尾斜杠
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tauri', () => ({
  getLatestFolder: vi.fn().mockResolvedValue(null),
  saveFolderHistory: vi.fn().mockResolvedValue(undefined),
  getFolderHistory: vi.fn().mockResolvedValue([]),
  watchDirectory: vi.fn().mockResolvedValue(undefined),
  unwatchDirectory: vi.fn().mockResolvedValue(undefined),
  getSessionState: vi.fn().mockResolvedValue({}),
  registerAssetScope: vi.fn().mockResolvedValue(undefined),
  getHomeDir: vi.fn().mockResolvedValue('/Users/t'),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  saveWorkspaceFileDialog: vi.fn().mockResolvedValue(null),
  pathExists: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn().mockResolvedValue([]),
  loadDirectoriesBatch: vi.fn().mockResolvedValue([]),
  loadFileContent: vi.fn().mockResolvedValue(''),
}))

// searchQuery 的 triggerFrontmatterScan 等兜底
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'
// 直接走子模块绕过 barrel mock，测真实允许根解析
import { workspaceRootFor } from '@/lib/tauri/file-ops'
import { readFile, getHomeDir } from '@/lib/tauri'
import { loadDirectory } from '@/lib/api'

describe('workspace switchMode 对称清理 + 路径 normalize（定案）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ workspaceMode: 'folder' })
    useWorkspaceStore.setState({
      rootPath: null,
      workspaceFolders: [],
      currentWorkspacePath: null,
      sessionContextPath: null,
      isLoading: false,
      error: null,
    })
  })

  it('folder→workspace 后 rootPath 清空，workspaceRootFor 按 folders 解析', async () => {
    useUIStore.setState({ workspaceMode: 'folder' })
    useWorkspaceStore.setState({ rootPath: '/old/notes' })
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ version: 1, folders: ['/wks/alpha'] })
    )

    await useWorkspaceStore.getState().switchMode('workspace', '/wks/a.swallow-workspace')

    // 残留 rootPath 会污染 workspaceRootFor（fail-closed 拒绝的根因 A）
    expect(useWorkspaceStore.getState().rootPath).toBeNull()
    expect(useWorkspaceStore.getState().workspaceFolders).toEqual(['/wks/alpha'])
    expect(workspaceRootFor('/wks/alpha/note.md')).toBe('/wks/alpha')
  })

  it('workspace→folder 后 workspaceFolders / currentWorkspacePath 清空', async () => {
    useUIStore.setState({ workspaceMode: 'workspace' })
    useWorkspaceStore.setState({
      workspaceFolders: ['/wks/alpha'],
      currentWorkspacePath: '/wks/a.swallow-workspace',
      rootPath: null,
    })
    vi.mocked(loadDirectory).mockResolvedValue([
      { id: 'r', name: 'notes', path: '/old/notes', isDirectory: true, children: [] },
    ])

    await useWorkspaceStore.getState().switchMode('folder', '/old/notes')

    expect(useWorkspaceStore.getState().workspaceFolders).toEqual([])
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBeNull()
    expect(useWorkspaceStore.getState().rootPath).toBe('/old/notes')
  })

  it('openFolder 入口 normalize：展开 ~ 并去尾斜杠', async () => {
    vi.mocked(getHomeDir).mockResolvedValue('/Users/t')

    await useWorkspaceStore.getState().openFolder('~/notes/')

    expect(useWorkspaceStore.getState().rootPath).toBe('/Users/t/notes')
  })

  it('loadWorkspaceFile 入口 normalize：folders 去尾斜杠', async () => {
    useUIStore.setState({ workspaceMode: 'workspace' })
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ version: 1, folders: ['/wks/alpha/'] })
    )

    await useWorkspaceStore.getState().loadWorkspaceFile('/wks/a.swallow-workspace')

    // 尾斜杠残留会使 workspaceRootFor 的 startsWith(f + '/') 匹配失败（根因 B）
    expect(useWorkspaceStore.getState().workspaceFolders).toEqual(['/wks/alpha'])
    expect(workspaceRootFor('/wks/alpha/note.md')).toBe('/wks/alpha')
  })
})
