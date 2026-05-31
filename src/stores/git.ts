/**
 * Git Store - Manages Git state
 */
import { create } from 'zustand'
import { GitRepositoryInfo, gitPull, gitCredentialGet, gitPullWithCredentials } from '@/lib/tauri'

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
}

export const useGitStore = create<GitState>((set) => ({
  repositories: [],
  cachedRepositories: [],
  activeRepository: null,
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
                  // Saved credentials failed, fall through to return auth error
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
}))
