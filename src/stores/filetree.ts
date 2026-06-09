/**
 * File Tree Store - Manages file tree state including nodes, expansion, and selection
 */
import { create } from 'zustand'
import { loadDirectory, loadDirectoriesBatch } from '@/lib/api'
import { useUIStore } from './ui'

export interface FileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isExpanded?: boolean
  isLoading?: boolean
}

export interface FileTreeState {
  nodes: FileNode[]
  expanded: Set<string>
  selectedPath: string | null
  multiSelectedPaths: Set<string>
  lastClickedPath: string | null
  isLoading: boolean
  setNodes: (nodes: FileNode[]) => void
  setSelectedPath: (path: string | null) => void
  setMultiSelectedPaths: (paths: Set<string>) => void
  setLastClickedPath: (path: string | null) => void
  clearMultiSelection: () => void
  toggleNode: (path: string) => Promise<void>
  loadRoot: (rootPath: string, retryCount?: number) => Promise<boolean>
  addRoot: (rootPath: string) => Promise<void>
  addRoots: (rootPaths: string[]) => Promise<boolean>
  removeRoot: (rootPath: string) => void
  refreshNode: (path: string) => Promise<void>
  refreshExpanded: () => Promise<void>
  revealPath: (filePath: string, rootPath: string) => Promise<void>
  clearAll: () => void
  clearExpanded: () => void
  restoreTreeState: (expandedPaths: string[], selectedPath: string | null) => Promise<void>
  collapseAllExceptPath: (filePath: string, rootPath?: string) => void
}

function findNodeInList(list: FileNode[], path: string): FileNode | null {
  for (const n of list) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNodeInList(n.children, path)
      if (found) return found
    }
  }
  return null
}

function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) {
      // Skip creating a new object if children reference is already the same
      if (n.children === children && !n.isLoading) return n
      return { ...n, children, isLoading: false }
    }
    if (n.children) {
      const updatedChildren = updateNodesWithChildren(n.children, path, children)
      // Skip creating a new object if no child was actually updated
      if (updatedChildren === n.children) return n
      return { ...n, children: updatedChildren }
    }
    return n
  })
}

/** Mark a specific node as loading (or not loading) without touching children */
function setNodeLoading(list: FileNode[], path: string, loading: boolean): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, isLoading: loading }
    if (n.children) return { ...n, children: setNodeLoading(n.children, path, loading) }
    return n
  })
}

function getFilterParams() {
  const { showAllFiles, markdownOnly } = useUIStore.getState()
  return { showAllFiles, markdownOnly }
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  nodes: [],
  expanded: new Set(),
  selectedPath: null,
  multiSelectedPaths: new Set(),
  lastClickedPath: null,
  isLoading: false,

  setNodes: (nodes) => set({ nodes }),

  setSelectedPath: (path) => set({ selectedPath: path }),

  setMultiSelectedPaths: (paths) => set({ multiSelectedPaths: paths }),

  setLastClickedPath: (path) => set({ lastClickedPath: path }),

  clearMultiSelection: () => set({ multiSelectedPaths: new Set() }),

  toggleNode: async (path) => {
    const { expanded, nodes: currentNodes } = get()
    const newExpanded = new Set(expanded)

    if (newExpanded.has(path)) {
      newExpanded.delete(path)
      // Release children of collapsed directories to save memory
      // Children will be reloaded on next expand
      const node = findNodeInList(currentNodes, path)
      if (node && node.isDirectory && node.children && node.children.length > 0) {
        set({
          expanded: newExpanded,
          nodes: updateNodesWithChildren(currentNodes, path, []),
        })
      } else {
        set({ expanded: newExpanded })
      }
      return
    }

    newExpanded.add(path)
    // Set expanded immediately so the user sees visual feedback (arrow rotation)
    set({ expanded: newExpanded })

    // Load children if not loaded yet (use latest state after setting expanded)
    const { nodes } = get()
    const node = findNodeInList(nodes, path)
    if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
      // Mark this node as loading for UI feedback
      set({ nodes: setNodeLoading(nodes, path, true) })
      try {
        const children = await loadDirectory(path, getFilterParams().showAllFiles, getFilterParams().markdownOnly)
        // Use get().nodes to get the latest state after async operation,
        // preventing stale state from overwriting concurrent changes
        const currentNodes = get().nodes
        set({ nodes: updateNodesWithChildren(currentNodes, path, children) })
      } catch (e) {
        console.error(e)
        // Clear loading state on error
        const currentNodes = get().nodes
        set({ nodes: setNodeLoading(currentNodes, path, false) })
      }
    }
  },

  loadRoot: async (rootPath, retryCount = 0): Promise<boolean> => {
    if (!rootPath) {
      set({ nodes: [], expanded: new Set(), selectedPath: null })
      return false
    }
    set({ isLoading: true })
    
    const maxRetries = 2
    const retryDelay = 500 // ms
    
    const tryLoadDirectory = async (currentRetry = retryCount): Promise<FileNode[]> => {
      try {
        return await loadDirectory(rootPath, getFilterParams().showAllFiles, getFilterParams().markdownOnly)
      } catch (e) {
        if (currentRetry < maxRetries) {
          console.warn(`Failed to load root directory, retrying (${currentRetry + 1}/${maxRetries}):`, rootPath)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return tryLoadDirectory(currentRetry + 1)
        }
        throw e
      }
    }
    
    try {
      const data = await tryLoadDirectory()
      const rootNode: FileNode = {
        id: 'root',
        name: rootPath.split(/[\\/]/).pop() || rootPath,
        path: rootPath,
        isDirectory: true,
        children: data,
      }
      set({ nodes: [rootNode], expanded: new Set([rootPath]), isLoading: false })
      return true
    } catch (e) {
      console.error('Failed to load root directory after retries:', e)
      set({ isLoading: false })
      // Keep empty nodes to indicate loading failed
      set({ nodes: [], expanded: new Set() })
      return false
    }
  },

  addRoot: async (rootPath) => {
    if (!rootPath) return
    const { nodes, expanded } = get()
    const existingNode = findNodeInList(nodes, rootPath)
    if (existingNode) return

    try {
      const data = await loadDirectory(rootPath, getFilterParams().showAllFiles, getFilterParams().markdownOnly)
      const newNode: FileNode = {
        id: `root-${rootPath}`,
        name: rootPath.split(/[\\/]/).pop() || rootPath,
        path: rootPath,
        isDirectory: true,
        children: data,
      }
      set({ 
        nodes: [...nodes, newNode], 
        expanded: new Set([...expanded, rootPath]) 
      })
    } catch (e) {
      console.error(e)
    }
  },

  addRoots: async (rootPaths): Promise<boolean> => {
    if (!rootPaths || rootPaths.length === 0) return false
    const { nodes, expanded } = get()
    
    // Filter out already-existing roots
    const pathsToLoad = rootPaths.filter(p => !findNodeInList(nodes, p))
    if (pathsToLoad.length === 0) return true

    const filterParams = getFilterParams()

    // Load all new roots in parallel using individual loadDirectory calls
    // (batch API is optimized for refreshing existing expanded directories)
    const results = await Promise.all(
      pathsToLoad.map(async (rootPath) => {
        try {
          const data = await loadDirectory(rootPath, filterParams.showAllFiles, filterParams.markdownOnly)
          return {
            node: {
              id: `root-${rootPath}`,
              name: rootPath.split(/[\\/]/).pop() || rootPath,
              path: rootPath,
              isDirectory: true,
              children: data,
            } as FileNode,
            path: rootPath,
          }
        } catch (e) {
          console.error(e)
          return null
        }
      })
    )

    const newNodes = [...nodes]
    const newExpanded = new Set(expanded)
    let anySuccess = false
    for (const result of results) {
      if (result) {
        newNodes.push(result.node)
        newExpanded.add(result.path)
        anySuccess = true
      }
    }
    
    set({ nodes: newNodes, expanded: newExpanded })
    return anySuccess
  },

  removeRoot: (rootPath) => {
    const { nodes, expanded, selectedPath } = get()
    const newNodes = nodes.filter(n => n.path !== rootPath)
    const newExpanded = new Set(expanded)
    newExpanded.delete(rootPath)
    
    let newSelectedPath = selectedPath
    if (selectedPath && selectedPath.startsWith(rootPath)) {
      newSelectedPath = null
    }
    
    set({ nodes: newNodes, expanded: newExpanded, selectedPath: newSelectedPath })
  },

  refreshNode: async (path) => {
    const { nodes, expanded } = get()
    if (!expanded.has(path)) return

    const node = findNodeInList(nodes, path)
    if (!node || !node.isDirectory) return

    try {
      const children = await loadDirectory(path, getFilterParams().showAllFiles, getFilterParams().markdownOnly)
      const currentNodes = get().nodes
      set({ nodes: updateNodesWithChildren(currentNodes, path, children) })
    } catch (e) {
      console.error(e)
    }
  },

  refreshExpanded: async () => {
    const { expanded, nodes } = get()
    const filterParams = getFilterParams()

    // Collect paths of expanded directories that actually exist in the tree
    const pathsToRefresh: string[] = []
    for (const path of expanded) {
      const node = findNodeInList(nodes, path)
      if (node && node.isDirectory) {
        pathsToRefresh.push(path)
      }
    }

    if (pathsToRefresh.length === 0) return

    // Use batch API to load all directories in a single IPC call
    // This is significantly faster than N separate IPC calls
    try {
      const results = await loadDirectoriesBatch(
        pathsToRefresh,
        filterParams.showAllFiles,
        filterParams.markdownOnly,
      )
      let currentNodes = get().nodes
      for (const result of results) {
        currentNodes = updateNodesWithChildren(currentNodes, result.path, result.children)
      }
      set({ nodes: currentNodes })
    } catch (e) {
      console.error('Batch refresh failed, falling back to sequential:', e)
      // Fallback: refresh directories individually in parallel
      let currentNodes = get().nodes
      const individualResults = await Promise.all(
        pathsToRefresh.map(async (path) => {
          try {
            const children = await loadDirectory(path, filterParams.showAllFiles, filterParams.markdownOnly)
            return { path, children }
          } catch (err) {
            console.error(err)
            return null
          }
        })
      )
      for (const result of individualResults) {
        if (result) {
          currentNodes = updateNodesWithChildren(currentNodes, result.path, result.children)
        }
      }
      set({ nodes: currentNodes })
    }
  },

  revealPath: async (filePath, rootPath) => {
    if (!filePath || !rootPath) return

    const { nodes, expanded } = get()

    const newExpanded = new Set(expanded)

    // Ensure root directory is expanded
    newExpanded.add(rootPath)

    // Check if we need to load children for any missing directories
    const relativePath = filePath.substring(rootPath.length + 1)
    const parts = relativePath.split('/')
    let currentPath = rootPath
    let currentNodes = nodes

    // Collect directories that need loading, starting from root
    const dirsToLoad: string[] = []

    // Check if root directory needs loading
    const rootNode = findNodeInList(currentNodes, rootPath)
    if (rootNode && rootNode.isDirectory && (!rootNode.children || rootNode.children.length === 0)) {
      dirsToLoad.push(rootPath)
    }

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + '/' + parts[i]
      if (!newExpanded.has(currentPath)) {
        newExpanded.add(currentPath)
      }
      // Check if directory needs loading
      const node = findNodeInList(currentNodes, currentPath)
      if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
        dirsToLoad.push(currentPath)
      }
    }

    // Batch-load all directories that need children
    if (dirsToLoad.length > 0) {
      const filterParams = getFilterParams()
      try {
        const results = await loadDirectoriesBatch(dirsToLoad, filterParams.showAllFiles, filterParams.markdownOnly)
        for (const result of results) {
          currentNodes = updateNodesWithChildren(currentNodes, result.path, result.children)
        }
      } catch (e) {
        console.error('Batch load in revealPath failed, falling back:', e)
        // Fallback to sequential loading
        for (const dirPath of dirsToLoad) {
          const node = findNodeInList(currentNodes, dirPath)
          if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
            try {
              const children = await loadDirectory(dirPath, filterParams.showAllFiles, filterParams.markdownOnly)
              currentNodes = updateNodesWithChildren(currentNodes, dirPath, children)
            } catch (err) {
              console.error(err)
            }
          }
        }
      }
    }

    set({ nodes: currentNodes, expanded: newExpanded, selectedPath: filePath })

    // queueMicrotask runs after current stack + React render, after which DOM is updated
    queueMicrotask(() => requestAnimationFrame(() => scrollToFileElement(filePath)))
  },

  clearAll: () => set({ nodes: [], expanded: new Set(), selectedPath: null, multiSelectedPaths: new Set(), lastClickedPath: null, isLoading: false }),
  clearExpanded: () => set({ expanded: new Set() }),
  restoreTreeState: async (expandedPaths, selectedPath) => {
    set({ expanded: new Set(expandedPaths), selectedPath })

    if (expandedPaths.length === 0) return

    // Sort expanded paths by depth so we expand shallow directories first.
    // This is critical because a deeper path like /a/b/c can only be found
    // in the tree *after* its parent /a/b has been loaded.  By processing
    // level-by-level we guarantee that every directory node is discoverable
    // when we need to load its children.
    const sortedPaths = [...expandedPaths].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    )

    const filterParams = getFilterParams()
    let currentNodes = get().nodes

    // Group paths by depth so we can batch-load all directories at the same
    // depth in a single IPC call, parallelising across directories.
    const depthGroups = new Map<number, string[]>()
    for (const dirPath of sortedPaths) {
      const depth = dirPath.split('/').length
      if (!depthGroups.has(depth)) depthGroups.set(depth, [])
      depthGroups.get(depth)!.push(dirPath)
    }

    // Process each depth level sequentially; within a level all directories
    // are loaded in parallel via loadDirectoriesBatch.
    for (const [, dirPaths] of [...depthGroups.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      // Filter to only directories that exist in the tree AND don't have
      // children loaded yet.  After each depth level is processed, the nodes
      // for the next level will be discoverable.
      const dirsToLoad: string[] = []
      for (const dirPath of dirPaths) {
        const node = findNodeInList(currentNodes, dirPath)
        if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
          dirsToLoad.push(dirPath)
        }
      }

      if (dirsToLoad.length === 0) continue

      try {
        const results = await loadDirectoriesBatch(
          dirsToLoad,
          filterParams.showAllFiles,
          filterParams.markdownOnly,
        )
        for (const result of results) {
          currentNodes = updateNodesWithChildren(currentNodes, result.path, result.children)
        }
      } catch (e) {
        console.error('Batch load in restoreTreeState failed, falling back:', e)
        for (const dirPath of dirsToLoad) {
          const node = findNodeInList(currentNodes, dirPath)
          if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
            try {
              const children = await loadDirectory(
                dirPath,
                filterParams.showAllFiles,
                filterParams.markdownOnly,
              )
              currentNodes = updateNodesWithChildren(currentNodes, dirPath, children)
            } catch (err) {
              console.error(err)
            }
          }
        }
      }

      // Update the store after each depth level so that the next level can
      // discover newly-loaded child nodes, and the UI renders progressively.
      set({ nodes: currentNodes })
    }
  },
  collapseAllExceptPath: (filePath, rootPath) => {
    if (!filePath) {
      set({ expanded: new Set() })
      return
    }
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/'))
    const pathToExpand = rootPath && parentPath.startsWith(rootPath)
      ? parentPath.substring(rootPath.length + 1)
      : parentPath
    const parts = pathToExpand.split('/')
    const expandedPaths = new Set<string>()
    // Always expand root directory
    if (rootPath) {
      expandedPaths.add(rootPath)
    }
    let currentPath = rootPath || ''
    for (const part of parts) {
      if (!part) continue
      currentPath = currentPath ? `${currentPath}/${part}` : part
      expandedPaths.add(currentPath)
    }
    set({ expanded: expandedPaths })
  },
}))

function scrollToFileElement(path: string) {
  const container = document.querySelector('.overflow-auto')
  if (!container) return

  const tryScroll = () => {
    const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null
    if (!el) return false
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    return true
  }

  // If element already exists, scroll immediately
  if (tryScroll()) return

  // Otherwise observe until it appears in DOM
  const observer = new MutationObserver(() => {
    if (tryScroll()) observer.disconnect()
  })
  observer.observe(container, { childList: true, subtree: true })

  // Safety disconnect after 3s
  setTimeout(() => observer.disconnect(), 3000)
}
