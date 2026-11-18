/**
 * P1-11 回归测试：错误码协议解析
 * - 后端裸发（无冒号）错误码必须命中：NO_REMOTE / NOT_IN_GIT_REPO / ALREADY_UP_TO_DATE
 * - 带冒号前缀错误码正常解析（负载保留）
 * - SUBMODULE_REF_NEEDS_UPDATE 死分支已删除（后端从不产生）
 */
import { describe, it, expect } from 'vitest'
import { parseGitError, GitErrorCode } from '../errors'

describe('parseGitError', () => {
  it('P1-11: 裸发错误码（无冒号）必须命中对应错误类型', () => {
    expect(parseGitError('NO_REMOTE').code).toBe(GitErrorCode.NoRemote)
    expect(parseGitError('NOT_IN_GIT_REPO').code).toBe(GitErrorCode.NotInGitRepo)
    expect(parseGitError('ALREADY_UP_TO_DATE').code).toBe(GitErrorCode.AlreadyUpToDate)
  })

  it('裸发错误码带首尾空白时仍命中（容错）', () => {
    expect(parseGitError('NO_REMOTE\n').code).toBe(GitErrorCode.NoRemote)
  })

  it('带冒号前缀的错误码正常解析，负载保留在 message', () => {
    const r = parseGitError('REBASE_CONFLICT:CONFLICT (content): Merge conflict in a.md')
    expect(r.code).toBe(GitErrorCode.RebaseConflict)
    expect(r.message).toBe('CONFLICT (content): Merge conflict in a.md')
  })

  it('DETACHED_HEAD_DIVERGED 优先于 DETACHED_HEAD 前缀匹配', () => {
    const r = parseGitError('DETACHED_HEAD_DIVERGED:main:1:2')
    expect(r.code).toBe(GitErrorCode.DetachedHeadDiverged)
    expect(r.message).toBe('main:1:2')
  })

  it('未知错误落入 Unknown', () => {
    const r = parseGitError('fatal: not a git repository')
    expect(r.code).toBe(GitErrorCode.Unknown)
    expect(r.message).toBe('fatal: not a git repository')
  })

  it('P1-11: SUBMODULE_REF_NEEDS_UPDATE 死分支已删除（后端从不产生该码）', () => {
    // 该字符串不再被识别为独立错误码（后端无对应产出），落入 Unknown
    expect(parseGitError('SUBMODULE_REF_NEEDS_UPDATE:x').code).toBe(GitErrorCode.Unknown)
    // 枚举成员已移除
    expect((GitErrorCode as Record<string, unknown>)['SubmoduleRefNeedsUpdate']).toBeUndefined()
  })
})
