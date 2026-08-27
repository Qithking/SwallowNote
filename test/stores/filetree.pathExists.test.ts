/**
 * E-M12: filetree.ts pathExists 失败后不应继续 reveal
 *
 * 行为契约: 当 pathExists 抛错时，revealPath 必须立即返回，
 * 不应继续执行目录加载（loadDirectoriesBatch），否则下游会报
 * 更困惑的错误。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFileTreeStore } from '@/stores/filetree'

const { loadDirectoryMock, loadDirectoriesBatchMock } = vi.hoisted(() => ({
  loadDirectoryMock: vi.fn().mockResolvedValue([]),
  loadDirectoriesBatchMock: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/api', () => ({
  loadDirectory: loadDirectoryMock,
  loadDirectoriesBatch: loadDirectoriesBatchMock,
}))

vi.mock('@/lib/tauri', () => ({
  pathExists: vi.fn(),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: {
    getState: () => ({ showAllFiles: false, markdownOnly: false }),
  },
}))

describe('E-M12: pathExists failure must abort revealPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.setState({
      nodes: [],
      expanded: new Set(),
      selectedPath: null,
      multiSelectedPaths: new Set(),
      lastClickedPath: null,
      isLoading: false,
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('does not call loadDirectoriesBatch when pathExists throws', async () => {
    const { pathExists } = await import('@/lib/tauri')
    vi.mocked(pathExists).mockRejectedValueOnce(new Error('boom'))

    await useFileTreeStore.getState().revealPath('/root/note.md', '/root')
    // flush microtasks (queueMicrotask / rAF)
    await new Promise((r) => setTimeout(r, 0))

    // pathExists 失败后不应继续 reveal，所以不应加载目录
    expect(loadDirectoriesBatchMock).not.toHaveBeenCalled()
    // selectedPath 也不应被设置
    expect(useFileTreeStore.getState().selectedPath).not.toBe('/root/note.md')
  })
})
