/**
 * Workspace Store - Manages workspace state
 */
import { create } from 'zustand'
import { getLatestFolder, saveFolderHistory } from '@/lib/tauri'
import { useFileTreeStore } from './filetree'

export interface WorkspaceState {
  rootPath: string | null
  isLoading: boolean
  error: string | null
  setRootPath: (path: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  openFolder: (path: string) => Promise<void>
  loadLastFolder: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  isLoading: false,
  error: null,
  setRootPath: (path) => set({ rootPath: path }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  openFolder: async (path: string) => {
    set({ isLoading: true, error: null })
    try {
      await saveFolderHistory(path)
      const fileTreeStore = useFileTreeStore.getState()
      await fileTreeStore.loadRoot(path)
      set({ rootPath: path, isLoading: false })
    } catch (err) {
      set({ error: `Failed to open folder: ${err}`, isLoading: false })
    }
  },
  loadLastFolder: async () => {
    try {
      const lastPath = await getLatestFolder()
      if (lastPath) {
        await get().openFolder(lastPath)
      }
    } catch (err) {
      console.warn('Failed to load last folder:', err)
    }
  },
}))
