/**
 * useAutoSync 测试：自动同步 pull 结果的用户反馈行为（对齐手动同步 GitView 的提示分支）。
 * 核心回归（auto-sync-failure-silent）：pull 失败（非冲突）时必须 toast.error 提示
 * 且 logger.error 落日志；冲突走 warning；detached HEAD 用专属文案；全部成功不弹错误。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoSync } from '../useAutoSync'
import { useGitStore, useUIStore } from '@/stores'
import type { GitRepository, PullResult } from '@/stores/git'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))

// logger 保留真实实现，仅替换 error 为 spy：断言失败信息落日志，且不影响其它模块使用 logger
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>()
  return { ...actual, logger: { ...actual.logger, error: vi.fn() } }
})

vi.mock('@/lib/git/service', () => ({
  commitAndPushRepo: vi.fn(async () => ({ success: true, committed: false, pushed: true })),
}))

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    syncConflictRepoRecords: vi.fn(async () => []),
    gitGetConflictFiles: vi.fn(async () => [] as Array<{ path: string; abs_path: string }>),
  }
})

import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commitAndPushRepo } from '@/lib/git/service'
import { GitErrorCode } from '@/lib/git/errors'

const REPO_A = 'D:/notes/alpha'
const REPO_B = 'D:/notes/beta'

function makeRepo(path: string, overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    name: path.split('/').pop() || 'repo',
    path,
    remoteUrl: 'https://example.com/repo.git',
    hasUncommittedChanges: false,
    uncommittedCount: 0,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
    ...overrides,
  }
}

/** 构造 pullAllRepos 的单项结果 */
function pullResult(path: string, overrides: Partial<PullResult> = {}): PullResult {
  return { path, name: path.split('/').pop() || 'repo', success: true, ...overrides }
}

describe('useAutoSync', () => {
  const pullMock = vi.fn(async (_repos: GitRepository[]) => [] as PullResult[])

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // 重置默认实现，防止用例间 mockResolvedValue 泄漏
    pullMock.mockImplementation(async () => [])
    useGitStore.setState({
      repositories: [],
      cachedRepositories: [makeRepo(REPO_A), makeRepo(REPO_B)],
      conflictRepos: [],
      syncStatus: { isSyncing: false, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
      pullAllRepos: pullMock,
    })
    useUIStore.setState({ syncInterval: 30, autoSyncPush: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** 挂载 hook 并推进到启动同步完成（checkReady 500ms 轮询 + 2s 启动延迟），返回 t 翻译函数 spy */
  async function mountAndRunStartupSync() {
    const tFn = vi.fn((key: string, _options?: unknown) => key)
    const tRef = { current: tFn }
    const startupReadyRef = { current: true }
    renderHook(() => useAutoSync(
      startupReadyRef as React.MutableRefObject<boolean>,
      tRef as React.MutableRefObject<(key: string, options?: unknown) => string>,
    ))
    await vi.advanceTimersByTimeAsync(2_500)
    return tFn
  }

  it('pull 失败（非冲突）时以 git.pullResult 提示计数并落 logger.error', async () => {
    // 混合结果：1 成功 + 1 失败（网络错误）；当前缺陷：完全静默（无 toast 无日志）
    pullMock.mockResolvedValue([
      pullResult(REPO_A, { success: false, error: 'network timeout' }),
      pullResult(REPO_B),
    ])
    const tFn = await mountAndRunStartupSync()

    expect(tFn).toHaveBeenCalledWith('git.pullResult', { success: 1, fail: 1 })
    expect(toast.error).toHaveBeenCalledTimes(1)
    // 失败详情必须写入日志（用户反馈：日志中也看不到相关信息）
    expect(logger.error).toHaveBeenCalled()
  })

  it('detached HEAD 失败时以 git.pullDetachedHead 专属文案提示', async () => {
    pullMock.mockResolvedValue([
      pullResult(REPO_A, { success: false, isDetachedHead: true, error: 'detached HEAD' }),
    ])
    const tFn = await mountAndRunStartupSync()

    expect(tFn).toHaveBeenCalledWith('git.pullDetachedHead', { repos: 'alpha' })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('冲突仓库仍走 toast.warning（git.pullConflict）不回归', async () => {
    pullMock.mockResolvedValue([
      pullResult(REPO_A, { success: false, isConflict: true, error: 'CONFLICT' }),
      pullResult(REPO_B),
    ])
    await mountAndRunStartupSync()

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('全部成功时不弹任何错误提示', async () => {
    pullMock.mockResolvedValue([pullResult(REPO_A), pullResult(REPO_B)])
    await mountAndRunStartupSync()

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // ---- autoSyncPush 开启时 push 结果的反馈（对齐 pull 失败的提示分支）----

  /** autoSyncPush 开启且仓库有未提交变更的通用前置 */
  function seedPushEnabled() {
    useUIStore.setState({ syncInterval: 30, autoSyncPush: true })
    useGitStore.setState({ cachedRepositories: [makeRepo(REPO_A, { hasUncommittedChanges: true })] })
    pullMock.mockResolvedValue([pullResult(REPO_A)])
  }

  it('autoSyncPush 开启时 push 失败并入 git.pullResult 合并计数提示 (当前缺陷: push 失败静默)', async () => {
    seedPushEnabled()
    vi.mocked(commitAndPushRepo).mockResolvedValue({
      success: false,
      error: 'push failed: network',
      errorCode: GitErrorCode.Unknown,
    })
    const tFn = await mountAndRunStartupSync()

    // pull 成功 1 + push 失败 1 → 合并计数（与 syncStatus 写入值一致）
    expect(tFn).toHaveBeenCalledWith('git.pullResult', { success: 1, fail: 1 })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('push 凭证缺失时落 logger.error (当前缺陷: 静默跳过)', async () => {
    seedPushEnabled()
    vi.mocked(commitAndPushRepo).mockResolvedValue({
      success: false,
      error: 'authentication required',
      needsCredential: true,
    })
    await mountAndRunStartupSync()

    // 凭证缺失不打扰用户（无 toast），但必须留日志
    expect(logger.error).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('push detached HEAD 时落 logger.error (当前缺陷: 静默跳过)', async () => {
    seedPushEnabled()
    vi.mocked(commitAndPushRepo).mockResolvedValue({
      success: false,
      error: 'detached HEAD',
      errorCode: GitErrorCode.DetachedHead,
    })
    await mountAndRunStartupSync()

    expect(logger.error).toHaveBeenCalled()
  })
})
