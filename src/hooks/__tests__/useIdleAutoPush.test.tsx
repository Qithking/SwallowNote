/**
 * useIdleAutoPush 测试：保存后空闲（默认 60s，可配置）防抖触发 commitAndPushRepo，
 * 仓库按文件路径解析（嵌套取最长匹配），去重并过滤无远端/冲突仓库。
 * 冲突逻辑：本地内容恢复（不落标记）、冲突期间停止自动提交、解决事件恢复推送。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIdleAutoPush } from '../useIdleAutoPush'
import { useGitStore, useUIStore } from '@/stores'
import type { GitRepository } from '@/stores/git'

vi.mock('@/lib/git/service', () => ({
  commitAndPushRepo: vi.fn(async () => ({ success: true, committed: false, pushed: true })),
}))

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    gitGetConflictFiles: vi.fn(async () => [] as Array<{ path: string; abs_path: string }>),
    gitGetConflictLocalContent: vi.fn(async () => ''),
    gitSaveConflictFileContent: vi.fn(async () => {}),
  }
})

import { commitAndPushRepo } from '@/lib/git/service'
import { GitErrorCode } from '@/lib/git/errors'
import { gitGetConflictFiles, gitGetConflictLocalContent, gitSaveConflictFileContent } from '@/lib/tauri'

const REPO_A = 'D:/notes/workdoc'
const REPO_NESTED = 'D:/notes/workdoc/submodule'

function makeRepo(path: string, overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    name: path.split('/').pop() || 'repo',
    path,
    remoteUrl: 'https://example.com/repo.git',
    hasUncommittedChanges: true,
    uncommittedCount: 1,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
    ...overrides,
  }
}

function fireSave(path: string) {
  window.dispatchEvent(new CustomEvent('file-saved', { detail: { path } }))
}

function fireConflictResolved(repoPath: string) {
  window.dispatchEvent(new CustomEvent('git-conflict-resolved', { detail: { repoPath } }))
}

describe('useIdleAutoPush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(commitAndPushRepo).mockClear()
    vi.mocked(gitGetConflictFiles).mockClear()
    vi.mocked(gitGetConflictLocalContent).mockClear()
    vi.mocked(gitSaveConflictFileContent).mockClear()
    // 重置默认实现，防止用例间 mockImplementation/mockResolvedValue 泄漏
    vi.mocked(commitAndPushRepo).mockImplementation(async () => ({ success: true, committed: false, pushed: true }))
    vi.mocked(gitGetConflictFiles).mockImplementation(async () => [])
    vi.mocked(gitGetConflictLocalContent).mockImplementation(async () => '')
    vi.mocked(gitSaveConflictFileContent).mockImplementation(async () => {})
    useGitStore.setState({
      repositories: [makeRepo(REPO_A), makeRepo(REPO_NESTED)],
      cachedRepositories: [],
      syncStatus: { isSyncing: false, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
    })
    useUIStore.setState({ idleAutoPush: true, idleAutoPushDelay: 60 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const tRef = { current: (key: string) => key } as React.MutableRefObject<(k: string, o?: any) => string>

  it('does not push before 60s idle elapses', () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\202608.md')
    vi.advanceTimersByTime(59_999)
    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('pushes the repo containing the saved file after 60s', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\202608.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
    const [repo, message] = vi.mocked(commitAndPushRepo).mock.calls[0]
    expect(repo.path).toBe(REPO_A)
    expect(message).toBe('Auto push')
  })

  it('推送进行中 store 置 isAutoPushing=true, 完成后复位 (状态栏数据源)', async () => {
    let resolvePush!: (v: any) => void
    vi.mocked(commitAndPushRepo).mockImplementationOnce(
      () => new Promise((res) => { resolvePush = res }),
    )
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)
    // 推送挂起期间: 状态栏显示「自动推送中」所需的数据源
    expect(useGitStore.getState().syncStatus.isAutoPushing).toBe(true)
    expect(useGitStore.getState().syncStatus.isSyncing).toBe(true)

    resolvePush({ success: true, committed: false, pushed: true })
    await vi.advanceTimersByTimeAsync(0)
    // 完成后复位, 状态栏恢复通用结果显示
    expect(useGitStore.getState().syncStatus.isAutoPushing).toBe(false)
    expect(useGitStore.getState().syncStatus.isSyncing).toBe(false)
  })

  it('debounces: rapid saves within 60s fire one push for all involved repos', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    vi.advanceTimersByTime(30_000)
    fireSave('D:\\notes\\workdoc\\b.md')
    vi.advanceTimersByTime(30_000)
    // 第二次保存重置计时器，此时尚未到 60s
    expect(commitAndPushRepo).not.toHaveBeenCalled()
    fireSave('D:\\notes\\workdoc\\submodule\\c.md')
    await vi.advanceTimersByTimeAsync(60_000)

    // 同仓库去重为一次调用，嵌套仓库单独一次
    expect(commitAndPushRepo).toHaveBeenCalledTimes(2)
    const paths = vi.mocked(commitAndPushRepo).mock.calls.map(([r]) => r.path).sort()
    expect(paths).toEqual([REPO_A, REPO_NESTED])
  })

  it('resolves nested repo by longest path match', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\submodule\\deep\\note.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(commitAndPushRepo).mock.calls[0][0].path).toBe(REPO_NESTED)
  })

  it('skips repos without remote or already in conflict state', async () => {
    useGitStore.setState({
      repositories: [
        makeRepo('D:/notes/local-only', { remoteUrl: null }),
        makeRepo('D:/notes/conflicted', { status: 'conflict' }),
      ],
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\local-only\\x.md')
    fireSave('D:\\notes\\conflicted\\y.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('skips push entirely while a sync is in progress', async () => {
    useGitStore.setState({
      syncStatus: { isSyncing: true, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('retains saved paths and retries after the running sync finishes', async () => {
    useGitStore.setState({
      // 触发时模拟另一同步进行中：doPush 应跳过并保留路径重排期
      syncStatus: { isSyncing: true, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)
    // 触发时同步进行中：不推送，但路径保留并重排期重试
    expect(commitAndPushRepo).not.toHaveBeenCalled()
    // 同步结束后重试计时器（10s）到期，正常推送
    useGitStore.setState({
      syncStatus: { isSyncing: false, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
    })
    await vi.advanceTimersByTimeAsync(10_000)

    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
    expect(commitAndPushRepo).toHaveBeenCalledWith(expect.objectContaining({ path: 'D:/notes/workdoc' }), 'Auto push')
  })

  it('discards saved paths when the setting is disabled at trigger time', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    vi.advanceTimersByTime(30_000)
    // 等待期内关闭设置：触发时显式弃权，路径被丢弃
    useUIStore.setState({ idleAutoPush: false })
    await vi.advanceTimersByTimeAsync(30_000)
    // 重新开启但无新保存：不应推送已丢弃的路径
    useUIStore.setState({ idleAutoPush: true })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('does nothing when idleAutoPush setting is off (explicit opt-out)', async () => {
    // 默认开启（开箱即用）；用户显式关闭后不再触发
    useUIStore.setState({ idleAutoPush: false })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('cancels a scheduled push when the setting is turned off mid-wait', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    vi.advanceTimersByTime(30_000)
    // 等待期内关闭设置：后续保存取消已排期计时器
    useUIStore.setState({ idleAutoPush: false })
    fireSave('D:\\notes\\workdoc\\b.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('冲突时以本地内容覆盖工作区文件, 不保留冲突标记', async () => {
    // pull 整合冲突: commitAndPushRepo 返回 RebaseConflict (service 层不抛异常)
    vi.mocked(commitAndPushRepo).mockResolvedValueOnce({
      success: false,
      error: 'CONFLICT (content): Merge conflict in a.md',
      errorCode: GitErrorCode.RebaseConflict,
    })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([
      { path: 'a.md', abs_path: 'D:/notes/workdoc/a.md' },
    ])
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    // 本地内容写回工作区文件 (abs_path + 本地 stage 内容, 而非标记内容)
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(1)
    expect(gitSaveConflictFileContent).toHaveBeenCalledWith('D:/notes/workdoc', 'D:/notes/workdoc/a.md', '本地内容')
    // 冲突被记录, 仓库状态置 conflict (后续保存跳过该仓库)
    expect(useGitStore.getState().syncStatus.conflicted).toBeGreaterThanOrEqual(0)
  })

  it('冲突期间保存文件不推送该仓库 (停止自动提交)', async () => {
    useGitStore.setState({
      repositories: [makeRepo(REPO_A, { status: 'conflict' })],
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('冲突解决事件后恢复自动推送 (推送该仓库)', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
    expect(commitAndPushRepo).toHaveBeenCalledWith(expect.objectContaining({ path: REPO_A }), 'Auto push')
  })

  it('冲突解决事件在设置关闭时不触发推送', async () => {
    useUIStore.setState({ idleAutoPush: false })
    renderHook(() => useIdleAutoPush(tRef))
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  // ---- 冲突恢复逻辑 (restoreLocalForConflicts) 细节 ----

  it('多文件冲突时逐一恢复本地内容 (相对路径读取, 绝对路径写回)', async () => {
    vi.mocked(commitAndPushRepo).mockResolvedValueOnce({
      success: false,
      error: 'CONFLICT (content): Merge conflict',
      errorCode: GitErrorCode.RebaseConflict,
    })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([
      { path: 'a.md', abs_path: `${REPO_A}/a.md` },
      { path: 'b.md', abs_path: `${REPO_A}/b.md` },
    ])
    vi.mocked(gitGetConflictLocalContent).mockImplementation(async (_repo, filePath) => `local:${filePath}`)
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(gitGetConflictLocalContent).toHaveBeenCalledWith(REPO_A, 'a.md')
    expect(gitGetConflictLocalContent).toHaveBeenCalledWith(REPO_A, 'b.md')
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(2)
    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_A, `${REPO_A}/a.md`, 'local:a.md')
    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_A, `${REPO_A}/b.md`, 'local:b.md')
  })

  it('多仓库混合结果时仅对冲突仓库恢复本地内容', async () => {
    vi.mocked(commitAndPushRepo).mockImplementation(async (repo) => {
      if (repo.path === REPO_A) {
        return { success: false, error: 'CONFLICT', errorCode: GitErrorCode.RebaseConflict }
      }
      return { success: true, committed: false, pushed: true }
    })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([{ path: 'a.md', abs_path: `${REPO_A}/a.md` }])
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    fireSave('D:\\notes\\workdoc\\submodule\\c.md')
    await vi.advanceTimersByTimeAsync(60_000)

    // 仅冲突的 REPO_A 触发恢复流程, 成功的 REPO_NESTED 不涉及
    expect(gitGetConflictFiles).toHaveBeenCalledTimes(1)
    expect(gitGetConflictFiles).toHaveBeenCalledWith(REPO_A)
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(1)
    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_A, `${REPO_A}/a.md`, '本地内容')
  })

  it('某仓库恢复失败不影响其他仓库恢复 (容错)', async () => {
    vi.mocked(commitAndPushRepo).mockImplementation(async () => ({
      success: false,
      error: 'CONFLICT',
      errorCode: GitErrorCode.RebaseConflict,
    }))
    vi.mocked(gitGetConflictFiles).mockImplementation(async (repo) => {
      if (repo === REPO_A) throw new Error('fetch conflict files failed')
      return [{ path: 'c.md', abs_path: `${REPO_NESTED}/c.md` }]
    })
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    fireSave('D:\\notes\\workdoc\\submodule\\c.md')
    await vi.advanceTimersByTimeAsync(60_000)

    // REPO_A 抛错被捕获, REPO_NESTED 仍正常恢复
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(1)
    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_NESTED, `${REPO_NESTED}/c.md`, '本地内容')
  })

  it('非冲突失败不触发本地内容恢复', async () => {
    vi.mocked(commitAndPushRepo).mockResolvedValueOnce({
      success: false,
      error: 'network timeout',
      errorCode: GitErrorCode.Unknown,
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(gitGetConflictFiles).not.toHaveBeenCalled()
    expect(gitSaveConflictFileContent).not.toHaveBeenCalled()
  })

  it('RebaseContinueFailed 错误码按冲突处理并恢复本地内容', async () => {
    vi.mocked(commitAndPushRepo).mockResolvedValueOnce({
      success: false,
      error: 'rebase --continue failed',
      errorCode: GitErrorCode.RebaseContinueFailed,
    })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([{ path: 'a.md', abs_path: `${REPO_A}/a.md` }])
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_A, `${REPO_A}/a.md`, '本地内容')
  })

  it('错误信息含 rebase/merge is in progress 时按冲突处理 (无错误码)', async () => {
    vi.mocked(commitAndPushRepo).mockResolvedValueOnce({
      success: false,
      error: 'error: rebase/merge is in progress and cannot continue',
    })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([{ path: 'a.md', abs_path: `${REPO_A}/a.md` }])
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(gitSaveConflictFileContent).toHaveBeenCalledWith(REPO_A, `${REPO_A}/a.md`, '本地内容')
  })

  // ---- 冲突解决事件 (git-conflict-resolved) 调度细节 ----

  it('3s 内多个仓库的解决事件合并为一轮推送 (防抖)', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(2_000)
    fireConflictResolved(REPO_NESTED)
    // 第二个事件重置计时器: 距第一个事件 3s 时不应触发
    await vi.advanceTimersByTimeAsync(1_000)
    expect(commitAndPushRepo).not.toHaveBeenCalled()
    // 距第二个事件 3s 时两个仓库在同一轮推送
    await vi.advanceTimersByTimeAsync(2_000)
    expect(commitAndPushRepo).toHaveBeenCalledTimes(2)
    const paths = vi.mocked(commitAndPushRepo).mock.calls.map(([r]) => r.path).sort()
    expect(paths).toEqual([REPO_A, REPO_NESTED])
  })

  it('解决事件与等待期内的文件保存合并为一轮推送', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(1_000)
    // 保存重置计时器为 60s, 事件路径与保存路径合并推送
    fireSave('D:\\notes\\workdoc\\submodule\\c.md')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(commitAndPushRepo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(58_000)
    expect(commitAndPushRepo).toHaveBeenCalledTimes(2)
    const paths = vi.mocked(commitAndPushRepo).mock.calls.map(([r]) => r.path).sort()
    expect(paths).toEqual([REPO_A, REPO_NESTED])
  })

  it('解决事件触发推送时仓库仍处冲突状态则跳过', async () => {
    useGitStore.setState({
      repositories: [makeRepo(REPO_A, { status: 'conflict' })],
    })
    renderHook(() => useIdleAutoPush(tRef))
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(commitAndPushRepo).not.toHaveBeenCalled()
  })

  it('解决后推送再次冲突时仍恢复本地内容 (循环场景)', async () => {
    vi.mocked(commitAndPushRepo)
      .mockResolvedValueOnce({ success: false, error: 'CONFLICT', errorCode: GitErrorCode.RebaseConflict })
      .mockResolvedValueOnce({ success: false, error: 'CONFLICT', errorCode: GitErrorCode.RebaseConflict })
    vi.mocked(gitGetConflictFiles).mockResolvedValue([{ path: 'a.md', abs_path: `${REPO_A}/a.md` }])
    vi.mocked(gitGetConflictLocalContent).mockResolvedValue('本地内容')

    renderHook(() => useIdleAutoPush(tRef))
    // 第一轮: 保存触发推送 → 冲突 → 恢复本地内容
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(1)

    // 模拟用户解决冲突: 仓库状态复位后广播事件 → 第二轮推送 → 再次冲突 → 再次恢复
    useGitStore.setState({ repositories: [makeRepo(REPO_A)] })
    fireConflictResolved(REPO_A)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(commitAndPushRepo).toHaveBeenCalledTimes(2)
    expect(gitSaveConflictFileContent).toHaveBeenCalledTimes(2)
  })

  it('解决事件路径大小写与 store 不一致时仍恢复推送 (Windows 兼容)', async () => {
    renderHook(() => useIdleAutoPush(tRef))
    // 事件携带大写形式路径, store 中为小写
    fireConflictResolved('D:/Notes/WorkDoc')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
    expect(commitAndPushRepo).toHaveBeenCalledWith(expect.objectContaining({ path: REPO_A }), 'Auto push')
  })

  it('uses the configured idleAutoPushDelay instead of the default 60s', async () => {
    useUIStore.setState({ idleAutoPushDelay: 30 })
    renderHook(() => useIdleAutoPush(tRef))
    fireSave('D:\\notes\\workdoc\\a.md')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(commitAndPushRepo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(commitAndPushRepo).toHaveBeenCalledTimes(1)
  })
})
