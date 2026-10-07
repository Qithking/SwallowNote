/**
 * useIdleAutoPush — 空闲自动推送 hook
 * 保存文件后空闲一段可配置时间（默认 60s）内无新的保存操作，则对涉及仓库执行 commit+push 全流程。
 * 复用 commitAndPushRepo 处理远端领先（pull 整合）；冲突按错误码在本 hook 内分流。
 * 冲突时以本地内容覆盖工作区文件（不落冲突标记），index 冲突态保留给解析器。
 * 冲突仓库停止自动提交；监听 git-conflict-resolved 事件在用户解决后恢复推送。
 */
import { useEffect, useRef } from 'react'
import { useGitStore, useUIStore } from '@/stores'
import type { GitRepository } from '@/stores/git'
import type { PullResult } from '@/stores'
import { GitErrorCode, isPushConflict } from '@/lib/git/errors'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'

type TFunc = (key: string, options?: any) => string

/** 保存后空闲判定时长兜底值（设置项 idleAutoPushDelay 缺失时使用，单位秒） */
const DEFAULT_IDLE_PUSH_DELAY_S = 60

/** 同步/推送进行中时的重试间隔（毫秒） */
const RETRY_DELAY_MS = 10_000

/** 归一路径分隔符，用于文件路径与仓库路径的前缀匹配 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 找到包含给定文件路径的仓库，嵌套仓库（如子模块）取最长路径匹配 */
function findRepoForFile(repos: GitRepository[], filePath: string): GitRepository | null {
  const norm = normalizePath(filePath)
  let best: GitRepository | null = null
  let bestLen = -1
  for (const repo of repos) {
    const rp = normalizePath(repo.path)
    if ((norm === rp || norm.startsWith(rp + '/')) && rp.length > bestLen) {
      best = repo
      bestLen = rp.length
    }
  }
  return best
}

export function useIdleAutoPush(tRef: React.MutableRefObject<TFunc>) {
  const savedPathsRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPushingRef = useRef(false)
  const firstSaveAtRef = useRef<number | null>(null)
  const lastSaveAtRef = useRef<number | null>(null)

  useEffect(() => {
    /** 排期推送计时器，附带 catch 避免 doPush 异常成为未处理的 rejection */
    const schedulePush = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        doPush().catch((e) => logger.error('idle-auto-push', 'unexpected push failure:', e))
      }, delayMs)
    }

    const doPush = async () => {
      if (isPushingRef.current) {
        // 推送进行中：保留路径，稍后重试（本次计时器已消耗，需重排期）
        logger.info('idle-auto-push', 'push already in progress, retry in 10s (paths retained)')
        schedulePush(RETRY_DELAY_MS)
        return
      }
      const triggeredAt = Date.now()
      // 触发时再次校验开关：用户可能在等待期内关闭了设置（显式弃权，丢弃路径）
      if (!useUIStore.getState().idleAutoPush) {
        logger.info('idle-auto-push', 'idle push disabled at trigger time, discard saved paths')
        savedPathsRef.current.clear()
        firstSaveAtRef.current = null
        lastSaveAtRef.current = null
        return
      }
      const paths = Array.from(savedPathsRef.current)
      if (paths.length === 0) {
        logger.info('idle-auto-push', 'idle delay reached but no saved paths, skip')
        return
      }
      const gitStore = useGitStore.getState()
      // 与间隔同步互斥：进行中则保留路径稍后重试，避免静默丢弃待推送内容
      if (gitStore.syncStatus.isSyncing) {
        logger.info('idle-auto-push', 'another sync in progress, retry in 10s (paths retained)')
        schedulePush(RETRY_DELAY_MS)
        return
      }
      savedPathsRef.current.clear()
      const lastSaveAt = lastSaveAtRef.current
      const firstSaveAt = firstSaveAtRef.current
      firstSaveAtRef.current = null
      lastSaveAtRef.current = null
      logger.info(
        'idle-auto-push',
        `idle delay reached, push triggered | triggeredAt=${new Date(triggeredAt).toISOString()}` +
          ` | lastSaveAt=${lastSaveAt ? new Date(lastSaveAt).toISOString() : 'n/a'}` +
          ` | idleElapsed=${lastSaveAt ? triggeredAt - lastSaveAt : 'n/a'}ms` +
          ` | files=${paths.length} firstSaveAt=${firstSaveAt ? new Date(firstSaveAt).toISOString() : 'n/a'}`,
      )

      // 解析涉及的仓库（按路径去重），过滤无远端与已冲突仓库
      const repoMap = new Map<string, GitRepository>()
      const skippedPaths: string[] = []
      for (const p of paths) {
        const repo = findRepoForFile(gitStore.repositories, p)
        if (repo && repo.remoteUrl && repo.status !== 'conflict') {
          repoMap.set(repo.path, repo)
        } else {
          skippedPaths.push(p)
        }
      }
      if (skippedPaths.length > 0) {
        logger.info('idle-auto-push', 'paths skipped (no repo/no remote/conflict):', skippedPaths)
      }
      if (repoMap.size === 0) {
        logger.info('idle-auto-push', 'no eligible repos to push, done')
        return
      }
      logger.info(
        'idle-auto-push',
        `pushing ${repoMap.size} repo(s): ${Array.from(repoMap.values()).map((r) => r.path).join(', ')}`,
      )

      isPushingRef.current = true
      // isAutoPushing 供状态栏区分「自动推送中」与手动/间隔「同步仓库」
      gitStore.setSyncStatus({ isSyncing: true, isAutoPushing: true })
      const results: PullResult[] = []
      const conflictNames: string[] = []
      try {
        // import 置于 try 内：加载失败时 finally 仍会复位状态，避免标志永久卡死
        const { commitAndPushRepo } = await import('@/lib/git/service')
        for (const repo of repoMap.values()) {
          try {
            const startedAt = Date.now()
            const r = await commitAndPushRepo(repo, 'Auto push')
            logger.info(
              'idle-auto-push',
              `repo done: ${repo.path} | success=${r.success} committed=${r.committed} pushed=${r.pushed}` +
                ` | took=${Date.now() - startedAt}ms`,
            )
            if (r.success) {
              results.push({ path: repo.path, name: repo.name, success: true, isConflict: false })
              continue
            }
            // 凭证缺失：静默跳过，等用户手动同步时处理
            if (r.needsCredential) continue
            const code = r.errorCode ?? GitErrorCode.Unknown
            const isConflict = isPushConflict(code, r.error || '')
            if (isConflict) {
              results.push({ path: repo.path, name: repo.name, success: false, isConflict: true })
              conflictNames.push(repo.name)
              continue
            }
            if (code === GitErrorCode.DetachedHead) continue
            results.push({ path: repo.path, name: repo.name, success: false, isConflict: false })
            logger.error('idle-auto-push', 'Idle auto push failed:', repo.path, r.error)
          } catch (e) {
            results.push({ path: repo.path, name: repo.name, success: false, isConflict: false })
            logger.error('idle-auto-push', 'Idle auto push error:', repo.path, e)
          }
        }
      } finally {
        // 先复位标志再执行冲突同步，避免其异常导致标志永久卡死（与 useAutoSync 一致）
        const store = useGitStore.getState()
        if (results.length > 0) {
          store.updateRepositoryStatuses(results)
          store.setSyncStatus({ isSyncing: false, isAutoPushing: false, lastSyncTime: Date.now() })
        } else {
          store.setSyncStatus({ isSyncing: false, isAutoPushing: false })
        }
        isPushingRef.current = false
        logger.info(
          'idle-auto-push',
          `push cycle finished | finishedAt=${new Date().toISOString()} | totalTook=${Date.now() - triggeredAt}ms` +
            ` | ok=${results.filter((r) => r.success).length} conflict=${results.filter((r) => r.isConflict).length} failed=${results.filter((r) => !r.success && !r.isConflict).length}`,
        )
        if (conflictNames.length > 0) {
          // pull 冲突时 Rust 保留工作区冲突标记供解析器使用；
          // 自动推送场景先以本地内容覆盖，避免编辑器出现 <<<<<<< 标记（本地优先）
          await restoreLocalForConflicts(results)
          toast.warning(tRef.current('git.pullConflict', { repos: conflictNames.join(', ') }))
          try {
            await store.syncConflictReposFromPullResults(results)
          } catch (e) {
            logger.error('idle-auto-push', 'conflict repo sync failed:', e)
          }
        }
      }
    }

    /** 冲突仓库以本地内容覆盖工作区文件（不 stage，保留 index 冲突态供解析器使用） */
    const restoreLocalForConflicts = async (results: PullResult[]) => {
      try {
        const { gitGetConflictFiles, gitGetConflictLocalContent, gitSaveConflictFileContent } =
          await import('@/lib/tauri')
        for (const r of results) {
          if (!r.isConflict) continue
          try {
            const files = await gitGetConflictFiles(r.path)
            for (const f of files) {
              const local = await gitGetConflictLocalContent(r.path, f.path)
              await gitSaveConflictFileContent(r.path, f.abs_path, local)
            }
            logger.info(
              'idle-auto-push',
              `restored local content for ${files.length} conflict file(s): ${r.path}`,
            )
          } catch (e) {
            logger.error('idle-auto-push', 'restore local content failed:', r.path, e)
          }
        }
      } catch (e) {
        logger.error('idle-auto-push', 'conflict restore module load failed:', e)
      }
    }

    const onFileSaved = (e: Event) => {
      const path = (e as CustomEvent).detail?.path
      if (!path) return
      const uiState = useUIStore.getState()
      // 设置关闭时不记录也不计时；已排期的计时器一并取消
      if (!uiState.idleAutoPush) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        return
      }
      const delayMs =
        (uiState.idleAutoPushDelay || DEFAULT_IDLE_PUSH_DELAY_S) * 1000
      const now = Date.now()
      savedPathsRef.current.add(path)
      // 防抖：每次保存重置计时器，间隔内无新保存才触发推送
      schedulePush(delayMs)
      firstSaveAtRef.current ||= now
      lastSaveAtRef.current = now
      logger.info(
        'idle-auto-push',
        `file saved: ${path} | save#${savedPathsRef.current.size} savedAt=${new Date(now).toISOString()} | delay=${delayMs / 1000}s | push scheduled at ${new Date(now + delayMs).toISOString()}`,
      )
    }

    /** 冲突解决完成后恢复推送的调度延迟（毫秒）：等待状态复位与多仓库事件合并 */
    const CONFLICT_RESOLVED_DELAY_MS = 3_000

    /**
     * 冲突解决完成回调：把仓库路径并入待推送集合并短延迟调度，
     * doPush 的 findRepoForFile 按 norm === rp 精确匹配仓库，走完整 commit+push 流程
     * （含 rebase 产生的堆积提交）。设置关闭时忽略，保持"冲突时停止自动提交"的语义。
     */
    const onConflictResolved = (e: Event) => {
      const repoPath = (e as CustomEvent).detail?.repoPath
      if (!repoPath) return
      if (!useUIStore.getState().idleAutoPush) {
        logger.info('idle-auto-push', `conflict resolved but idle push disabled, skip: ${repoPath}`)
        return
      }
      // Windows 路径大小写不敏感：归一为 store 中的规范路径，避免大小写差异导致精确匹配失败
      const norm = normalizePath(repoPath).toLowerCase()
      const canonical =
        useGitStore.getState().repositories.find((r) => normalizePath(r.path).toLowerCase() === norm)?.path ?? repoPath
      savedPathsRef.current.add(canonical)
      firstSaveAtRef.current ||= Date.now()
      lastSaveAtRef.current = Date.now()
      schedulePush(CONFLICT_RESOLVED_DELAY_MS)
      logger.info('idle-auto-push', `conflict resolved, auto push rescheduled in ${CONFLICT_RESOLVED_DELAY_MS}ms: ${repoPath}`)
    }

    window.addEventListener('file-saved', onFileSaved as EventListener)
    window.addEventListener('git-conflict-resolved', onConflictResolved as EventListener)
    return () => {
      window.removeEventListener('file-saved', onFileSaved as EventListener)
      window.removeEventListener('git-conflict-resolved', onConflictResolved as EventListener)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [tRef])
}
