/**
 * Git 错误分类协议 - 把 Tauri 抛出的 "CODE:msg" 字符串解析为 typed object
 *
 * 前后端错误协议:Rust 端构造 `format!("CODE:{}", e)` 字符串,
 * TS 端原本各自 startsWith 解析,子集不一致。集中到 parseGitError 后,
 * 3 处 caller(git-store / GitView / App)改为 switch(code)。
 */

/** Git 错误码,镜像 Rust 端构造的前缀协议 */
export enum GitErrorCode {
  AuthRequired = 'AUTH_REQUIRED',
  RebaseConflict = 'REBASE_CONFLICT',
  DetachedHead = 'DETACHED_HEAD',
  SubmoduleUncommitted = 'SUBMODULE_UNCOMMITTED',
  SubmoduleRefNeedsUpdate = 'SUBMODULE_REF_NEEDS_UPDATE',
  RebaseContinueFailed = 'REBASE_CONTINUE_FAILED',
  MergeCommitFailed = 'MERGE_COMMIT_FAILED',
  AlreadyUpToDate = 'ALREADY_UP_TO_DATE',
  NoRemote = 'NO_REMOTE',
  NotInGitRepo = 'NOT_IN_GIT_REPO',
  Unknown = 'UNKNOWN',
}

/** 解析后的 Git 错误对象 */
export interface GitError {
  code: GitErrorCode
  message: string
  raw: string
}

/** 前缀 → code 映射,顺序即匹配优先级 */
const PREFIX_TO_CODE: Array<[string, GitErrorCode]> = [
  ['AUTH_REQUIRED:', GitErrorCode.AuthRequired],
  ['REBASE_CONFLICT:', GitErrorCode.RebaseConflict],
  ['DETACHED_HEAD:', GitErrorCode.DetachedHead],
  ['SUBMODULE_UNCOMMITTED:', GitErrorCode.SubmoduleUncommitted],
  ['SUBMODULE_REF_NEEDS_UPDATE:', GitErrorCode.SubmoduleRefNeedsUpdate],
  ['REBASE_CONTINUE_FAILED:', GitErrorCode.RebaseContinueFailed],
  ['MERGE_COMMIT_FAILED:', GitErrorCode.MergeCommitFailed],
  ['ALREADY_UP_TO_DATE:', GitErrorCode.AlreadyUpToDate],
  ['NO_REMOTE:', GitErrorCode.NoRemote],
  ['NOT_IN_GIT_REPO:', GitErrorCode.NotInGitRepo],
]

/** 把 Tauri 抛出的 "CODE:msg" 字符串解析为 typed GitError */
export function parseGitError(error: unknown): GitError {
  const raw = String(error)
  for (const [prefix, code] of PREFIX_TO_CODE) {
    if (raw.startsWith(prefix)) {
      return { code, message: raw.slice(prefix.length), raw }
    }
  }
  return { code: GitErrorCode.Unknown, message: raw, raw }
}
