/**
 * FileTreeView — 文件树视图组件（纯渲染层）
 * 操作逻辑已提取到：
 *   - useFileTreeActions  (重命名/新建/删除)
 *   - useFileTreeDragDrop (拖拽)
 * 工具函数来自 @/lib/utils/treeUtils
 */
import { useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { FilePlus, FolderPlus, Folder, FolderOpen, RefreshCw, ChevronRight, Save, Loader2, Pin, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { useUIStore } from '@/stores/ui'
import { loadFileContent } from '@/lib/api'
import { openFolderDialog } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'
import { TreeNodeContextMenu } from './FileTreeContextMenu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getFileIcon } from '@/lib/utils/fileIcon'
import { useTranslation } from 'react-i18next'
import { dispatchBuiltin } from '@/hooks/useKeyboardShortcuts'
import { useFileTreeActions } from '@/hooks/useFileTreeActions'
import { useFileTreeDragDrop } from '@/hooks/useFileTreeDragDrop'
import { findNodeByPath, collectAllPaths } from '@/lib/utils/treeUtils'
import { countWords } from '@/lib/utils/wordCount'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { ContextMenuContent } from '@/components/ui/context-menu'
import { PluginContextMenuItems } from '@/components/Plugin/PluginContextMenuItems'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getFileFrontmatter, getFileFrontmattersByPrefix } from '@/lib/utils/searchQuery'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'

export type FileTreeSortMode = 'default' | 'updated-desc' | 'title-asc'

// 扁平化的树节点，用于虚拟化
interface FlattenedNode {
  node: FileNode
  depth: number
  isLastInParent?: boolean
  isPinned?: boolean
  isPinnedSeparator?: boolean
}

// Sort file nodes within a directory based on sort mode and frontmatter cache
function sortFileNodes(
  nodes: FileNode[],
  sortMode: FileTreeSortMode,
  frontmatterCache: Map<string, NoteFrontmatter>,
): FileNode[] {
  if (sortMode === 'default') return nodes

  // Separate directories and files
  const dirs = nodes.filter(n => n.isDirectory)
  const files = nodes.filter(n => !n.isDirectory)

  const sortedFiles = [...files].sort((a, b) => {
    const fmA = frontmatterCache.get(a.path)
    const fmB = frontmatterCache.get(b.path)

    if (sortMode === 'updated-desc') {
      const dateA = fmA?.updated ? new Date(fmA.updated).getTime() : 0
      const dateB = fmB?.updated ? new Date(fmB.updated).getTime() : 0
      return dateB - dateA
    }

    if (sortMode === 'title-asc') {
      const titleA = fmA?.title || a.name.replace(/\.md$/i, '')
      const titleB = fmB?.title || b.name.replace(/\.md$/i, '')
      return titleA.localeCompare(titleB)
    }

    return 0
  })

  // Directories always come first, then sorted files
  return [...dirs, ...sortedFiles]
}

// 将嵌套的文件树扁平化为列表
function flattenNodes(
  nodes: FileNode[],
  expanded: Set<string>,
  newItem: { parentPath: string; type: string; name: string } | null,
  sortMode: FileTreeSortMode,
  frontmatterCache: Map<string, NoteFrontmatter>,
  depth = 0
): FlattenedNode[] {
  const result: FlattenedNode[] = []

  // Sort nodes at this level
  const sortedNodes = sortFileNodes(nodes, sortMode, frontmatterCache)

  // Separate pinned files from the rest.
  // In all sort modes (including 'default') we check frontmatterCache for
  // pinned status so that pinned files are grouped at the top.
  const pinnedNodes: FileNode[] = []
  const unpinnedNodes: FileNode[] = []

  for (const node of sortedNodes) {
    if (node.isDirectory) {
      unpinnedNodes.push(node)
    } else {
      const fm = frontmatterCache.get(node.path)
      if (fm?.pinned === true) {
        pinnedNodes.push(node)
      } else {
        unpinnedNodes.push(node)
      }
    }
  }

  // Render pinned nodes first with pinned flag
  for (const node of pinnedNodes) {
    result.push({ node, depth, isPinned: true })
    if (node.isDirectory && expanded.has(node.path) && node.children) {
      result.push(...flattenNodes(node.children, expanded, newItem, sortMode, frontmatterCache, depth + 1))
    }
  }

  // Add separator if there are both pinned and unpinned files
  if (pinnedNodes.length > 0 && unpinnedNodes.length > 0) {
    result.push({
      node: { id: 'pinned-separator', name: '', path: 'pinned-separator', isDirectory: false },
      depth,
      isPinnedSeparator: true,
    })
  }

  // Render unpinned nodes
  for (let i = 0; i < unpinnedNodes.length; i++) {
    const node = unpinnedNodes[i]
    result.push({ node, depth, isLastInParent: i === unpinnedNodes.length - 1 })
    if (node.isDirectory && expanded.has(node.path) && node.children) {
      result.push(...flattenNodes(node.children, expanded, newItem, sortMode, frontmatterCache, depth + 1))
      // 在子节点末尾添加新增输入框虚拟节点
      if (newItem && newItem.parentPath === node.path) {
        result.push({
          node: { id: 'new-item', name: newItem.name, path: 'new-item', isDirectory: false },
          depth: depth + 1,
          isLastInParent: true,
        })
      }
    }
  }

  // 根目录未展开或子节点为空时，新增输入框作为根节点的虚拟子节点
  if (depth === 0 && newItem) {
    const rootNode = nodes.find(n => n.path === newItem.parentPath)
    if (rootNode && (!expanded.has(rootNode.path) || !rootNode.children || rootNode.children.length === 0)) {
      result.push({
        node: { id: 'new-item', name: newItem.name, path: 'new-item', isDirectory: false },
        depth: 1,
        isLastInParent: true,
      })
    }
  }
  return result
}

// 单个树节点组件 - 使用 memo 优化
const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  isEditing,
  isSelected,
  isMultiSelected,
  isDragOver,
  isDragging,
  isPinned,
  isExpanded,
  editingName,
  newItem,
  inputRef,
  onSelect,
  onToggle,
  onStartEdit,
  onNewItem,
  onFinishEdit,
  onCancelEdit,
  onFinishNewItem,
  onCancelNewItem,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  setEditingName,
  setNewItem,
}: {
  node: FileNode
  depth: number
  isEditing: boolean
  isSelected: boolean
  isMultiSelected: boolean
  isDragOver: boolean
  isDragging: boolean
  isPinned?: boolean
  isExpanded: boolean
  editingName: string
  newItem: { type: 'file' | 'folder' | 'mindmap'; parentPath: string; name: string } | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (node: FileNode, shiftKey: boolean) => void
  onToggle: (path: string) => void
  onStartEdit: (path: string, name: string, isDirectory: boolean) => void
  onNewItem: (type: 'file' | 'folder' | 'mindmap', parentPath?: string) => void
  onFinishEdit: () => void
  onCancelEdit: () => void
  onFinishNewItem: () => void
  onCancelNewItem: () => void
  onDragStart: (e: React.DragEvent, node: FileNode) => void
  onDragOver: (e: React.DragEvent, node: FileNode) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, node: FileNode) => void
  onDragEnd: (e: React.DragEvent) => void
  setEditingName: (name: string) => void
  setNewItem: (item: { type: 'file' | 'folder' | 'mindmap'; parentPath: string; name: string } | null) => void
}) {
  // 新增输入框虚拟节点
  if (node.id === 'new-item' && newItem) {
    return (
      <div
        className="flex items-center h-[22px] gap-1 text-xs text-[var(--text-secondary)]"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-[14px]" />
        {newItem.type === 'folder' ? (
          <Folder size={12} className="text-[#666666]" />
        ) : newItem.type === 'mindmap' ? (
          getFileIcon(newItem.name || 'newfile.smm')
        ) : (
          getFileIcon(newItem.name || 'newfile')
        )}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-xs text-[var(--text-primary)]"
          value={newItem.name}
          onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
          onBlur={onFinishNewItem}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onFinishNewItem() }
            else if (e.key === 'Escape') { onCancelNewItem() }
          }}
        />
      </div>
    )
  }

  // 正常节点
  const nodeContent = (
    <div
      data-path={node.path}
      className={`flex items-center h-[22px] cursor-pointer select-none gap-1 text-xs ${
        isEditing || isSelected ? 'bg-primary/10 text-[var(--text-primary)]'
        : isDragOver ? 'bg-primary/20 text-[var(--text-primary)] border-l-2 border-l-primary'
        : isMultiSelected ? 'bg-primary/5 text-[var(--text-primary)]'
        : isDragging ? 'opacity-50 text-[var(--text-secondary)]'
        : isPinned ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border-l-2 border-l-[var(--theme-color)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={(e) => !isEditing && onSelect(node, e.shiftKey)}
    >
      {node.isDirectory ? (
        node.isLoading ? (
          <Loader2 size={12} className="animate-spin shrink-0" />
        ) : (
          <ChevronRight
            size={12}
            className={`transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle(node.path) }}
          />
        )
      ) : (
        <span className="w-[14px] shrink-0" />
      )}
      {node.isDirectory ? (
        <Folder size={12} className="text-[#666666] shrink-0" />
      ) : (
        <span className="shrink-0 flex items-center justify-center w-3 h-3">{getFileIcon(node.name)}</span>
      )}
      {isPinned && !node.isDirectory && (
        <Pin size={10} className="shrink-0" style={{ color: 'var(--theme-color)' }} />
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-xs text-[var(--text-primary)]"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={onFinishEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onFinishEdit() }
            else if (e.key === 'Escape') { onCancelEdit() }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate">{node.name}</span>
      )}
    </div>
  )

  return (
    <div
      data-tree-node="true"
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, node)}
      onDragOver={(e) => onDragOver(e, node)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, node)}
      onDragEnd={onDragEnd}
      // Stop the contextmenu event from bubbling to the outer
      // ScrollArea trigger (fileTreeEmpty) so per-node and empty-area
      // menus don't both open on the same right-click. Use the native
      // event because Radix registers its listener via
      // addEventListener, which sits below React's synthetic handler.
      onContextMenu={(e) => e.nativeEvent.stopImmediatePropagation()}
    >
      <TreeNodeContextMenu
        node={node}
        onRename={() => onStartEdit(node.path, node.name, node.isDirectory)}
        onNewFile={() => onNewItem('file', node.path)}
        onNewFolder={() => onNewItem('folder', node.path)}
        onNewMindMap={() => onNewItem('mindmap', node.path)}
      >
        {nodeContent}
      </TreeNodeContextMenu>
    </div>
  )
})

export const FileTreeView = memo(function FileTreeView() {
  const addWorkspaceFolder = useWorkspaceStore((s) => s.addWorkspaceFolder)
  const saveWorkspaceFile = useWorkspaceStore((s) => s.saveWorkspaceFile)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const addTab = useEditorStore((s) => s.addTab)
  const nodes = useFileTreeStore((s) => s.nodes)
  const expanded = useFileTreeStore((s) => s.expanded)
  const selectedPath = useFileTreeStore((s) => s.selectedPath)
  const isLoading = useFileTreeStore((s) => s.isLoading)
  const setSelectedPath = useFileTreeStore((s) => s.setSelectedPath)
  const toggleNode = useFileTreeStore((s) => s.toggleNode)
  const multiSelectedPaths = useFileTreeStore((s) => s.multiSelectedPaths)
  const setMultiSelectedPaths = useFileTreeStore((s) => s.setMultiSelectedPaths)
  const lastClickedPath = useFileTreeStore((s) => s.lastClickedPath)
  const setLastClickedPath = useFileTreeStore((s) => s.setLastClickedPath)
const clearMultiSelection = useFileTreeStore((s) => s.clearMultiSelection)
const { t } = useTranslation()

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sortMode, setSortMode] = useState<FileTreeSortMode>('default')
  const [frontmatterCache, setFrontmatterCache] = useState<Map<string, NoteFrontmatter>>(new Map())
  // Ref to read the latest cache inside async without re-triggering the effect.
  const frontmatterCacheRef = useRef(frontmatterCache)
  frontmatterCacheRef.current = frontmatterCache
  // Track the set of visible .md paths from the last run so we can skip
  // the batch IPC query entirely when nothing changed (e.g. toggling
  // loading state, expanding a dir with only subdirectories, collapsing).
  const lastMdPathsRef = useRef<Set<string>>(new Set())
  // Track which root paths have already been batch-queried. The batch
  // query (query_frontmatter_by_prefix) returns ALL .md records under a
  // root, including files in unexpanded directories. Re-running it on
  // every directory expansion within the same root is wasteful — the
  // result is identical. We only need to batch-query when a NEW root is
  // added; for subsequent expansions we rely on the cache + individual
  // fallback for any newly visible uncached files.
  const queriedRootsRef = useRef<Set<string>>(new Set())

  // Load frontmatter for all .md files when the tree changes.
  //
  // Performance strategy:
  // 1. Collect visible .md paths; if unchanged from last run, skip entirely
  //    (no IPC, no state update, no re-render).
  // 2. If root paths changed (new root added), batch-query the new roots.
  //    Skip batch query for existing roots — their data is already cached.
  // 3. Fallback: individually load frontmatter for visible .md files not
  //    yet in the cache (newly expanded directories, unindexed files).
  // 4. Only call setFrontmatterCache if something actually changed.
  useEffect(() => {
    if (nodes.length === 0) return

    // Collect visible .md file paths from the current tree
    const collectMdPaths = (fileNodes: FileNode[]): string[] => {
      const paths: string[] = []
      for (const node of fileNodes) {
        if (!node.isDirectory && node.name.toLowerCase().endsWith('.md')) {
          paths.push(node.path)
        }
        if (node.children) {
          paths.push(...collectMdPaths(node.children))
        }
      }
      return paths
    }

    const mdPaths = collectMdPaths(nodes)
    const mdPathSet = new Set(mdPaths)

    // Early exit: if the set of visible .md paths hasn't changed since the
    // last run, there's nothing to do. This covers:
    //   - toggleNode setting isLoading (nodes ref changes, same .md paths)
    //   - expanding a directory with only subdirectories
    //   - collapsing a directory (children released, but paths were cached)
    const prevSet = lastMdPathsRef.current
    if (prevSet.size === mdPathSet.size) {
      let same = true
      for (const p of mdPathSet) {
        if (!prevSet.has(p)) { same = false; break }
      }
      if (same) return
    }
    lastMdPathsRef.current = mdPathSet

    const rootPaths = nodes.map((n) => n.path)
    // Determine which roots need a fresh batch query.
    // Only NEW roots (not previously queried) need it — existing roots'
    // data is already in the cache and won't have changed.
    const rootsToQuery = rootPaths.filter((p) => !queriedRootsRef.current.has(p))
    // Clean up queriedRootsRef if a root was removed
    if (rootsToQuery.length > 0 || rootPaths.length !== queriedRootsRef.current.size) {
      const newRootSet = new Set(rootPaths)
      for (const r of queriedRootsRef.current) {
        if (!newRootSet.has(r)) queriedRootsRef.current.delete(r)
      }
      for (const r of rootsToQuery) queriedRootsRef.current.add(r)
    }

    let cancelled = false

    const loadFrontmatter = async () => {
      // Start from existing cache so we don't lose entries for paths
      // that the batch query doesn't return (e.g. not yet indexed).
      const cache = new Map(frontmatterCacheRef.current)
      let changed = false

      // 1. Batch query: ONLY for new roots. One IPC call per new root
      //    retrieves ALL indexed frontmatter records under that root.
      if (rootsToQuery.length > 0) {
        const batchResults = await Promise.all(
          rootsToQuery.map((p) => getFileFrontmattersByPrefix(p)),
        )
        if (cancelled) return

        for (const result of batchResults) {
          for (const [path, fm] of result) {
            cache.set(path, fm)
            changed = true
          }
        }
      }

      // 2. Fallback: individually load frontmatter for visible .md files
      //    not yet in the cache. This covers:
      //    - Files in newly expanded directories (not in batch query scope
      //      if the root was already queried but these files are new)
      //    - Files not yet indexed by the backend
      //    Usually very few (0-10).
      const uncachedPaths = mdPaths.filter((p) => !cache.has(p))

      if (uncachedPaths.length > 0) {
        const FALLBACK_BATCH = 10
        for (let i = 0; i < uncachedPaths.length; i += FALLBACK_BATCH) {
          if (cancelled) return
          const batch = uncachedPaths.slice(i, i + FALLBACK_BATCH)
          const results = await Promise.allSettled(
            batch.map((path) => getFileFrontmatter(path)),
          )
          if (cancelled) return
          for (let j = 0; j < results.length; j++) {
            const result = results[j]
            if (result.status === 'fulfilled') {
              cache.set(batch[j], result.value)
              changed = true
            }
          }
        }
      }

      // 3. Only update state if something actually changed — avoids
      //    unnecessary re-renders when the cache content is identical.
      if (changed && !cancelled) {
        setFrontmatterCache(cache)
      }
    }

    loadFrontmatter()
    return () => { cancelled = true }
  }, [nodes])

  // Refresh frontmatter cache when a file is saved
  useEffect(() => {
    const handleFileSaved = async (e: CustomEvent) => {
      const savedPath = e.detail?.path
      if (savedPath && savedPath.toLowerCase().endsWith('.md')) {
        // Remove from cache
        setFrontmatterCache(prev => {
          const next = new Map(prev)
          next.delete(savedPath)
          return next
        })
        // Re-fetch immediately so sort order stays correct
        try {
          const fm = await getFileFrontmatter(savedPath)
          setFrontmatterCache(prev => {
            const next = new Map(prev)
            next.set(savedPath, fm)
            return next
          })
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('file-saved', handleFileSaved as unknown as EventListener)
    return () => window.removeEventListener('file-saved', handleFileSaved as unknown as EventListener)
  }, [])

  // ── 操作逻辑（重命名/新建/删除）──
  const {
    inputRef,
    editingPath,
    editingName,
    setEditingName,
    newItem,
    setNewItem,
    handleStartEdit,
    handleFinishEdit,
    handleCancelEdit,
    handleNewItem,
    handleFinishNewItem,
    handleCancelNewItem,
    handleDeleteSelected,
  } = useFileTreeActions()

  // ── 空区域右键菜单（fileTreeEmpty）──
  // 节点自身已带 trigger；外层 trigger 接收不到节点区域的右键事件
  // （Radix 通过 capture 找到最近的 trigger 打开 menu）。
  // 我们不需要在空白区域做特殊处理——外层 trigger 监听 ScrollArea
  // 整体右键，节点 trigger 在子元素上优先触发，自然分流。

  // ── 拖拽逻辑 ──
  const {
    dragOverPath,
    dragSourcePaths,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useFileTreeDragDrop(nodes)

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await useFileTreeStore.getState().refreshExpanded()
    } catch (e) {
      console.error('Failed to refresh:', e)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Refs to access latest values inside stable callbacks, avoiding
  // unnecessary callback recreation when nodes/expanded change.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const handleSelect = useCallback((node: FileNode, shiftKey: boolean) => {
    if (editingPath !== null) return

    if (shiftKey && lastClickedPath) {
      const allPaths = collectAllPaths(nodesRef.current)
      const startIdx = allPaths.indexOf(lastClickedPath)
      const endIdx = allPaths.indexOf(node.path)
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        setMultiSelectedPaths(new Set(allPaths.slice(from, to + 1)))
        setSelectedPath(node.path)
        return
      }
    }

    clearMultiSelection()
    setSelectedPath(node.path)
    setLastClickedPath(node.path)

    if (node.isDirectory) {
      toggleNode(node.path)
      return
    }
    loadFileContent(node.path)
      .then((content) => {
        addTab({
          id: node.id,
          path: node.path,
          name: node.name,
          content,
          isDirty: false,
          isEdited: false,
          viewMode: 'preview',
          fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
          modifiedTime: new Date().toLocaleString(),
          wordCount: countWords(content),
        })
      })
      .catch(console.error)
  }, [editingPath, lastClickedPath, clearMultiSelection, setSelectedPath, setLastClickedPath, toggleNode, addTab, setMultiSelectedPaths])

  const handleOpenFolder = async () => {
    const path = await openFolderDialog()
    if (path) {
      if (workspaceMode === 'workspace') {
        await addWorkspaceFolder(path)
      } else {
        useWorkspaceStore.getState().openFolder(path)
      }
    }
  }

  // 键盘快捷键 (F2 重命名 / Delete 删除)
  // Uses dispatchBuiltin so plugin-command conflicts are detected
  // and surfaced to the user via toast (same as all other built-in
  // shortcuts).  dispatchBuiltin reads the latest customShortcuts
  // from the store internally, so we don't need customShortcuts in
  // the dependency array.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
        return
      }

      if (dispatchBuiltin(e, 'renameFile', () => {
        if (selectedPath) {
          const node = findNodeByPath(selectedPath, nodes)
          if (node) handleStartEdit(node.path, node.name, node.isDirectory)
        }
      })) return

      dispatchBuiltin(e, 'deleteFile', () => {
        handleDeleteSelected()
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPath, nodes, handleStartEdit, handleDeleteSelected])

  const isSelectedDirectory = selectedPath ? (findNodeByPath(selectedPath, nodes)?.isDirectory ?? false) : false

  // 扁平化节点用于虚拟化
  const flattenedNodes = useMemo(() => flattenNodes(nodes, expanded, newItem, sortMode, frontmatterCache), [nodes, expanded, newItem, sortMode, frontmatterCache])

  // 虚拟化配置
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none">
        <span className="text-sm font-medium">{t('fileTree.explorerTitle')}</span>
        <div className="flex items-center">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <ArrowUpDown size={12} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('fileTree.sort')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              }}
            >
              <DropdownMenuRadioGroup value={sortMode} onValueChange={(v) => setSortMode(v as FileTreeSortMode)}>
                <DropdownMenuRadioItem value="default">{t('fileTree.sortDefault')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="updated-desc">{t('fileTree.sortUpdatedDesc')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title-asc">{t('fileTree.sortTitleAsc')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleOpenFolder}>
                <FolderOpen size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{workspaceMode === 'workspace' ? t('fileTree.addToWorkspace') : t('fileTree.openFolder')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleNewItem('file')} disabled={!isSelectedDirectory}>
                <FilePlus size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('fileTree.newFile')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleNewItem('folder')} disabled={!isSelectedDirectory}>
                <FolderPlus size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('fileTree.newFolder')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('fileTree.refresh')}</TooltipContent>
          </Tooltip>
          {workspaceMode === 'workspace' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => saveWorkspaceFile()}>
                  <Save size={12} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('fileTree.saveWorkspace')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <ContextMenuPrimitive.Root>
        <ContextMenuPrimitive.Trigger asChild>
          <ScrollArea className="flex-1 py-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <RefreshCw size={16} className="animate-spin" />
              </div>
            ) : nodes.length > 0 ? (
              <div ref={parentRef} data-file-tree-scroll style={{ height: '100%', overflow: 'auto' }}>
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {virtualItems.map((virtualItem) => {
                    const { node, depth, isPinned, isPinnedSeparator } = flattenedNodes[virtualItem.index]

                    // Pinned separator
                    if (isPinnedSeparator) {
                      return (
                        <div
                          key="pinned-separator"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualItem.size}px`,
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                        >
                          <div
                            className="flex items-center h-[22px] px-2"
                            style={{ paddingLeft: `${depth * 12 + 8}px` }}
                          >
                            <div className="flex-1 border-b" style={{ borderColor: 'var(--border-color)' }} />
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={node.path}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        <TreeNodeItem
                          node={node}
                          depth={depth}
                          isEditing={editingPath === node.path}
                          isSelected={node.path === selectedPath}
                          isMultiSelected={multiSelectedPaths.has(node.path) && multiSelectedPaths.size > 1}
                          isDragOver={dragOverPath === node.path}
                          isDragging={dragSourcePaths.includes(node.path)}
                          isPinned={isPinned}
                          isExpanded={expanded.has(node.path)}
                          editingName={editingName}
                          newItem={newItem}
                          inputRef={inputRef}
                          onSelect={handleSelect}
                          onToggle={toggleNode}
                          onStartEdit={handleStartEdit}
                          onNewItem={handleNewItem}
                          onFinishEdit={handleFinishEdit}
                          onCancelEdit={handleCancelEdit}
                          onFinishNewItem={handleFinishNewItem}
                          onCancelNewItem={handleCancelNewItem}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          setEditingName={setEditingName}
                          setNewItem={setNewItem}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                <FolderOpen size={24} className="mb-2 opacity-50" />
                <p>{t('fileTree.noFolderOpened')}</p>
              </div>
            )}
          </ScrollArea>
        </ContextMenuPrimitive.Trigger>
        {/* Plugin-contributed items for the file-tree empty area. The
            helper renders nothing when no plugin is registered, so
            the menu is invisible until a contribution exists.
            Per-node right-clicks open TreeNodeContextMenu (the inner
            trigger fires first), so this outer menu is effectively
            only shown for the empty / non-node region. */}
        <ContextMenuContent
          className="min-w-[160px]"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <PluginContextMenuItems location="fileTreeEmpty" ctx={{}} />
        </ContextMenuContent>
      </ContextMenuPrimitive.Root>
    </div>
  )
})

export default FileTreeView
