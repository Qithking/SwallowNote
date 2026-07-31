/**
 * Git Service 层单元测试
 *
 * 候选 A:把 5 处 AUTH fallback 复制 + pull-then-push 顺序内化到 service。
 * withCredentialFallback 覆盖 pull/push/forcePush/forcePull 4 种操作。
 * commitAndPushRepo 覆盖 commit+push 复合操作(单独测)。
 *
 * mock 策略:mock @/lib/tauri 的 invoke wrapper,不 mock service 本身。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  gitPull, gitPullWithCredentials,
  gitForcePush, gitForcePushWithCredentials,
  gitForcePull, gitForcePullWithCredentials,
  gitCredentialGet,
  gitCommitAndPush, gitPushWithCredentials,
} from '@/lib/tauri'
import { withCredentialFallback, commitAndPushRepo } from '@/lib/git/service'
import { GitErrorCode } from '@/lib/git/errors'
import type { GitRepository } from '@/lib/tauri'

vi.mock('@/lib/tauri', () => ({
  gitPull: vi.fn(),
  gitPullWithCredentials: vi.fn(),
  gitForcePush: vi.fn(),
  gitForcePushWithCredentials: vi.fn(),
  gitForcePull: vi.fn(),
  gitForcePullWithCredentials: vi.fn(),
  gitCredentialGet: vi.fn(),
  gitCommitAndPush: vi.fn(),
  gitPushWithCredentials: vi.fn(),
}))

const createRepo = (path: string, name: string): GitRepository => ({
  name, path,
  remoteUrl: 'https://github.com/test/repo.git',
  hasUncommittedChanges: false,
  uncommittedCount: 0,
  currentBranch: 'main',
  isSubmodule: false,
  parentPath: null,
  status: 'normal',
})

describe('withCredentialFallback · pull 操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gitCredentialGet).mockResolvedValue(null)
  })
  afterEach(() => vi.resetAllMocks())

  it('主操作成功 → success:true', async () => {
    vi.mocked(gitPull).mockResolvedValueOnce(undefined)
    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(true)
    expect(r.error).toBeUndefined()
    expect(r.needsCredential).toBeFalsy()
    expect(gitPullWithCredentials).not.toHaveBeenCalled()
  })

  it('AUTH_REQUIRED + 有凭证 → 凭证操作成功 → success:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockResolvedValueOnce(undefined)

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(true)
    expect(gitPullWithCredentials).toHaveBeenCalledWith('/ws/r1', 'u', 'p')
  })

  it('AUTH_REQUIRED + 有凭证 → 凭证操作 REBASE_CONFLICT → errorCode:RebaseConflict', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockRejectedValueOnce('REBASE_CONFLICT:CONFLICT in file')

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.RebaseConflict)
    expect(r.error).toContain('REBASE_CONFLICT')
    // 凭证操作失败仍标 needsCredential,让 caller 弹 dialog 或 silent
    expect(r.needsCredential).toBe(true)
  })

  it('AUTH_REQUIRED + 有凭证 → 凭证操作其他错误 → needsCredential:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockRejectedValueOnce('fatal: network error')

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.error).toBe('fatal: network error')
    expect(r.needsCredential).toBe(true)
  })

  it('AUTH_REQUIRED + 无凭证 → needsCredential:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce(null)

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.needsCredential).toBe(true)
    expect(r.error).toContain('AUTH_REQUIRED')
  })

  it('AUTH_REQUIRED + 凭证获取抛错 → needsCredential:true', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('AUTH_REQUIRED:fatal: could not read Username')
    vi.mocked(gitCredentialGet).mockRejectedValueOnce(new Error('keyring error'))

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.needsCredential).toBe(true)
  })

  it('REBASE_CONFLICT → errorCode:RebaseConflict', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('REBASE_CONFLICT:merge conflict')

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.RebaseConflict)
    expect(r.needsCredential).toBeFalsy()
  })

  it('DETACHED_HEAD → errorCode:DetachedHead', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('DETACHED_HEAD:HEAD is detached')

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.DetachedHead)
  })

  it('其他错误 → success:false, errorCode:Unknown', async () => {
    vi.mocked(gitPull).mockRejectedValueOnce('fatal: network error')

    const r = await withCredentialFallback(createRepo('/ws/r1', 'r1'), 'pull')
    expect(r.success).toBe(false)
    expect(r.error).toBe('fatal: network error')
    expect(r.errorCode).toBe(GitErrorCode.Unknown)
    expect(r.needsCredential).toBeFalsy()
  })
})

describe('withCredentialFallback · forcePush / forcePull 操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gitCredentialGet).mockResolvedValue(null)
  })

  it('forcePush AUTH_REQUIRED + 有凭证 → gitForcePushWithCredentials 被调', async () => {
    vi.mocked(gitForcePush).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitForcePushWithCredentials).mockResolvedValueOnce(undefined)

    const r = await withCredentialFallback(createRepo('/ws/r2', 'r2'), 'forcePush')
    expect(r.success).toBe(true)
    expect(gitForcePushWithCredentials).toHaveBeenCalledWith('/ws/r2', 'u', 'p')
  })

  it('forcePull AUTH_REQUIRED + 无凭证 → needsCredential:true', async () => {
    vi.mocked(gitForcePull).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce(null)

    const r = await withCredentialFallback(createRepo('/ws/r3', 'r3'), 'forcePull')
    expect(r.success).toBe(false)
    expect(r.needsCredential).toBe(true)
  })
})

describe('commitAndPushRepo · commit+push 复合操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gitCredentialGet).mockResolvedValue(null)
  })

  it('gitCommitAndPush 成功 → success:true, committed/pushed 透传', async () => {
    vi.mocked(gitCommitAndPush).mockResolvedValueOnce({ committed: true, pushed: true } as any)
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(true)
    expect(r.committed).toBe(true)
    expect(r.pushed).toBe(true)
    expect(gitPushWithCredentials).not.toHaveBeenCalled()
  })

  it('gitCommitAndPush 无改动 → success:true, committed:false, pushed:false', async () => {
    vi.mocked(gitCommitAndPush).mockResolvedValueOnce({ committed: false, pushed: false } as any)
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(true)
    expect(r.committed).toBe(false)
    expect(r.pushed).toBe(false)
  })

  it('AUTH_REQUIRED + 有凭证 → pull+push with credentials 成功 → success:true', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockResolvedValueOnce(undefined)
    vi.mocked(gitPushWithCredentials).mockResolvedValueOnce(undefined)

    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(true)
    expect(r.committed).toBe(true)
    expect(r.pushed).toBe(true)
    expect(gitPullWithCredentials).toHaveBeenCalledWith('/ws/r1', 'u', 'p')
    expect(gitPushWithCredentials).toHaveBeenCalledWith('/ws/r1', 'u', 'p')
  })

  it('AUTH_REQUIRED + 有凭证 → pull REBASE_CONFLICT → errorCode:RebaseConflict', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockRejectedValueOnce('REBASE_CONFLICT:conflict')

    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.RebaseConflict)
    // 凭证操作失败仍标 needsCredential,让 caller 弹 dialog 或 silent
    expect(r.needsCredential).toBe(true)
  })

  it('AUTH_REQUIRED + 有凭证 → push 失败 → needsCredential:true', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce({ username: 'u', password: 'p' } as any)
    vi.mocked(gitPullWithCredentials).mockResolvedValueOnce(undefined)
    vi.mocked(gitPushWithCredentials).mockRejectedValueOnce('fatal: push rejected')

    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.error).toBe('fatal: push rejected')
    expect(r.needsCredential).toBe(true)
  })

  it('AUTH_REQUIRED + 无凭证 → needsCredential:true', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('AUTH_REQUIRED:auth failed')
    vi.mocked(gitCredentialGet).mockResolvedValueOnce(null)

    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.needsCredential).toBe(true)
  })

  it('DETACHED_HEAD → errorCode:DetachedHead', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('DETACHED_HEAD:detached')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.DetachedHead)
  })

  it('SUBMODULE_UNCOMMITTED → errorCode:SubmoduleUncommitted', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('SUBMODULE_UNCOMMITTED:has changes')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.SubmoduleUncommitted)
  })

  it('SUBMODULE_REF_NEEDS_UPDATE → errorCode:SubmoduleRefNeedsUpdate', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('SUBMODULE_REF_NEEDS_UPDATE:needs update')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.SubmoduleRefNeedsUpdate)
  })

  it('REBASE_CONFLICT → errorCode:RebaseConflict', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('REBASE_CONFLICT:conflict')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.RebaseConflict)
  })

  it('REBASE_CONTINUE_FAILED → errorCode:RebaseContinueFailed', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('REBASE_CONTINUE_FAILED:failed')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.RebaseContinueFailed)
  })

  it('MERGE_COMMIT_FAILED → errorCode:MergeCommitFailed', async () => {
    vi.mocked(gitCommitAndPush).mockRejectedValueOnce('MERGE_COMMIT_FAILED:failed')
    const r = await commitAndPushRepo(createRepo('/ws/r1', 'r1'), 'msg')
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe(GitErrorCode.MergeCommitFailed)
  })
})
