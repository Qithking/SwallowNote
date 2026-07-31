/**
 * parseGitError 单元测试 - 把 Tauri 抛出的 "CODE:msg" 字符串解析为 typed object
 *
 * Bug: git-store / GitView / App.tsx 三处各自用 startsWith 解析错误前缀,
 *      子集不一致(git-store 3 种 / GitView 6 种 / App 5 种)。
 * Fix: 集中到 parseGitError,3 处 caller 改为 switch(code)。
 */
import { describe, it, expect } from 'vitest'
import { parseGitError, GitErrorCode, type GitError } from '@/lib/git/errors'

describe('parseGitError · AUTH_REQUIRED 分支', () => {
  it('解析 "AUTH_REQUIRED:msg" → {code: AuthRequired, message: "msg"}', () => {
    const raw = 'AUTH_REQUIRED:fatal: could not read Username for \'https://github.com\''
    const result = parseGitError(raw)
    expect(result.code).toBe(GitErrorCode.AuthRequired)
    expect(result.message).toBe('fatal: could not read Username for \'https://github.com\'')
    expect(result.raw).toBe(raw)
  })

  it('AUTH_REQUIRED 前缀后消息为空时,message 为空字符串', () => {
    const result = parseGitError('AUTH_REQUIRED:')
    expect(result.code).toBe(GitErrorCode.AuthRequired)
    expect(result.message).toBe('')
  })
})

describe('parseGitError · 其他错误码分支', () => {
  it('REBASE_CONFLICT:msg → RebaseConflict', () => {
    const r = parseGitError('REBASE_CONFLICT:CONFLICT (content): Merge conflict in file.txt')
    expect(r.code).toBe(GitErrorCode.RebaseConflict)
    expect(r.message).toBe('CONFLICT (content): Merge conflict in file.txt')
  })

  it('DETACHED_HEAD:msg → DetachedHead', () => {
    const r = parseGitError('DETACHED_HEAD:HEAD is detached')
    expect(r.code).toBe(GitErrorCode.DetachedHead)
  })

  it('SUBMODULE_UNCOMMITTED:msg → SubmoduleUncommitted', () => {
    const r = parseGitError('SUBMODULE_UNCOMMITTED:submodule has uncommitted changes')
    expect(r.code).toBe(GitErrorCode.SubmoduleUncommitted)
  })

  it('SUBMODULE_REF_NEEDS_UPDATE:msg → SubmoduleRefNeedsUpdate', () => {
    const r = parseGitError('SUBMODULE_REF_NEEDS_UPDATE:submodule ref needs update')
    expect(r.code).toBe(GitErrorCode.SubmoduleRefNeedsUpdate)
  })

  it('REBASE_CONTINUE_FAILED:msg → RebaseContinueFailed', () => {
    const r = parseGitError('REBASE_CONTINUE_FAILED:git rebase --continue failed')
    expect(r.code).toBe(GitErrorCode.RebaseContinueFailed)
  })

  it('MERGE_COMMIT_FAILED:msg → MergeCommitFailed', () => {
    const r = parseGitError('MERGE_COMMIT_FAILED:git commit failed after merge')
    expect(r.code).toBe(GitErrorCode.MergeCommitFailed)
  })

  it('ALREADY_UP_TO_DATE:msg → AlreadyUpToDate', () => {
    const r = parseGitError('ALREADY_UP_TO_DATE:Already up-to-date')
    expect(r.code).toBe(GitErrorCode.AlreadyUpToDate)
  })

  it('NO_REMOTE:msg → NoRemote', () => {
    const r = parseGitError('NO_REMOTE:No remote configured')
    expect(r.code).toBe(GitErrorCode.NoRemote)
  })

  it('NOT_IN_GIT_REPO:msg → NotInGitRepo', () => {
    const r = parseGitError('NOT_IN_GIT_REPO:not a git repository')
    expect(r.code).toBe(GitErrorCode.NotInGitRepo)
  })
})

describe('parseGitError · Unknown fallback', () => {
  it('无前缀的纯文本 → Unknown,message=原文', () => {
    const r = parseGitError('fatal: not a git repository')
    expect(r.code).toBe(GitErrorCode.Unknown)
    expect(r.message).toBe('fatal: not a git repository')
    expect(r.raw).toBe('fatal: not a git repository')
  })

  it('空字符串 → Unknown', () => {
    const r = parseGitError('')
    expect(r.code).toBe(GitErrorCode.Unknown)
    expect(r.message).toBe('')
  })

  it('未知前缀 UNKNOWN_CODE:msg → Unknown(不误判)', () => {
    const r = parseGitError('UNKNOWN_CODE:something')
    expect(r.code).toBe(GitErrorCode.Unknown)
  })

  it('非字符串输入(number) → Unknown', () => {
    const r = parseGitError(42)
    expect(r.code).toBe(GitErrorCode.Unknown)
    expect(r.message).toBe('42')
  })

  it('null → Unknown', () => {
    const r = parseGitError(null)
    expect(r.code).toBe(GitErrorCode.Unknown)
    expect(r.message).toBe('null')
  })
})
