/**
 * S-01 + S-02 前端回归测试：git 同步/冲突场景的编辑器 tab 保护。
 *
 * S-01：pull(--rebase) 改写磁盘后，已打开的普通 tab 若保持旧内容，
 * 保存会覆盖远端新提交。修复：同步后强制重载非 dirty tab。
 * S-02：冲突文件（工作树含 <<<<<<< 标记）不得加载进普通编辑器 tab，
 * 只能通过冲突面板处理。修复：打开冲突文件时改走冲突面板。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    getFileMetadata: vi.fn(async () => ({ modified_time: '2020-01-01 00:00:00', file_size: 1 })),
    gitGetConflictFiles: vi.fn(async () => []),
  }
})
vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn(async () => '# 磁盘最新内容\n\n同步后版本'),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

import { useEditorStore } from '@/stores/editor'
import { useGitStore } from '@/stores/git'
import { refreshOpenTabsAfterSync } from '@/lib/git/refreshOpenTabs'
import { openFileWithConflictGuard } from '@/lib/git/conflictOpen'

const REPO = '/wks/repo'

function setEditorTabs(tabs: Parameters<typeof useEditorStore.setState>[0]['tabs']) {
  useEditorStore.setState({ tabs, activeTabId: tabs[0]?.id ?? null } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.setState({
    repositories: [],
    cachedRepositories: [],
    conflictRepos: [],
    conflictFilesMap: {},
  } as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('refreshOpenTabsAfterSync（S-01）', () => {
  it('pull 成功的仓库：已打开非 dirty 普通 tab 强制重载为磁盘最新内容', async () => {
    const loadTabContentSpy = vi
      .spyOn(useEditorStore.getState(), 'loadTabContent')
      .mockResolvedValue(undefined)
    setEditorTabs([{
      id: 't1',
      path: `${REPO}/a.md`,
      name: 'a.md',
      content: '# 旧内容',
      isDirty: false,
      isEdited: false,
      viewMode: 'source',
    } as never])

    await refreshOpenTabsAfterSync([REPO])

    expect(loadTabContentSpy).toHaveBeenCalledWith('t1', 0, true)
  })

  it('pull 成功的仓库：dirty tab 不强制重载（保留用户未保存编辑），标记外部变更', async () => {
    const loadTabContentSpy = vi
      .spyOn(useEditorStore.getState(), 'loadTabContent')
      .mockResolvedValue(undefined)
    const markExternalChangeSpy = vi
      .spyOn(useEditorStore.getState(), 'markExternalChange')
      .mockReturnValue(undefined)
    setEditorTabs([{
      id: 't1',
      path: `${REPO}/a.md`,
      name: 'a.md',
      content: '# 用户编辑',
      isDirty: true,
      isEdited: true,
      viewMode: 'source',
    } as never])

    await refreshOpenTabsAfterSync([REPO])

    expect(loadTabContentSpy).not.toHaveBeenCalled()
    expect(markExternalChangeSpy).toHaveBeenCalledWith('t1')
  })

  it('冲突仓库的普通 tab：不加载含标记内容，关闭并引导冲突面板', async () => {
    const removeTabSpy = vi.spyOn(useEditorStore.getState(), 'removeTab').mockReturnValue(undefined)
    const loadTabContentSpy = vi
      .spyOn(useEditorStore.getState(), 'loadTabContent')
      .mockResolvedValue(undefined)
    useGitStore.setState({
      conflictRepos: [{ repo_path: REPO, repo_name: 'repo', conflict_file_count: 1, detected_at: '', updated_at: '' }],
      conflictFilesMap: { [REPO]: [`${REPO}/a.md`] },
    } as never)
    setEditorTabs([{
      id: 't1',
      path: `${REPO}/a.md`,
      name: 'a.md',
      content: '# 旧内容',
      isDirty: false,
      isEdited: false,
      viewMode: 'source',
    } as never])

    await refreshOpenTabsAfterSync([REPO])

    expect(removeTabSpy).toHaveBeenCalledWith('t1')
    expect(loadTabContentSpy).not.toHaveBeenCalled()
  })

  it('非 pull 仓库的 tab 不受影响', async () => {
    const loadTabContentSpy = vi
      .spyOn(useEditorStore.getState(), 'loadTabContent')
      .mockResolvedValue(undefined)
    setEditorTabs([{
      id: 't1',
      path: '/other/x.md',
      name: 'x.md',
      content: '# x',
      isDirty: false,
      isEdited: false,
      viewMode: 'source',
    } as never])

    await refreshOpenTabsAfterSync([REPO])

    expect(loadTabContentSpy).not.toHaveBeenCalled()
  })
})

describe('openFileWithConflictGuard（S-02 前端）', () => {
  it('冲突文件：返回冲突信息，不执行普通打开', async () => {
    const openConflictTabSpy = vi.spyOn(useEditorStore.getState(), 'openConflictTab').mockReturnValue(undefined)
    useGitStore.setState({
      conflictRepos: [{ repo_path: REPO, repo_name: 'repo', conflict_file_count: 1, detected_at: '', updated_at: '' }],
      conflictFilesMap: { [REPO]: [`${REPO}/a.md`] },
    } as never)

    const result = openFileWithConflictGuard(`${REPO}/a.md`)

    expect(result).toEqual({ isConflict: true, repoPath: REPO })
    expect(openConflictTabSpy).toHaveBeenCalledWith(REPO, 'repo', expect.objectContaining({ autoSelectFile: 'a.md' }))
  })

  it('非冲突文件：返回 null（调用方继续普通打开）', () => {
    const result = openFileWithConflictGuard(`${REPO}/b.md`)
    expect(result).toBeNull()
  })

  it('大小写差异（Windows 大小写不敏感）：repoPath 与 filePath 大小写不同仍命中并计算相对路径', () => {
    const openConflictTabSpy = vi.spyOn(useEditorStore.getState(), 'openConflictTab').mockReturnValue(undefined)
    // 记录路径用大写，传入路径用小写（Windows 常见写法差异）
    useGitStore.setState({
      conflictRepos: [{ repo_path: 'D:/Notes/repo', repo_name: 'repo', conflict_file_count: 1, detected_at: '', updated_at: '' }],
      conflictFilesMap: { 'D:/Notes/repo': ['D:/Notes/repo/a.md'] },
    } as never)

    const result = openFileWithConflictGuard('D:/notes/repo/a.md')

    // isConflictFile 大小写不敏感命中，且 rel 正确计算为仓库内相对路径
    expect(result).toEqual({ isConflict: true, repoPath: 'D:/Notes/repo' })
    expect(openConflictTabSpy).toHaveBeenCalledWith('D:/Notes/repo', 'repo', expect.objectContaining({ autoSelectFile: 'a.md' }))
  })
})
