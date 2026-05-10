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
  revealPath: (filePath: string, rootPath: string) => Promise<void>
  clearAll: () => void
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

  revealPath: async (filePath, rootPath) => {
    if (!filePath || !rootPath) return

    const { nodes, expanded } = get()
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/'))

    // If parent is already expanded, just set selectedPath + scroll
    if (expanded.has(parentPath)) {
      set({ selectedPath: filePath })
      // Scroll after DOM update
      requestAnimationFrame(() => scrollToFileElement(filePath))
      return
    }

    // Expand parent directories sequentially
    const relativePath = filePath.substring(rootPath.length + 1)
    const parts = relativePath.split('/')
    let currentPath = rootPath
    let newExpanded = new Set(expanded)
    let currentNodes = nodes

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + '/' + parts[i]

      if (!newExpanded.has(currentPath)) {
        newExpanded.add(currentPath)

        // Load children if not loaded yet
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
    }

    set({ nodes: currentNodes, expanded: newExpanded, selectedPath: filePath })

    // Scroll after DOM update
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToFileElement(filePath))
    })
  },

  clearAll: () => set({ nodes: [], expanded: new Set(), selectedPath: null, isLoading: false }),
}))

function scrollToFileElement(path: string) {
  const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null
  if (!el) return
  const container = el.closest('.overflow-auto') as HTMLElement | null
  if (!container) return
  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}
