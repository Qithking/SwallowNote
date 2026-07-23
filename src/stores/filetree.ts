/**
 * File Tree Store - Manages file tree state including nodes, expansion, and selection
 */
import { create } from 'zustand'
import { loadDirectory, loadDirectoriesBatch } from '@/lib/api'
import { logger } from '@/lib/logger'
import { useUIStore } from './ui'
import { pathExists } from '@/lib/tauri'
import { updateNodesWithChildren, findNodeByPath } from '@/lib/utils/treeUtils'

// 正在加载的目录路径 → Promise（in-flight 去重）
const loadingPromises = new Map<string, ReturnType<typeof loadDirectory>>()

/** 去重包装：同一目录正在加载时直接返回同一 Promise，避免重复 IPC */
function loadDirectoryDedup(
  path: string,
  showAllFiles: boolean,
  markdownOnly: boolean
): ReturnType<typeof loadDirectory> {
  const existing = loadingPromises.get(path)
  if (existing) return existing
  const promise = loadDirectory(path, showAllFiles, markdownOnly)
    .finally(() => loadingPromises.delete(path))
  loadingPromises.set(path, promise)
  return promise
}

// refreshNode 防抖定时器（按 path 合并）
const refreshDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  refreshNodeDebounced: (path: string) => void
  refreshExpanded: () => Promise<void>
  revealPath: (filePath: string, rootPath: string) => Promise<void>
  clearAll: () => void
  clearExpanded: () => void
  restoreTreeState: (expandedPaths: string[], selectedPath: string | null) => Promise<void>
  collapseAllExceptPath: (filePath: string, rootPath?: string) => void
}

/** Mark a specific node as loading (or not loading) without touching children */
export function setNodeLoading(list: FileNode[], path: string, loading: boolean): FileNode[] {
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
      // 折叠时释放子节点以节省内存（展开时重载）
      const node = findNodeByPath(path, currentNodes)
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
    // 立即设置 expanded 提供视觉反馈
    set({ expanded: newExpanded })

    // 未加载 children 时加载（用最新状态）
    const { nodes } = get()
    const node = findNodeByPath(path, nodes)
    if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
      // 标记节点加载中，提供 UI 反馈
      set({ nodes: setNodeLoading(nodes, path, true) })
      try {
        const children = await loadDirectoryDedup(path, getFilterParams().showAllFiles, getFilterParams().markdownOnly)
        // 用 get().nodes 取最新状态，避免覆盖并发修改
        const currentNodes = get().nodes
        set({ nodes: updateNodesWithChildren(currentNodes, path, children) })
      } catch (e) {
        logger.error('filetree-store', 'toggleNode failed:', e)
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
          logger.warn('filetree-store', `Failed to load root directory, retrying (${currentRetry + 1}/${maxRetries}):`, rootPath)
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
      logger.error('filetree-store', 'Failed to load root directory after retries:', e)
      set({ isLoading: false })
      // Keep empty nodes to indicate loading failed
      set({ nodes: [], expanded: new Set() })
      return false
    }
  },

  addRoot: async (rootPath) => {
    if (!rootPath) return
    const { nodes, expanded } = get()
    const existingNode = findNodeByPath(rootPath, nodes)
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
      logger.error('filetree-store', 'addRoot failed:', e)
    }
  },

  addRoots: async (rootPaths): Promise<boolean> => {
    if (!rootPaths || rootPaths.length === 0) return false
    const { nodes, expanded } = get()
    
    // Filter out already-existing roots
    const pathsToLoad = rootPaths.filter(p => !findNodeByPath(p, nodes))
    if (pathsToLoad.length === 0) return true

    const filterParams = getFilterParams()

    // 并行加载新 root（batch API 适用于刷新已展开目录）
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
          logger.error('filetree-store', 'addRoots batch load failed:', e)
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

    const node = findNodeByPath(path, nodes)
    if (!node || !node.isDirectory) return

    const filterParams = getFilterParams()
    const tryLoad = async () => {
      const children = await loadDirectoryDedup(path, filterParams.showAllFiles, filterParams.markdownOnly)
      const currentNodes = get().nodes
      set({ nodes: updateNodesWithChildren(currentNodes, path, children) })
    }

    try {
      await tryLoad()
    } catch (e) {
      // 首次失败延迟 200ms 重试（应对网络盘/权限问题）
      logger.warn('filetree-store', 'refreshNode failed, retrying:', e)
      await new Promise(resolve => setTimeout(resolve, 200))
      try {
        await tryLoad()
      } catch (err) {
        logger.error('filetree-store', 'refreshNode retry failed:', err)
      }
    }
  },

  refreshNodeDebounced: (path) => {
    // 按 path 合并防抖（150ms），避免事件风暴
    const existing = refreshDebounceTimers.get(path)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      refreshDebounceTimers.delete(path)
      get().refreshNode(path)
    }, 150)
    refreshDebounceTimers.set(path, timer)
  },

  refreshExpanded: async () => {
    const { expanded, nodes } = get()
    const filterParams = getFilterParams()

    // 清理已删除 root 的残留路径，避免无效刷新
    const rootPaths = nodes.map(n => n.path)
    const validExpanded = new Set<string>()
    for (const path of expanded) {
      if (rootPaths.some(root => path === root || path.startsWith(root + '/'))) {
        validExpanded.add(path)
      }
    }
    if (validExpanded.size !== expanded.size) {
      set({ expanded: validExpanded })
    }

    // 收集树中实际存在的已展开目录路径
    const pathsToRefresh: string[] = []
    for (const path of validExpanded) {
      const node = findNodeByPath(path, nodes)
    if (node && node.isDirectory) {
        pathsToRefresh.push(path)
      }
    }

    if (pathsToRefresh.length === 0) return

    // 用 batch API 单次 IPC 加载所有目录
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
      logger.error('filetree-store', 'Batch refresh failed, falling back to sequential:', e)
      // 兜底：并行逐个刷新目录
      let currentNodes = get().nodes
      const individualResults = await Promise.all(
        pathsToRefresh.map(async (path) => {
          try {
            const children = await loadDirectory(path, filterParams.showAllFiles, filterParams.markdownOnly)
            return { path, children }
          } catch (err) {
            logger.error('filetree-store', 'refreshExpanded individual load failed:', err)
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

    // 文件不存在时不设置无效 selectedPath
    try {
      const exists = await pathExists(filePath)
      if (!exists) return
    } catch {
      // pathExists 失败时不阻塞，继续尝试 reveal
    }

    const { nodes, expanded } = get()

    const newExpanded = new Set(expanded)

    // Ensure root directory is expanded
    newExpanded.add(rootPath)

    // 检查是否需加载缺失目录的 children
    const relativePath = filePath.substring(rootPath.length + 1)
    const parts = relativePath.split('/')
    let currentPath = rootPath

    // 从 root 起收集需加载的目录
    const dirsToLoad: string[] = []

    // 检查 root 是否需加载（不在树中也需加载）
    const rootNode = findNodeByPath(rootPath, nodes)
    if (!rootNode || (rootNode.isDirectory && (!rootNode.children || rootNode.children.length === 0))) {
      dirsToLoad.push(rootPath)
    }

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + '/' + parts[i]
      newExpanded.add(currentPath)
      // 节点不在树中或 children 为空时需加载
      const node = findNodeByPath(currentPath, nodes)
      if (!node || (node.isDirectory && (!node.children || node.children.length === 0))) {
        dirsToLoad.push(currentPath)
      }
    }

    // 1. 先 set expanded（箭头视觉反馈，不等加载完成）
    set({ expanded: newExpanded })

    // 2. 批量加载，每个加载完立即 set
    if (dirsToLoad.length > 0) {
      const filterParams = getFilterParams()
      try {
        const results = await loadDirectoriesBatch(dirsToLoad, filterParams.showAllFiles, filterParams.markdownOnly)
        for (const result of results) {
          // 用 get().nodes 取最新状态，避免覆盖并发修改
          const latestNodes = get().nodes
          set({ nodes: updateNodesWithChildren(latestNodes, result.path, result.children) })
        }
      } catch (e) {
        logger.error('filetree-store', 'Batch load in revealPath failed, falling back:', e)
        // Fallback to sequential loading
        for (const dirPath of dirsToLoad) {
          const latestNodes = get().nodes
          const node = findNodeByPath(dirPath, latestNodes)
          if (!node || (node.isDirectory && (!node.children || node.children.length === 0))) {
            try {
              const children = await loadDirectoryDedup(dirPath, filterParams.showAllFiles, filterParams.markdownOnly)
              set({ nodes: updateNodesWithChildren(get().nodes, dirPath, children) })
            } catch (err) {
              logger.error('filetree-store', 'revealPath sequential load failed:', err)
            }
          }
        }
      }
    }

    // 3. 最后 set selectedPath 并滚动
    set({ selectedPath: filePath })

    // 微任务在 React 渲染后执行，此时 DOM 已更新
    queueMicrotask(() => requestAnimationFrame(() => scrollToFileElement(filePath)))
  },

  clearAll: () => {
    // 清理 pending 防抖定时器，避免 clearAll 后误触发
    for (const timer of refreshDebounceTimers.values()) {
      clearTimeout(timer)
    }
    refreshDebounceTimers.clear()
    set({ nodes: [], expanded: new Set(), selectedPath: null, multiSelectedPaths: new Set(), lastClickedPath: null, isLoading: false })
  },
  clearExpanded: () => set({ expanded: new Set() }),
  restoreTreeState: async (expandedPaths, selectedPath) => {
    set({ expanded: new Set(expandedPaths), selectedPath })

    if (expandedPaths.length === 0) return

    // 按深度排序，浅层优先，确保父目录先加载
    const sortedPaths = [...expandedPaths].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    )

    const filterParams = getFilterParams()
    let currentNodes = get().nodes

    // 按深度分组，同深度批量加载
    const depthGroups = new Map<number, string[]>()
    for (const dirPath of sortedPaths) {
      const depth = dirPath.split('/').length
      if (!depthGroups.has(depth)) depthGroups.set(depth, [])
      depthGroups.get(depth)!.push(dirPath)
    }

    // 逐层处理，层内并行加载
    for (const [, dirPaths] of [...depthGroups.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      // 仅加载树中存在且未加载 children 的目录
      const dirsToLoad: string[] = []
      for (const dirPath of dirPaths) {
        const node = findNodeByPath(dirPath, currentNodes)
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
        logger.error('filetree-store', 'Batch load in restoreTreeState failed, falling back:', e)
        for (const dirPath of dirsToLoad) {
          const node = findNodeByPath(dirPath, currentNodes)
          if (node && node.isDirectory && (!node.children || node.children.length === 0)) {
            try {
              const children = await loadDirectory(
                dirPath,
                filterParams.showAllFiles,
                filterParams.markdownOnly,
              )
              currentNodes = updateNodesWithChildren(currentNodes, dirPath, children)
            } catch (err) {
              logger.error('filetree-store', 'restoreTreeState sequential load failed:', err)
            }
          }
        }
      }

      // 每层完成后更新 store，便于下层发现新节点
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
  // 用 data 属性定位文件树滚动容器
  const container = document.querySelector('[data-file-tree-scroll]')
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
