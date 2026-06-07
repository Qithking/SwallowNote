/**
 * FileTreeView — 文件树视图组件（纯渲染层）
 * 操作逻辑已提取到：
 *   - useFileTreeActions  (重命名/新建/删除)
 *   - useFileTreeDragDrop (拖拽)
 * 工具函数来自 @/lib/utils/treeUtils
 */
import { useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { FilePlus, FolderPlus, Folder, FolderOpen, RefreshCw, ChevronRight, Save, Loader2, GitFork, FileText } from 'lucide-react'
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
import { matchShortcut, getShortcutKey } from '@/lib/shortcuts'
import { useFileTreeActions } from '@/hooks/useFileTreeActions'
import { useFileTreeDragDrop } from '@/hooks/useFileTreeDragDrop'
import { findNodeByPath, collectAllPaths } from '@/lib/utils/treeUtils'
import { useVirtualizer } from '@tanstack/react-virtual'

// 扁平化的树节点，用于虚拟化
interface FlattenedNode {
  node: FileNode
  depth: number
  isLastInParent?: boolean
}

// 将嵌套的文件树扁平化为列表
function flattenNodes(nodes: FileNode[], expanded: Set<string>, depth = 0): FlattenedNode[] {
  const result: FlattenedNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    result.push({ node, depth, isLastInParent: i === nodes.length - 1 })
    if (node.isDirectory && expanded.has(node.path) && node.children) {
      result.push(...flattenNodes(node.children, expanded, depth + 1))
    }
  }
  return result
}

// 单个树节点组件 - 使用 memo 优化
const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  isNewItemNode,
  isEditing,
  isSelected,
  isMultiSelected,
  isDragOver,
  isDragging,
  expanded,
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
  isNewItemNode: boolean
  isEditing: boolean
  isSelected: boolean
  isMultiSelected: boolean
  isDragOver: boolean
  isDragging: boolean
  expanded: Set<string>
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
  const nodeContent = (
    <div
      data-path={node.path}
      className={`flex items-center h-[22px] cursor-pointer select-none gap-1 text-xs ${
        isEditing || isSelected ? 'bg-primary/10 text-[var(--text-primary)]'
        : isDragOver ? 'bg-primary/15 text-[var(--text-primary)] border-t border-primary/30'
        : isMultiSelected ? 'bg-primary/5 text-[var(--text-primary)]'
        : isDragging ? 'opacity-50 text-[var(--text-secondary)]'
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
            className={`transition-transform shrink-0 ${expanded.has(node.path) ? 'rotate-90' : ''}`}
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
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, node)}
      onDragOver={(e) => onDragOver(e, node)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, node)}
      onDragEnd={onDragEnd}
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
      {isNewItemNode && newItem && (
        <div
          className="flex items-center h-[22px] gap-1 text-xs text-[var(--text-secondary)]"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
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
      )}
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
  const customShortcuts = useUIStore((s) => s.customShortcuts)
  const { t } = useTranslation()

  const [isRefreshing, setIsRefreshing] = useState(false)

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

  const handleSelect = useCallback((node: FileNode, shiftKey: boolean) => {
    if (editingPath !== null) return

    if (shiftKey && lastClickedPath) {
      const allPaths = collectAllPaths(nodes)
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
          wordCount: content.split(/\s+/).filter(Boolean).length,
        })
      })
      .catch(console.error)
  }, [editingPath, lastClickedPath, nodes, clearMultiSelection, setSelectedPath, setLastClickedPath, toggleNode, addTab, setMultiSelectedPaths])

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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
        return
      }

      const renameShortcut = getShortcutKey('renameFile', customShortcuts)
      if (matchShortcut(e, renameShortcut)) {
        e.preventDefault()
        if (selectedPath) {
          const node = findNodeByPath(selectedPath, nodes)
          if (node) handleStartEdit(node.path, node.name, node.isDirectory)
        }
        return
      }

      const deleteShortcut = getShortcutKey('deleteFile', customShortcuts)
      if (matchShortcut(e, deleteShortcut)) {
        e.preventDefault()
        handleDeleteSelected()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPath, nodes, customShortcuts, handleStartEdit, handleDeleteSelected])

  const handleNewItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleFinishNewItem() }
    else if (e.key === 'Escape') { handleCancelNewItem() }
  }

  const isSelectedDirectory = selectedPath ? (findNodeByPath(selectedPath, nodes)?.isDirectory ?? false) : false

  // 扁平化节点用于虚拟化
  const flattenedNodes = useMemo(() => flattenNodes(nodes, expanded), [nodes, expanded])

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
      <ScrollArea className="flex-1 py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
          </div>
        ) : nodes.length > 0 ? (
          <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const { node, depth } = flattenedNodes[virtualItem.index]
                const isNewItemNode = newItem?.parentPath === node.path
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
                      isNewItemNode={isNewItemNode}
                      isEditing={editingPath === node.path}
                      isSelected={node.path === selectedPath}
                      isMultiSelected={multiSelectedPaths.has(node.path) && multiSelectedPaths.size > 1}
                      isDragOver={dragOverPath === node.path}
                      isDragging={dragSourcePaths.includes(node.path)}
                      expanded={expanded}
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
            {newItem && nodes.length === 1 && nodes[0].children?.length === 0 && (
              <div
                className="flex items-center h-[22px] gap-1 text-xs text-[var(--text-secondary)]"
                style={{ paddingLeft: `${12 + 8}px` }}
              >
                <span className="w-[14px]" />
                {newItem.type === 'folder' ? (
                  <Folder size={12} className="text-[#666666]" />
                ) : newItem.type === 'mindmap' ? (
                  <GitFork size={12} style={{ color: '#a97bff' }} />
                ) : (
                  <FileText size={12} style={{ color: '#569cd6' }} />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-xs text-[var(--text-primary)]"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  onBlur={handleFinishNewItem}
                  onKeyDown={handleNewItemKeyDown}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <FolderOpen size={24} className="mb-2 opacity-50" />
            <p>{t('fileTree.noFolderOpened')}</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
})

export default FileTreeView
