/**
 * Git Store - Manages Git state
 */
import { create } from 'zustand'

export interface GitBranch {
  name: string
  isCurrent: boolean
}

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
}

export interface GitState {
  repositories: GitRepository[]
  activeRepository: string | null  // 当前选中的仓库路径
  isGitLoading: boolean
  // Actions
  setRepositories: (repos: GitRepository[]) => void
  setActiveRepository: (path: string | null) => void
  updateRepository: (path: string, updates: Partial<GitRepository>) => void
  setLoading: (loading: boolean) => void
}

export const useGitStore = create<GitState>((set) => ({
  repositories: [],
  activeRepository: null,
  isGitLoading: false,
  setRepositories: (repos) => set({ repositories: repos }),
  setActiveRepository: (path) => set({ activeRepository: path }),
  updateRepository: (path, updates) => set((state) => ({
    repositories: state.repositories.map((repo) =>
      repo.path === path ? { ...repo, ...updates } : repo
    )
  })),
  setLoading: (loading) => set({ isGitLoading: loading }),
}))
