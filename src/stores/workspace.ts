/**
 * Workspace Store - Manages workspace state
 */
import { create } from 'zustand'
import { getLatestFolder, saveFolderHistory, getFolderHistory } from '@/lib/tauri'
import { useFileTreeStore } from './filetree'
import { useUIStore, WorkspaceMode } from './ui'

export interface WorkspaceState {
  rootPath: string | null
  workspaceFolders: string[]
  currentWorkspacePath: string | null
  isLoading: boolean
  error: string | null
  setRootPath: (path: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  openFolder: (path: string) => Promise<void>
  loadLastFolder: () => Promise<void>
  loadLatestByMode: () => Promise<void>
  addWorkspaceFolder: (path: string) => Promise<void>
  removeWorkspaceFolder: (path: string) => void
  saveWorkspaceFile: () => Promise<void>
  loadWorkspaceFile: (workspacePath: string) => Promise<void>
  switchMode: (mode: WorkspaceMode) => Promise<void>
  initMode: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  workspaceFolders: [],
  currentWorkspacePath: null,
  isLoading: false,
  error: null,
  setRootPath: (path) => set({ rootPath: path }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  openFolder: async (path: string) => {
    set({ isLoading: true, error: null })
    try {
      const { workspaceMode } = useUIStore.getState()
      if (workspaceMode === 'folder') {
        await saveFolderHistory(path)
      }
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
  loadLatestByMode: async () => {
    try {
      const history = await getFolderHistory()
      const { workspaceMode } = useUIStore.getState()
      const fileTreeStore = useFileTreeStore.getState()
      
      if (workspaceMode === 'workspace') {
        const workspacePath = history.find(p => p.endsWith('.swallow-workspace'))
        if (workspacePath) {
          await get().loadWorkspaceFile(workspacePath)
          await saveFolderHistory(workspacePath)
        } else {
          set({ workspaceFolders: [], currentWorkspacePath: null })
          fileTreeStore.clearAll()
        }
      } else {
        const folderPath = history.find(p => !p.endsWith('.swallow-workspace'))
        if (folderPath) {
          await get().openFolder(folderPath)
        } else {
          set({ rootPath: null })
          fileTreeStore.clearAll()
        }
      }
    } catch (err) {
      console.warn('Failed to load latest by mode:', err)
    }
  },
  addWorkspaceFolder: async (path: string) => {
    const { workspaceFolders } = get()
    if (workspaceFolders.includes(path)) return
    
    const newFolders = [...workspaceFolders, path]
    set({ workspaceFolders: newFolders })
    
    const fileTreeStore = useFileTreeStore.getState()
    await fileTreeStore.addRoot(path)
  },
  removeWorkspaceFolder: (path: string) => {
    const { workspaceFolders } = get()
    const newFolders = workspaceFolders.filter(f => f !== path)
    set({ workspaceFolders: newFolders })
  },
  saveWorkspaceFile: async () => {
    const { workspaceFolders } = get()
    if (workspaceFolders.length === 0) return

    const pathToSave = await promptWorkspacePath()
    if (!pathToSave) return

    const content = JSON.stringify({ version: 1, folders: workspaceFolders }, null, 2)
    
    try {
      const { writeFile } = await import('@/lib/tauri')
      await writeFile(pathToSave, content)
      
      await saveFolderHistory(pathToSave)
      set({ currentWorkspacePath: pathToSave })
    } catch (err) {
      set({ error: `Failed to save workspace: ${err}` })
    }
  },
  loadWorkspaceFile: async (workspacePath: string) => {
    set({ isLoading: true, error: null })
    try {
      const { readFile } = await import('@/lib/tauri')
      const content = await readFile(workspacePath)
      const workspace = JSON.parse(content)
      
      if (workspace.folders && Array.isArray(workspace.folders)) {
        set({ 
          workspaceFolders: workspace.folders,
          currentWorkspacePath: workspacePath,
          isLoading: false 
        })
        
        const fileTreeStore = useFileTreeStore.getState()
        fileTreeStore.clearAll()
        for (const folder of workspace.folders) {
          await fileTreeStore.addRoot(folder)
        }
      }
    } catch (err) {
      set({ error: `Failed to load workspace: ${err}`, isLoading: false })
    }
  },
  switchMode: async (mode: WorkspaceMode) => {
    const { workspaceMode } = useUIStore.getState()
    if (mode === workspaceMode) return

    useUIStore.getState().setWorkspaceMode(mode)
    await get().loadLatestByMode()
  },
  initMode: async () => {
    await useUIStore.getState().initWorkspaceMode()
  },
}))

async function promptWorkspacePath(): Promise<string | null> {
  const { saveWorkspaceFileDialog } = await import('@/lib/tauri')
  return await saveWorkspaceFileDialog('untitled.swallow-workspace')
}