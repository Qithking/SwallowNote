import { useEffect, useRef } from 'react'
import { useGitStore, useUIStore, useWorkspaceStore, useFileTreeStore } from '@/stores'
import type { UIState, GitState, PullResult } from '@/stores'
import type { GitRepository } from '@/stores/git'
import { GitErrorCode } from '@/lib/git/errors'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'

type TFunc = (key: string, options?: any) => string

export function useAutoSync(
  startupReadyRef: React.MutableRefObject<boolean>,
  tRef: React.MutableRefObject<TFunc>,
) {
  const syncInterval = useUIStore((s: UIState) => s.syncInterval)
  const autoSyncPush = useUIStore((s: UIState) => s.autoSyncPush)
  const cachedRepositories = useGitStore((s: GitState) => s.cachedRepositories)
  const pullAllRepos = useGitStore((s: GitState) => s.pullAllRepos)

  const syncIntervalRef = useRef(syncInterval)
  syncIntervalRef.current = syncInterval
  const autoSyncPushRef = useRef(autoSyncPush)
  autoSyncPushRef.current = autoSyncPush
  const cachedReposRef = useRef(cachedRepositories)
  cachedReposRef.current = cachedRepositories
  const pullAllReposRef = useRef(pullAllRepos)
  pullAllReposRef.current = pullAllRepos
  const isSyncingRef = useRef(false)
  const isInitialStartupSyncRef = useRef(true)
  const hasCompletedInitialStartupSyncRef = useRef(false)

  useEffect(() => {
    const doSync = async () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const repos = cachedReposRef.current
      if (repos.length === 0) {
        isSyncingRef.current = false
        return
      }
      const gitStore = useGitStore.getState()

      const last = gitStore.syncStatus.lastSyncTime
      if (!hasCompletedInitialStartupSyncRef.current && last && Date.now() - last < 30_000) {
        isSyncingRef.current = false
        return
      }

      gitStore.setSyncStatus({ isSyncing: true })
      try {
        const results = await pullAllReposRef.current(repos)
        const succeeded = results.filter((r: PullResult) => r.success).length
        const failed = results.filter((r: PullResult) => !r.success && !r.isConflict).length
        const conflicted = results.filter((r: PullResult) => r.isConflict).length

        let pushSucceeded = 0
        let pushFailed = 0
        const pushErrorPaths: string[] = []
        const pushConflictPaths: string[] = []
        if (autoSyncPushRef.current) {
          const conflictedPaths = new Set(results.filter((r: PullResult) => r.isConflict).map((r: PullResult) => r.path))
          const reposWithChanges = repos.filter((r: GitRepository) => r.hasUncommittedChanges && r.remoteUrl && !conflictedPaths.has(r.path))
          if (reposWithChanges.length > 0) {
            const { commitAndPushRepo } = await import('@/lib/git/service')
            for (const repo of reposWithChanges) {
              const r = await commitAndPushRepo(repo, 'Auto sync')
              if (r.success) {
                if (r.committed || r.pushed) {
                  pushSucceeded++
                }
                continue
              }
              if (r.needsCredential) {
                continue
              }
              const code = r.errorCode ?? GitErrorCode.Unknown
              const errorMessage = r.error || ''
              if (code === GitErrorCode.RebaseConflict || errorMessage.includes('rebase/merge is in progress')) {
                pushConflictPaths.push(repo.path)
                continue
              }
              if (code === GitErrorCode.RebaseContinueFailed || code === GitErrorCode.MergeCommitFailed) {
                pushConflictPaths.push(repo.path)
                continue
              }
              if (code === GitErrorCode.DetachedHead) {
                continue
              }
              pushFailed++
              pushErrorPaths.push(repo.path)
              logger.error('app', 'Auto sync push failed:', repo.path, errorMessage)
            }
          }
        }

        const allResults: PullResult[] = [
          ...results,
          ...pushConflictPaths.map(p => ({ path: p, name: repos.find(r => r.path === p)?.name || '', success: false, isConflict: true })),
          ...pushErrorPaths.map(p => ({ path: p, name: repos.find(r => r.path === p)?.name || '', success: false, isConflict: false })),
        ]
        gitStore.updateRepositoryStatuses(allResults)

        if (!isInitialStartupSyncRef.current) {
          try {
            const { scanGitRepos } = await import('@/lib/tauri')
            const { mapRepoInfosToRepositories } = await import('@/stores/git')
            const uiState = useUIStore.getState()
            const wsState = useWorkspaceStore.getState()
            const scanPaths = uiState.workspaceMode === 'workspace'
              ? (wsState.workspaceFolders || [])
              : (wsState.rootPath ? [wsState.rootPath] : [])
            const scanPromises = scanPaths.map(async (path) => {
              try { return await scanGitRepos(path) } catch { return [] }
            })
            const scanResults = await Promise.all(scanPromises)
            const freshRepos = mapRepoInfosToRepositories(scanResults.flat())
            const statusMap = new Map<string, 'conflict' | 'error'>()
            for (const r of allResults) {
              if (r.isConflict) statusMap.set(r.path, 'conflict')
              else if (!r.success) statusMap.set(r.path, 'error')
            }
            const mergedRepos = freshRepos.map((repo: GitRepository) => {
              const status = statusMap.get(repo.path)
              if (status) return { ...repo, status }
              return repo
            })
            gitStore.setRepositories(mergedRepos)
            gitStore.setCachedRepositories(mergedRepos)
          } catch {
            // Ignore scan errors after sync
          }
        }

        gitStore.setSyncStatus({
          isSyncing: false,
          lastSyncTime: Date.now(),
          succeeded: succeeded + pushSucceeded,
          failed: failed + pushFailed,
          conflicted,
        })
        if (succeeded > 0 || conflicted > 0 || pushSucceeded > 0) {
          const fileTreeStore = useFileTreeStore.getState()
          fileTreeStore.refreshExpanded()
        }
        if (conflicted > 0) {
          const repoNames = results.filter((r: PullResult) => r.isConflict).map((r: PullResult) => r.name).join(', ')
          toast.warning(tRef.current('git.pullConflict', { repos: repoNames }))
          await gitStore.syncConflictReposFromPullResults(allResults)
        }
      } catch (e) {
        logger.error('app', 'Auto sync failed:', e)
        gitStore.setSyncStatus({ isSyncing: false })
      } finally {
        isSyncingRef.current = false
      }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null
    let checkId: ReturnType<typeof setTimeout> | null = null
    let postReadyDelayId: ReturnType<typeof setTimeout> | null = null
    let maxWaitId: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    const scheduleInterval = () => {
      if (intervalId) clearInterval(intervalId)
      const intervalMs = syncIntervalRef.current * 60 * 1000
      if (intervalMs > 0) {
        intervalId = setInterval(() => {
          doSync()
        }, intervalMs)
      }
    }

    const startInitialSync = () => {
      postReadyDelayId = setTimeout(() => {
        isInitialStartupSyncRef.current = true
        doSync().finally(() => {
          hasCompletedInitialStartupSyncRef.current = true
          isInitialStartupSyncRef.current = false
          scheduleInterval()
        })
      }, 2000)
    }

    const checkReady = () => {
      if (isCancelled) return
      if (startupReadyRef.current && cachedReposRef.current.length > 0) {
        startInitialSync()
        return
      }
      checkId = setTimeout(checkReady, 500)
    }

    maxWaitId = setTimeout(() => {
      if (checkId) clearTimeout(checkId)
      if (!intervalId) scheduleInterval()
    }, 30_000)

    checkReady()

    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState | undefined) => {
      if (prevState && state.syncInterval !== prevState.syncInterval) {
        syncIntervalRef.current = state.syncInterval
        scheduleInterval()
      }
    })

    return () => {
      isCancelled = true
      if (checkId) clearTimeout(checkId)
      if (postReadyDelayId) clearTimeout(postReadyDelayId)
      if (maxWaitId) clearTimeout(maxWaitId)
      if (intervalId) clearInterval(intervalId)
      unsubscribe()
    }
  }, [])
}
