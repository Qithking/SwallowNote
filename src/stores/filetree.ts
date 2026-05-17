/**
 * File Tree Store - Manages file tree state including nodes, expansion, and selection
 */
import { create } from 'zustand'
import { loadDirectory } from '@/lib/api'

export interface FileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isExpanded?: boolean
}

export interface FileTreeState {
  nodes: FileNode[]
  expanded: Set<string>
  selectedPath: string | null
  isLoading: boolean
  setNodes: (nodes: FileNode[]) => void
  setSelectedPath: (path: string | null) => void
  toggleNode: (path: string) => Promise<void>
  loadRoot: (rootPath: string) => Promise<void>
  addRoot: (rootPath: string) => Promise<void>
  removeRoot: (rootPath: string) => void
  revealPath: (filePath: string, rootPath: string) => Promise<void>
  clearAll: () => void
  clearExpanded: () => void
  restoreTreeState: (expandedPaths: string[], selectedPath: string | null) => void
  collapseAllExceptPath: (filePath: string) => void
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
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildren(n.children, path, children) }
    return n
  })
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  nodes: [],
  expanded: new Set(),
  selectedPath: null,
  isLoading: false,

  setNodes: (nodes) => set({ nodes }),

  setSelectedPath: (path) => set({ selectedPath: path }),

  toggleNode: async (path) => {
    const { nodes, expanded } = get()
    const newExpanded = new Set(expanded)

    if (newExpanded.has(path)) {
      newExpanded.delete(path)
      set({ expanded: newExpanded })
      return
    }

    newExpanded.add(path)

    // Load children if not loaded yet
    const node = findNodeInList(nodes, path)
    if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
      try {
        const children = await loadDirectory(path)
        set({
          nodes: updateNodesWithChildren(nodes, path, children),
          expanded: newExpanded,
        })
      } catch (e) {
        console.error(e)
        set({ expanded: newExpanded })
      }
    } else {
      set({ expanded: newExpanded })
    }
  },

  loadRoot: async (rootPath) => {
    if (!rootPath) {
      set({ nodes: [], expanded: new Set(), selectedPath: null })
      return
    }
    set({ isLoading: true })
    try {
      const data = await loadDirectory(rootPath)
      const rootNode: FileNode = {
        id: 'root',
        name: rootPath.split('/').pop() || rootPath,
        path: rootPath,
        isDirectory: true,
        children: data,
      }
      set({ nodes: [rootNode], expanded: new Set([rootPath]), isLoading: false })
    } catch (e) {
      console.error(e)
      set({ isLoading: false })
    }
  },

  addRoot: async (rootPath) => {
    if (!rootPath) return
    const { nodes, expanded } = get()
    const existingNode = findNodeInList(nodes, rootPath)
    if (existingNode) return

    try {
      const data = await loadDirectory(rootPath)
      const newNode: FileNode = {
        id: `root-${rootPath}`,
        name: rootPath.split('/').pop() || rootPath,
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

  revealPath: async (filePath, rootPath) => {
    if (!filePath || !rootPath) return

    const { nodes, expanded } = get()
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/'))

    // Always ensure direct parent is in expanded set
    const newExpanded = new Set(expanded)
    newExpanded.add(parentPath)

    // Check if we need to load children for any missing directories
    const relativePath = filePath.substring(rootPath.length + 1)
    const parts = relativePath.split('/')
    let currentPath = rootPath
    let currentNodes = nodes

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + '/' + parts[i]
      if (!newExpanded.has(currentPath)) {
        newExpanded.add(currentPath)
      }
      // Load children if directory not yet loaded
      const node = findNodeInList(currentNodes, currentPath)
      if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
        try {
          const children = await loadDirectory(currentPath)
          currentNodes = updateNodesWithChildren(currentNodes, currentPath, children)
        } catch (e) {
          console.error(e)
        }
      }
    }

    set({ nodes: currentNodes, expanded: newExpanded, selectedPath: filePath })

    // queueMicrotask runs after current stack + React render, after which DOM is updated
    queueMicrotask(() => requestAnimationFrame(() => scrollToFileElement(filePath)))
  },

  clearAll: () => set({ nodes: [], expanded: new Set(), selectedPath: null, isLoading: false }),
  clearExpanded: () => set({ expanded: new Set() }),
  restoreTreeState: (expandedPaths, selectedPath) =>
    set({ expanded: new Set(expandedPaths), selectedPath }),
  collapseAllExceptPath: (filePath) => {
    if (!filePath) {
      set({ expanded: new Set() })
      return
    }
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/'))
    const parts = parentPath.split('/')
    const expandedPaths = new Set<string>()
    let currentPath = ''
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
