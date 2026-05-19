/**
 * Workspace Store - Manages workspace state
 */
import { create } from 'zustand'
import { getLatestFolder, saveFolderHistory, getFolderHistory, scanGitRepos, watchDirectory, unwatchDirectory } from '@/lib/tauri'
import { useFileTreeStore } from './filetree'
import { useUIStore, WorkspaceMode } from './ui'
import { useEditorStore, EditorTab } from './editor'
import { useGitStore, mapRepoInfosToRepositories } from './git'

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
  removeWorkspaceFolder: (path: string) => Promise<void>
  saveWorkspaceFile: (autoSave?: boolean) => Promise<void>
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
      
      await watchDirectory(path)
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
      
      // 异步扫描并缓存 Git 仓库
      scanAndCacheGitRepos()
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
    
    await watchDirectory(path)
    
    await get().saveWorkspaceFile(true)
  },
  removeWorkspaceFolder: async (path: string) => {
    const { workspaceFolders } = get()
    const newFolders = workspaceFolders.filter(f => f !== path)
    set({ workspaceFolders: newFolders })
    
    await unwatchDirectory(path)
    
    await get().saveWorkspaceFile(true)
  },
  saveWorkspaceFile: async (autoSave = false) => {
    const { workspaceFolders, currentWorkspacePath } = get()
    if (workspaceFolders.length === 0) return

    let pathToSave = currentWorkspacePath
    if (!pathToSave && !autoSave) {
      pathToSave = await promptWorkspacePath()
    }
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
        await fileTreeStore.addRoots(workspace.folders)
        fileTreeStore.clearExpanded()
        
        for (const folder of workspace.folders) {
          await watchDirectory(folder)
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

    // 过滤不匹配的 tab
    const { filterTabs, activeTabId, tabs } = useEditorStore.getState()
    const state = get()
    if (mode === 'folder') {
      const rootPath = state.rootPath
      filterTabs((tab: EditorTab) => {
        if (!tab.path) return false
        if (!rootPath) return false
        return tab.path === rootPath || tab.path.startsWith(rootPath + '/')
      })
    } else {
      const workspaceFolders = state.workspaceFolders
      filterTabs((tab: EditorTab) => {
        if (!tab.path) return false
        if (!workspaceFolders || workspaceFolders.length === 0) return false
        return workspaceFolders.some(
          (f: string) => tab.path === f || tab.path.startsWith(f + '/')
        )
      })
      
      // 切换到工作区模式时，只展开当前 active tab 所在路径
      const activeTab = tabs.find(t => t.id === activeTabId)
      if (activeTab?.path) {
        const fileTreeStore = useFileTreeStore.getState()
        const folder = state.workspaceFolders.find((f: string) => activeTab.path.startsWith(f))
        if (folder) {
          fileTreeStore.collapseAllExceptPath(activeTab.path, folder)
        }
      }
    }
  },
  initMode: async () => {
    await useUIStore.getState().initWorkspaceMode()
  },
}))

async function promptWorkspacePath(): Promise<string | null> {
  const { saveWorkspaceFileDialog } = await import('@/lib/tauri')
  return await saveWorkspaceFileDialog('untitled.swallow-workspace')
}

async function scanAndCacheGitRepos() {
  try {
    const { workspaceMode } = useUIStore.getState()
    const { rootPath, workspaceFolders } = useWorkspaceStore.getState()
    const gitStore = useGitStore.getState()

    const scanPaths = workspaceMode === 'workspace'
      ? (workspaceFolders || [])
      : (rootPath ? [rootPath] : [])

    if (scanPaths.length === 0) {
      gitStore.setCachedRepositories([])
      return
    }

    gitStore.setScanProgress({ current: 0, total: scanPaths.length, message: '扫描中...' })

    const scanPromises = scanPaths.map(async (path, index) => {
      try {
        gitStore.setScanProgress({ current: index, total: scanPaths.length, message: `扫描 ${path}...` })
        const repos = await scanGitRepos(path)
        return repos
      } catch (e) {
        console.error(`Failed to scan git repos in ${path}:`, e)
        return []
      }
    })

    const results = await Promise.all(scanPromises)
    const allRepos = results.flat()

    const cachedRepos = mapRepoInfosToRepositories(allRepos)

    gitStore.setCachedRepositories(cachedRepos)
    gitStore.clearScanProgress()
  } catch (e) {
    console.error('Failed to scan and cache git repos:', e)
    useGitStore.getState().clearScanProgress()
  }
}