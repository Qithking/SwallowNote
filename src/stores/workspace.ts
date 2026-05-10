/**
 * Workspace Store - Manages workspace state
 */
import { create } from 'zustand'

export interface WorkspaceState {
  rootPath: string | null
  isLoading: boolean
  error: string | null
  setRootPath: (path: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  rootPath: null,
  isLoading: false,
  error: null,
  setRootPath: (path) => set({ rootPath: path }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))
