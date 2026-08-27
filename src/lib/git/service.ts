/**
 * Git Service 层 - 业务编排深模块
 *
 * 把 5 处 AUTH fallback 复制 + pull-then-push 顺序内化。
 * withCredentialFallback 覆盖 pull/push/forcePush/forcePull 单操作。
 * commitAndPushRepo 覆盖 commit+push 复合操作。
 *
 * caller 只需处理 needsCredential:true 决定弹 dialog 或 silent。
 */
import {
  gitPull, gitPullWithCredentials,
  gitForcePush, gitForcePushWithCredentials,
  gitForcePull, gitForcePullWithCredentials,
  gitCredentialGet,
  gitCommitAndPush, gitPushWithCredentials,
} from '@/lib/tauri'
import { parseGitError, GitErrorCode } from '@/lib/git/errors'

/** service 只依赖 repo.path, 避免循环依赖 stores/git */
interface RepoPath {
  path: string
}

/** 单操作类型 */
export type GitOp = 'pull' | 'forcePush' | 'forcePull'

/** 操作结果 */
export interface GitOpResult {
  success: boolean
  error?: string
  /** AUTH_REQUIRED 且无可用凭证,caller 决定弹 dialog 或 silent */
  needsCredential?: boolean
  /** 分类后的错误码,caller 用 switch(code) 处理 */
  errorCode?: GitErrorCode
  /** commitAndPush 特有:是否有实际提交 */
  committed?: boolean
  /** commitAndPush 特有:是否有实际推送 */
  pushed?: boolean
}

/** 主操作函数 (lazy 引用, 避免 mock 不完整时模块加载失败) */
function getPrimaryOp(op: GitOp): (path: string) => Promise<void> {
  switch (op) {
    case 'pull': return gitPull
    case 'forcePush': return gitForcePush
    case 'forcePull': return gitForcePull
  }
}

/** 带凭证操作函数 */
function getCredOp(op: GitOp): (path: string, u: string, p: string) => Promise<void> {
  switch (op) {
    case 'pull': return gitPullWithCredentials
    case 'forcePush': return gitForcePushWithCredentials
    case 'forcePull': return gitForcePullWithCredentials
  }
}

/**
 * 执行 git 操作, AUTH_REQUIRED 时自动尝试 keyring 凭证 fallback。
 * 凭证操作失败仍标 needsCredential:true, 让 caller 弹 dialog 或 silent。
 * errorCode 透传供 caller 决定是否特殊处理(如冲突)。
 */
export async function withCredentialFallback(
  repo: RepoPath,
  op: GitOp,
): Promise<GitOpResult> {
  const primary = getPrimaryOp(op)
  const credOp = getCredOp(op)
  try {
    await primary(repo.path)
    return { success: true }
  } catch (e) {
    const errorMessage = String(e).trim()
    const error = parseGitError(errorMessage)

    if (error.code === GitErrorCode.AuthRequired) {
      try {
        const savedCred = await gitCredentialGet(repo.path)
        if (savedCred) {
          try {
            await credOp(repo.path, savedCred.username, savedCred.password)
            return { success: true }
          } catch (credError) {
            // 凭证操作失败:仍标 needsCredential,让 caller 弹 dialog 或 silent
            const credErrorMessage = String(credError).trim()
            const credParsed = parseGitError(credErrorMessage)
            return {
              success: false,
              error: credErrorMessage,
              errorCode: credParsed.code,
              needsCredential: true,
            }
          }
        }
      } catch {
        // keyring 读取失败, fall through to needsCredential
      }
      return { success: false, error: errorMessage, needsCredential: true }
    }

    return { success: false, error: errorMessage, errorCode: error.code }
  }
}

/**
 * commit + push 复合操作。
 * AUTH_REQUIRED 时尝试 pull+push with credentials(commit 可能已成功, 不重试 commit)。
 * 凭证操作失败仍标 needsCredential:true, 让 caller 弹 dialog 或 silent。
 */
export async function commitAndPushRepo(
  repo: RepoPath,
  message: string,
): Promise<GitOpResult> {
  try {
    const result = await gitCommitAndPush(repo.path, message)
    return { success: true, committed: result.committed, pushed: result.pushed }
  } catch (e) {
    const errorMessage = String(e).trim()
    const error = parseGitError(errorMessage)

    if (error.code === GitErrorCode.AuthRequired) {
      try {
        const savedCred = await gitCredentialGet(repo.path)
        if (savedCred) {
          try {
            // commit 可能已成功, 只需 pull+push with credentials
            await gitPullWithCredentials(repo.path, savedCred.username, savedCred.password)
            await gitPushWithCredentials(repo.path, savedCred.username, savedCred.password)
            return { success: true, committed: true, pushed: true }
          } catch (credError) {
            // 凭证操作失败:仍标 needsCredential,让 caller 弹 dialog 或 silent
            const credErrorMessage = String(credError).trim()
            const credParsed = parseGitError(credErrorMessage)
            return {
              success: false,
              error: credErrorMessage,
              errorCode: credParsed.code,
              needsCredential: true,
            }
          }
        }
      } catch {
        // keyring 读取失败
      }
      return { success: false, error: errorMessage, needsCredential: true }
    }

    return { success: false, error: errorMessage, errorCode: error.code }
  }
}
