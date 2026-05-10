/**
 * Git Store - Manages Git state
 */
import { create } from 'zustand'

export interface GitBranch {
  name: string
  isCurrent: boolean
}

export interface GitState {
  isRepository: boolean
  currentBranch: string
  branches: GitBranch[]
  hasUncommittedChanges: boolean
  uncommittedCount: number
  isGitLoading: boolean
  setIsRepository: (isRepo: boolean) => void
  setCurrentBranch: (branch: string) => void
  setBranches: (branches: GitBranch[]) => void
  setHasUncommittedChanges: (hasChanges: boolean) => void
  setUncommittedCount: (count: number) => void
  setLoading: (loading: boolean) => void
}

export const useGitStore = create<GitState>((set) => ({
  isRepository: false,
  currentBranch: '',
  branches: [],
  hasUncommittedChanges: false,
  uncommittedCount: 0,
  isGitLoading: false,
  setIsRepository: (isRepo) => set({ isRepository: isRepo }),
  setCurrentBranch: (branch) => set({ currentBranch: branch }),
  setBranches: (branches) => set({ branches }),
  setHasUncommittedChanges: (hasChanges) => set({ hasUncommittedChanges: hasChanges }),
  setUncommittedCount: (count) => set({ uncommittedCount: count }),
  setLoading: (loading) => set({ isGitLoading: loading }),
}))
