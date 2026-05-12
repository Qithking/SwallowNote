import { useEffect, useState, useRef } from 'react'
import { FileText, FilePlus, FolderPlus, Image, Folder, FolderOpen, RefreshCw, ChevronRight, File } from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { openFolderDialog, createFile } from '@/lib/tauri'
import { renameFile } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'
import { TreeNodeContextMenu } from './FileTreeContextMenu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildren(n.children, path, children) }
    return n
  })
}

function findNodeByPath(path: string, list: FileNode[]): FileNode | null {
  for (const n of list) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNodeByPath(path, n.children)
      if (found) return found
    }
  }
  return null
}

function findParentNode(node: FileNode, list: FileNode[]): FileNode | null {
  for (const n of list) {
    if (n.children) {
      if (n.children.some(c => c.path === node.path)) return n
      const found = findParentNode(node, n.children)
      if (found) return found
    }
  }
  return null
}

interface TreeItemProps {
  node: FileNode
  depth: number
  onToggle: (path: string) => void
  expanded: Set<string>
  onSelect: (node: FileNode) => void
  selectedPath: string | null
  editingPath: string | null
  editingName: string
  onStartEdit: (path: string, name: string, isDirectory: boolean) => void
}

// TreeItem is used for rendering nested tree nodes in FileTreeView
// @ts-ignore
function TreeItem({
  node,
  depth,
  onToggle,
  expanded,
  onSelect,
  selectedPath,
  editingPath,
  editingName,
  onStartEdit,
}: TreeItemProps) {
  // TreeItem is used for rendering nested tree nodes
  void depth; // Suppress unused warning
  const isExpanded = expanded.has(node.path)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = node.path === selectedPath
  const isEditing = editingPath === node.path

  const handleClick = () => {
    if (isEditing) return
    onSelect(node)
    if (node.isDirectory) {
      onToggle(node.path)
    }
  }

  const getIcon = () => {
    if (node.isDirectory) {
      return isExpanded ? <FolderOpen size={14} className="text-[#d4a05a]" /> : <Folder size={14} className="text-[#d4a05a]" />
    }
    const ext = node.name.split('.').pop()?.toLowerCase()
    if (ext === 'md') return <FileText size={14} style={{ color: '#569cd6' }} />
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) return <Image size={14} style={{ color: '#ce9178' }} />
    return <File size={14} style={{ color: 'var(--text-muted)' }} />
  }

  const nodeContent = (
    <div
      data-path={node.path}
      className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm ${isSelected ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={handleClick}
    >
      {node.isDirectory ? (
        <ChevronRight
          size={14}
          className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.path)
          }}
        />
      ) : (
        <span className="w-[14px]" />
      )}
      {getIcon()}
      <span className="truncate">{node.name}</span>
    </div>
  )

  return (
    <div>
      <TreeNodeContextMenu
        node={node}
        onRename={() => onStartEdit(node.path, node.name, node.isDirectory)}
      >
        {nodeContent}
      </TreeNodeContextMenu>
      {isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              expanded={expanded}
              onSelect={onSelect}
              selectedPath={selectedPath}
              editingPath={editingPath}
              editingName={editingName}
              onStartEdit={onStartEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function generateUniqueName(baseName: string, siblings: FileNode[]): string {
  const ext = baseName.includes('.') ? '.' + baseName.split('.').pop() : ''
  const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName
  let counter = 1
  let newName = baseName
  while (siblings.some(s => s.name === newName)) {
    newName = `${nameWithoutExt}${counter}${ext}`
    counter++
  }
  return newName
}

// 新建文件/文件夹模式的状态
interface NewItemState {
  parentPath: string
  name: string
  type: 'file' | 'folder'
}

export function FileTreeView() {
  const { rootPath } = useWorkspaceStore()
  const { addTab, updateTabPath } = useEditorStore()
  const { nodes, expanded, selectedPath, isLoading, setSelectedPath, toggleNode, loadRoot, setNodes } = useFileTreeStore()
  const inputRef = useRef<HTMLInputElement>(null)

  // 重命名状态
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [editingType, setEditingType] = useState<'file' | 'folder' | null>(null)
  // @ts-ignore editingType is used for future features
  void editingType
  const [isFirstEdit, setIsFirstEdit] = useState(true)

  // 新建文件/文件夹状态
  const [newItem, setNewItem] = useState<NewItemState | null>(null)

  const handleStartEdit = (path: string, name: string, isDirectory: boolean) => {
    // 保存完整文件名，useEffect 中会设置选中范围
    setEditingPath(path)
    setEditingName(name)
    setEditingType(isDirectory ? 'folder' : 'file')
    setIsFirstEdit(true) // 初次编辑，选中文件名
  }

  useEffect(() => {
    if (editingPath !== null && inputRef.current) {
      // 延迟到下一帧确保 DOM 已更新
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          // 只在初次编辑时选中文件名（去除扩展名）
          if (isFirstEdit) {
            const editingNode = findNodeByPath(editingPath, nodes)
            if (editingNode && !editingNode.isDirectory && editingName.includes('.')) {
              const lastDot = editingName.lastIndexOf('.')
              inputRef.current.setSelectionRange(0, lastDot)
            } else {
              inputRef.current.select()
            }
            setIsFirstEdit(false)
          }
        }
      })
    }
  }, [editingPath, newItem, editingName, nodes, isFirstEdit])

  useEffect(() => {
    if (rootPath) loadRoot(rootPath)
    else useFileTreeStore.getState().clearAll()
  }, [rootPath, loadRoot])

  const handleSelect = (node: FileNode) => {
    setSelectedPath(node.path)
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
  }

  const handleOpenFolder = async () => {
    const path = await openFolderDialog()
    if (path) useWorkspaceStore.getState().setRootPath(path)
  }

  const handleFinishEdit = async () => {
    if (!editingPath || !editingName.trim()) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      return
    }

    const node = findNodeByPath(editingPath, nodes)
    if (!node) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      return
    }

    // 检查文件名是否改变
    if (editingName.trim() === node.name) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      return
    }

    try {
      const parent = findParentNode(node, nodes)
      const parentPath = parent?.path || rootPath || ''
      const newName = editingName.trim()
      const newPath = parentPath + '/' + newName
      await renameFile(editingPath, newPath)

      // 更新已打开的 tab
      updateTabPath(editingPath, newPath, newName)

      // 刷新父节点
      if (parent) {
        const children = await loadDirectory(parent.path)
        const updatedNodes = updateNodesWithChildren(nodes, parent.path, children)
        setNodes(updatedNodes)
      } else {
        // 根节点重命名，刷新根
        const children = await loadDirectory(rootPath || editingPath)
        const rootNode: FileNode = {
          id: 'root',
          name: rootPath?.split('/').pop() || rootPath || '',
          path: rootPath || '',
          isDirectory: true,
          children,
        }
        setNodes([rootNode])
      }
    } catch (e) {
      console.error('Failed to rename:', e)
    }

    setEditingPath(null)
    setEditingName('')
    setEditingType(null)
  }

  const handleCancelEdit = () => {
    setEditingPath(null)
    setEditingName('')
    setEditingType(null)
  }

  const handleNewFile = () => {
    if (!selectedPath || !rootPath) return
    const selected = findNodeByPath(selectedPath, nodes)
    if (!selected || !selected.isDirectory) return

    const siblings = selected.children || []
    const name = generateUniqueName('新文件.md', siblings)
    setNewItem({ parentPath: selected.path, name, type: 'file' })

    if (!expanded.has(selected.path)) {
      toggleNode(selected.path)
    }
  }

  const handleNewFolder = () => {
    if (!selectedPath || !rootPath) return
    const selected = findNodeByPath(selectedPath, nodes)
    if (!selected || !selected.isDirectory) return

    const siblings = selected.children || []
    const name = generateUniqueName('新文件夹', siblings)
    setNewItem({ parentPath: selected.path, name, type: 'folder' })

    if (!expanded.has(selected.path)) {
      toggleNode(selected.path)
    }
  }

  const handleFinishNewItem = async () => {
    if (!newItem || !newItem.name.trim()) {
      setNewItem(null)
      return
    }

    try {
      const fullPath = newItem.parentPath + '/' + newItem.name.trim()
      await createFile(fullPath, newItem.type === 'folder')
      const children = await loadDirectory(newItem.parentPath)
      const updatedNodes = updateNodesWithChildren(nodes, newItem.parentPath, children)
      setNodes(updatedNodes)
    } catch (e) {
      console.error('Failed to create:', e)
    }

    setNewItem(null)
  }

  const handleCancelNewItem = () => {
    setNewItem(null)
  }

  const handleNewItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishNewItem()
    } else if (e.key === 'Escape') {
      handleCancelNewItem()
    }
  }

  const isSelectedDirectory = selectedPath ? (findNodeByPath(selectedPath, nodes)?.isDirectory ?? false) : false

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const isNewItemNode = newItem?.parentPath === node.path && node.children?.length === 0
    const isEditing = editingPath === node.path
    const isSelected = node.path === selectedPath

    const nodeContent = (
      <div
        data-path={node.path}
        className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm ${isEditing || isSelected ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => !isEditing && handleSelect(node)}
      >
        {node.isDirectory ? (
          <ChevronRight
            size={14}
            className={`transition-transform ${expanded.has(node.path) ? 'rotate-90' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleNode(node.path)
            }}
          />
        ) : (
          <span className="w-[14px]" />
        )}
        {node.isDirectory ? (
          <Folder size={14} className="text-[#d4a05a]" />
        ) : (
          <FileText size={14} style={{ color: '#569cd6' }} />
        )}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="flex-1 h-[20px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleFinishEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFinishEdit()
              else if (e.key === 'Escape') handleCancelEdit()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>
    )

    return (
      <div key={node.path}>
        <TreeNodeContextMenu
          node={node}
          onRename={() => handleStartEdit(node.path, node.name, node.isDirectory)}
        >
          {nodeContent}
        </TreeNodeContextMenu>
        {node.children && expanded.has(node.path) && (
          <>
            {node.children.map((child) => renderNode(child, depth + 1))}
            {/* 在父节点下直接新增（当父节点没有直属子节点时） */}
            {isNewItemNode && (
              <div
                className="flex items-center h-[24px] gap-1 text-sm text-[var(--text-secondary)]"
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <span className="w-[14px]" />
                {newItem.type === 'folder' ? (
                  <Folder size={14} className="text-[#d4a05a]" />
                ) : (
                  <FileText size={14} style={{ color: '#569cd6' }} />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 h-[20px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  onBlur={handleFinishNewItem}
                  onKeyDown={handleNewItemKeyDown}
                />
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>资源管理器</span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] cursor-pointer" style={{ color: 'var(--text-muted)' }} onClick={handleOpenFolder}>
                <FolderOpen size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>打开文件夹</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
                onClick={handleNewFile}
                disabled={!isSelectedDirectory}
              >
                <FilePlus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>新建文件</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
                onClick={handleNewFolder}
                disabled={!isSelectedDirectory}
              >
                <FolderPlus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>新建文件夹</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] cursor-pointer" style={{ color: 'var(--text-muted)' }} onClick={() => loadRoot(rootPath!)}>
                <RefreshCw size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>刷新</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
          </div>
        ) : nodes.length > 0 ? (
          <>
            {nodes.map((node) => renderNode(node, 0))}
            {/* 根目录下新建（当根目录没有直属子节点时） */}
            {newItem && nodes.length === 1 && nodes[0].children?.length === 0 && (
              <div
                className="flex items-center h-[24px] gap-1 text-sm text-[var(--text-secondary)]"
                style={{ paddingLeft: `${12 + 8}px` }}
              >
                <span className="w-[14px]" />
                {newItem.type === 'folder' ? (
                  <Folder size={14} className="text-[#d4a05a]" />
                ) : (
                  <FileText size={14} style={{ color: '#569cd6' }} />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 h-[20px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  onBlur={handleFinishNewItem}
                  onKeyDown={handleNewItemKeyDown}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <FolderOpen size={32} className="mb-2 opacity-50" />
            <p className="text-sm">未打开文件夹</p>
          </div>
        )}
      </div>
    </div>
  )
}
