/**
 * Git Store - Manages Git state
 */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { GitRepositoryInfo, gitPull, gitCredentialGet, gitPullWithCredentials, getConflictRepoRecords, removeConflictRepoRecord, syncConflictRepoRecords, gitGetConflictFiles, scanGitRepos, type ConflictRepoRecord } from '@/lib/tauri'
import i18n from '@/i18n'

export type RepoStatus = 'normal' | 'conflict' | 'error'

export interface GitRepository {
  name: string
  path: string
  remoteUrl: string | null
  hasUncommittedChanges: boolean
  uncommittedCount: number
  currentBranch: string
  isSubmodule: boolean
  parentPath: string | null
  status: RepoStatus
}

export function mapRepoInfoToRepository(info: GitRepositoryInfo): GitRepository {
  return {
    name: info.name,
    path: info.path,
    remoteUrl: info.remote_url,
    hasUncommittedChanges: info.has_uncommitted_changes,
    uncommittedCount: info.uncommitted_count,
    currentBranch: info.current_branch,
    isSubmodule: info.is_submodule,
    parentPath: info.parent_path,
    status: 'normal',
  }
}

export function mapRepoInfosToRepositories(infos: GitRepositoryInfo[]): GitRepository[] {
  const seenPaths = new Set<string>()
  return infos
    .filter((repo) => {
      if (seenPaths.has(repo.path)) return false
      seenPaths.add(repo.path)
      return true
    })
    .map(mapRepoInfoToRepository)
}

export interface PullResult {
  path: string
  name: string
  success: boolean
  error?: string
  isConflict?: boolean
  isDetachedHead?: boolean
}

export interface SyncStatus {
  isSyncing: boolean
  lastSyncTime: number | null  // timestamp
  succeeded: number
  failed: number
  conflicted: number
}

export interface GitState {
  repositories: GitRepository[]
  cachedRepositories: GitRepository[]
  activeRepository: string | null  // 当前选中的仓库路径
  conflictRepos: ConflictRepoRecord[]  // 持久化的冲突仓库记录
  conflictFilesMap: Record<string, string[]>  // repo_path -> 冲突文件绝对路径列表
  isGitLoading: boolean
  isPulling: boolean
  scanProgress: { current: number; total: number; message: string } | null
  syncStatus: SyncStatus
  // Actions
  setRepositories: (repos: GitRepository[]) => void
  setCachedRepositories: (repos: GitRepository[]) => void
  setActiveRepository: (path: string | null) => void
  updateRepository: (path: string, updates: Partial<GitRepository>) => void
  setLoading: (loading: boolean) => void
  setPulling: (pulling: boolean) => void
  setScanProgress: (progress: { current: number; total: number; message: string } | null) => void
  clearScanProgress: () => void
  setSyncStatus: (status: Partial<SyncStatus>) => void
  updateRepositoryStatuses: (pullResults: PullResult[]) => void
  resetRepositoryStatuses: () => void
  pullAllRepos: (repos: GitRepository[]) => Promise<PullResult[]>
  scanAndCacheRepos: (paths: string[]) => Promise<GitRepository[]>
  loadConflictRepos: () => Promise<void>
  syncConflictReposFromPullResults: (pullResults: PullResult[]) => Promise<void>
  /** Check if a file path is a conflict file by comparing against cached conflict file lists */
  isConflictFile: (filePath: string) => { isConflict: boolean; repoPath: string; repoName: string } | null
}

export const useGitStore = create<GitState>((set, get) => ({
  repositories: [],
  cachedRepositories: [],
  activeRepository: null,
  conflictRepos: [],
  conflictFilesMap: {},
  isGitLoading: false,
  isPulling: false,
  scanProgress: null,
  syncStatus: { isSyncing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 },
  setRepositories: (repos) => set({ repositories: repos }),
  setCachedRepositories: (repos) => set({ cachedRepositories: repos }),
  setActiveRepository: (path) => set({ activeRepository: path }),
  updateRepository: (path, updates) => set((state) => ({
    repositories: state.repositories.map((repo) =>
      repo.path === path ? { ...repo, ...updates } : repo
    )
  })),
  setLoading: (loading) => set({ isGitLoading: loading }),
  setPulling: (pulling) => set({ isPulling: pulling }),
  setScanProgress: (progress) => set({ scanProgress: progress }),
  clearScanProgress: () => set({ scanProgress: null }),
  setSyncStatus: (status) => set((state) => ({
    syncStatus: { ...state.syncStatus, ...status }
  })),
  updateRepositoryStatuses: (pullResults) => set((state) => {
    const statusMap = new Map<string, RepoStatus>()
    for (const r of pullResults) {
      if (r.isConflict) {
        statusMap.set(r.path, 'conflict')
      } else if (!r.success) {
        statusMap.set(r.path, 'error')
      }
    }
    return {
      repositories: state.repositories.map((repo) => ({
        ...repo,
        status: statusMap.get(repo.path) || 'normal',
      })),
      cachedRepositories: state.cachedRepositories.map((repo) => ({
        ...repo,
        status: statusMap.get(repo.path) || 'normal',
      })),
    }
  }),
  resetRepositoryStatuses: () => set((state) => ({
    repositories: state.repositories.map((repo) => ({ ...repo, status: 'normal' as RepoStatus })),
    cachedRepositories: state.cachedRepositories.map((repo) => ({ ...repo, status: 'normal' as RepoStatus })),
  })),
  scanAndCacheRepos: async (paths: string[]) => {
    if (paths.length === 0) {
      set({ repositories: [], cachedRepositories: [] })
      return []
    }

    set({ isGitLoading: true, scanProgress: { current: 0, total: paths.length, message: i18n.t('git.scanning') } })
    try {
      const scanPromises = paths.map(async (path, index) => {
        try {
          set({ scanProgress: { current: index, total: paths.length, message: i18n.t('git.scanningPath', { path }) } })
          const repos = await scanGitRepos(path)
          return repos
        } catch (e) {
          logger.error('git-store', `Failed to scan git repos in ${path}:`, e)
          return []
        }
      })

      const results = await Promise.all(scanPromises)
      const allRepos = mapRepoInfosToRepositories(results.flat())

      // Preserve non-normal statuses from the cache (canonical source of status)
      const prevRepos = get().cachedRepositories
      const statusMap = new Map<string, RepoStatus>()
      for (const r of prevRepos) {
        if (r.status !== 'normal') statusMap.set(r.path, r.status)
      }
      const mergedRepos = allRepos.map((repo) => {
        const status = statusMap.get(repo.path)
        return status ? { ...repo, status } : repo
      })

      set({ repositories: mergedRepos, cachedRepositories: mergedRepos })
      return mergedRepos
    } catch (e) {
      logger.error('git-store', 'Failed to scan and cache git repos:', e)
      return get().cachedRepositories
    } finally {
      set({ isGitLoading: false, scanProgress: null })
    }
  },
  pullAllRepos: async (repos: GitRepository[]) => {
    // Filter repos that have a remote URL
    const reposWithRemote = repos.filter(r => r.remoteUrl)
    if (reposWithRemote.length === 0) return []

    // 防重入：如果正在拉取中，直接返回空数组
    if (get().isPulling) return []

    set({ isPulling: true })
    try {
      // 限制并发数 4，避免过多 git 进程
      const CONCURRENCY = 4
      const results: PullResult[] = []
      for (let i = 0; i < reposWithRemote.length; i += CONCURRENCY) {
        const batch = reposWithRemote.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.allSettled(
          batch.map(async (repo): Promise<PullResult> => {
            try {
              await gitPull(repo.path)
              return { path: repo.path, name: repo.name, success: true }
            } catch (e) {
              const errorMessage = String(e).trim()
              // 需要认证时尝试 keyring 中的凭证
              if (errorMessage.startsWith('AUTH_REQUIRED:')) {
                try {
                  const savedCred = await gitCredentialGet(repo.path)
                  if (savedCred) {
                    try {
                      await gitPullWithCredentials(repo.path, savedCred.username, savedCred.password)
                      return { path: repo.path, name: repo.name, success: true }
                    } catch (credPullError) {
                      // 检查凭证拉取是否产生冲突
                      const credErrorMessage = String(credPullError).trim()
                      if (credErrorMessage.startsWith('REBASE_CONFLICT:')) {
                        return { path: repo.path, name: repo.name, success: false, error: credErrorMessage, isConflict: true }
                      }
                      // 凭证拉取失败（非冲突）直接返回，避免丢失真实原因
                      return { path: repo.path, name: repo.name, success: false, error: credErrorMessage }
                    }
                  }
                } catch {
                  // Failed to get saved credentials
                }
              }
              // Check for rebase conflict
              if (errorMessage.startsWith('REBASE_CONFLICT:')) {
                return { path: repo.path, name: repo.name, success: false, error: errorMessage, isConflict: true }
              }
              // G-06 修复：detached HEAD 时 pull 无法执行，标记专门状态以便前端提示
              if (errorMessage.startsWith('DETACHED_HEAD:')) {
                return { path: repo.path, name: repo.name, success: false, error: errorMessage, isDetachedHead: true }
              }
              return { path: repo.path, name: repo.name, success: false, error: errorMessage }
            }
          })
        )
        // 将本批结果收集到总结果数组中
        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            results.push(r.value)
          } else {
            // 理论上不会走到这里（内部已 try/catch），兜底处理
            results.push({ path: '', name: '', success: false, error: String(r.reason) })
          }
        }
      }
      return results
    } finally {
      set({ isPulling: false })
    }
  },
  loadConflictRepos: async () => {
    try {
      const records = await getConflictRepoRecords()
      // 加载各冲突仓库的冲突文件并清理过期记录
      const newConflictFilesMap: Record<string, string[]> = {}
      const staleRepoPaths: string[] = []
      await Promise.all(records.map(async (record) => {
        try {
          const files = await gitGetConflictFiles(record.repo_path)
          if (files.length > 0) {
            newConflictFilesMap[record.repo_path] = files.map((f) => f.abs_path)
          } else {
            // No actual conflict files — mark for cleanup
            staleRepoPaths.push(record.repo_path)
            newConflictFilesMap[record.repo_path] = []
          }
        } catch (e) {
          // 获取冲突文件失败时保留原记录，不清空，避免掩盖真实冲突
          logger.warn('git-store', 'Failed to fetch conflict files for', record.repo_path, e)
        }
      }))

      // 移除过期 DB 记录（无实际冲突文件的仓库）
      if (staleRepoPaths.length > 0) {
        await Promise.all(staleRepoPaths.map(async (path) => {
          try {
            await removeConflictRepoRecord(path)
          } catch {
            // Ignore removal errors
          }
        }))
      }

      // Filter out stale records from the list
      const validRecords = records.filter((r) => !staleRepoPaths.includes(r.repo_path))
      set({ conflictRepos: validRecords, conflictFilesMap: newConflictFilesMap })
      // 同时基于有效冲突记录更新仓库状态
      set((state) => ({
        repositories: state.repositories.map((repo) => {
          const isConflict = validRecords.some((r) => r.repo_path === repo.path)
          return { ...repo, status: isConflict ? 'conflict' as RepoStatus : repo.status === 'conflict' ? 'normal' as RepoStatus : repo.status }
        }),
        cachedRepositories: state.cachedRepositories.map((repo) => {
          const isConflict = validRecords.some((r) => r.repo_path === repo.path)
          return { ...repo, status: isConflict ? 'conflict' as RepoStatus : repo.status === 'conflict' ? 'normal' as RepoStatus : repo.status }
        }),
      }))
    } catch (e) {
      logger.error('git-store', 'Failed to load conflict repos:', e)
    }
  },
  syncConflictReposFromPullResults: async (pullResults: PullResult[]) => {
    try {
      // 从 pull 结果构建冲突仓库列表
      const conflictEntries: [string, string, number][] = pullResults
        .filter((r) => r.isConflict)
        .map((r) => [r.path, r.name, 0] as [string, string, number])

      // 包含本次 pull 未涉及的既有冲突仓库
      const existingConflictPaths = new Set(conflictEntries.map(([p]) => p))
      const { conflictRepos } = get()
      for (const record of conflictRepos) {
        if (!existingConflictPaths.has(record.repo_path)) {
          conflictEntries.push([record.repo_path, record.repo_name, record.conflict_file_count])
        }
      }

      const records = await syncConflictRepoRecords(conflictEntries)

      // Load conflict files for each conflict repo
      const newConflictFilesMap: Record<string, string[]> = {}
      await Promise.all(records.map(async (record) => {
        try {
          const files = await gitGetConflictFiles(record.repo_path)
          newConflictFilesMap[record.repo_path] = files.map((f) => f.abs_path)
        } catch {
          newConflictFilesMap[record.repo_path] = []
        }
      }))

      set({ conflictRepos: records, conflictFilesMap: newConflictFilesMap })
    } catch (e) {
      logger.error('git-store', 'Failed to sync conflict repos:', e)
    }
  },
  isConflictFile: (filePath: string): { isConflict: boolean; repoPath: string; repoName: string } | null => {
    const { conflictRepos, conflictFilesMap } = get()
    for (const repo of conflictRepos) {
      const conflictFiles = conflictFilesMap[repo.repo_path]
      if (conflictFiles && conflictFiles.includes(filePath)) {
        return { isConflict: true, repoPath: repo.repo_path, repoName: repo.repo_name }
      }
    }
    return null
  },
}))
