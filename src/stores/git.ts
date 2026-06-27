/**
 * Git Store - Manages Git state
 */
import { create } from 'zustand'
import { GitRepositoryInfo, gitPull, gitCredentialGet, gitPullWithCredentials, getConflictRepoRecords, removeConflictRepoRecord, syncConflictRepoRecords, gitGetConflictFiles, type ConflictRepoRecord } from '@/lib/tauri'

export interface GitBranch {
  name: string
  isCurrent: boolean
}

export type RepoStatus = 'normal' | 'conflict' | 'error'

export interface GitRepository {
  name: string
  path: string
  remoteUrl: string | null
  hasUncommittedChanges: boolean
  uncommittedCount: number
  currentBranch: string
  branches: GitBranch[]
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
    branches: [],
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
  conflictFilesMap: Record<string, string[]>  // 冲突仓库的冲突文件绝对路径映射 (repo_path -> [abs_path, ...])
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
  loadConflictRepos: () => Promise<void>
  syncConflictReposFromPullResults: (pullResults: PullResult[]) => Promise<void>
  /** Check if a file path is a conflict file by comparing against cached conflict file lists */
  isConflictFile: (filePath: string) => { isConflict: boolean; repoPath: string; repoName: string } | null
}

export const useGitStore = create<GitState>((set) => ({
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
  pullAllRepos: async (repos: GitRepository[]) => {
    // Filter repos that have a remote URL
    const reposWithRemote = repos.filter(r => r.remoteUrl)
    if (reposWithRemote.length === 0) return []

    set({ isPulling: true })
    try {
      // Execute all pull operations in parallel
      const pullPromises = reposWithRemote.map(async (repo) => {
        try {
          await gitPull(repo.path)
          return { path: repo.path, name: repo.name, success: true }
        } catch (e) {
          const errorMessage = String(e).trim()
          // If auth required, try saved credentials from keyring
          if (errorMessage.startsWith('AUTH_REQUIRED:')) {
            try {
              const savedCred = await gitCredentialGet(repo.path)
              if (savedCred) {
                try {
                  await gitPullWithCredentials(repo.path, savedCred.username, savedCred.password)
                  return { path: repo.path, name: repo.name, success: true }
                } catch (credPullError) {
                  // Check if conflict occurred with credentials pull
                  const credErrorMessage = String(credPullError).trim()
                  if (credErrorMessage.startsWith('REBASE_CONFLICT:')) {
                    return { path: repo.path, name: repo.name, success: false, error: credErrorMessage, isConflict: true }
                  }
                  // 凭证拉取失败（非冲突），直接返回凭证错误信息，
                  // 不 fallthrough 到下方基于原始 errorMessage 的 REBASE_CONFLICT 检查，
                  // 否则真实的凭证失败原因会丢失
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
          return { path: repo.path, name: repo.name, success: false, error: errorMessage }
        }
      })

      const results = await Promise.all(pullPromises)
      return results
    } finally {
      set({ isPulling: false })
    }
  },
  loadConflictRepos: async () => {
    try {
      const records = await getConflictRepoRecords()
      // Load conflict files for each conflict repo and clean up stale records
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
        } catch {
          // If we can't get conflict files for a repo, skip it
          newConflictFilesMap[record.repo_path] = []
        }
      }))

      // Remove stale DB records (repos with no actual conflict files)
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
      // Also update repository statuses based on valid conflict records
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
      console.error('Failed to load conflict repos:', e)
    }
  },
  syncConflictReposFromPullResults: async (pullResults: PullResult[]) => {
    try {
      // Build conflict repo list from pull results
      const conflictEntries: [string, string, number][] = pullResults
        .filter((r) => r.isConflict)
        .map((r) => [r.path, r.name, 0] as [string, string, number])

      // Also include existing conflict repos that weren't in this pull
      const existingConflictPaths = new Set(conflictEntries.map(([p]) => p))
      const { conflictRepos } = useGitStore.getState()
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
      console.error('Failed to sync conflict repos:', e)
    }
  },
  isConflictFile: (filePath: string): { isConflict: boolean; repoPath: string; repoName: string } | null => {
    const { conflictRepos, conflictFilesMap } = useGitStore.getState()
    for (const repo of conflictRepos) {
      const conflictFiles = conflictFilesMap[repo.repo_path]
      if (conflictFiles && conflictFiles.includes(filePath)) {
        return { isConflict: true, repoPath: repo.repo_path, repoName: repo.repo_name }
      }
    }
    return null
  },
}))
