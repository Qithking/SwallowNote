import { useEffect, useState, useRef, useCallback } from 'react'
import { FileText, FilePlus, FolderPlus, Image, Folder, FolderOpen, RefreshCw, ChevronRight, File } from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { openFolderDialog, createFile } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'
import { FileTreeContextMenu } from './FileTreeContextMenu'

function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildren(n.children, path, children) }
    return n
  })
}

interface TreeItemProps {
  node: FileNode
  depth: number
  onToggle: (path: string) => void
  expanded: Set<string>
  onSelect: (node: FileNode) => void
  selectedPath: string | null
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void
}

function TreeItem({ node, depth, onToggle, expanded, onSelect, selectedPath, onContextMenu }: TreeItemProps) {
  const isExpanded = expanded.has(node.path)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = node.path === selectedPath

  const handleClick = () => {
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

  return (
    <div>
      <div
        data-path={node.path}
        className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm ${isSelected ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(node, e)
        }}
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
              onContextMenu={onContextMenu}
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

export function FileTreeView() {
  const { rootPath } = useWorkspaceStore()
  const { addTab } = useEditorStore()
  const { nodes, expanded, selectedPath, isLoading, setSelectedPath, toggleNode, loadRoot } = useFileTreeStore()
  const [editingName, setEditingName] = useState('')
  const [editingType, setEditingType] = useState<'file' | 'folder' | null>(null)
  const [editingParentPath, setEditingParentPath] = useState<string | null>(null)
  const [editingAfterPath, setEditingAfterPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; node: FileNode | null }>({ visible: false, x: 0, y: 0, node: null })

  useEffect(() => {
    if ((editingParentPath !== null || editingAfterPath !== null) && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingParentPath, editingAfterPath])

  useEffect(() => {
    if (rootPath) loadRoot(rootPath)
    else useFileTreeStore.getState().clearAll()
  }, [rootPath, loadRoot])

  const findNodeByPath = (path: string, list: FileNode[] = nodes): FileNode | null => {
    for (const n of list) {
      if (n.path === path) return n
      if (n.children) {
        const found = findNodeByPath(path, n.children)
        if (found) return found
      }
    }
    return null
  }

  const getLastChildDepth = (node: FileNode, depth: number): number => {
    if (!node.children || node.children.length === 0 || !expanded.has(node.path)) {
      return depth
    }
    const lastChild = node.children[node.children.length - 1]
    return getLastChildDepth(lastChild, depth + 1)
  }

  const handleSelect = (node: FileNode) => {
    setSelectedPath(node.path)
    if (node.isDirectory) return
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

  const handleNewFile = () => {
    if (!selectedPath || !rootPath) return
    const selected = findNodeByPath(selectedPath)
    if (!selected || !selected.isDirectory) return
    const siblings = selected.children || []
    const name = generateUniqueName('新文件.md', siblings)
    let afterPath: string | null = null
    if (siblings.length > 0) {
      afterPath = siblings[siblings.length - 1].path
    }
    setEditingName(name)
    setEditingType('file')
    setEditingParentPath(selected.path)
    setEditingAfterPath(afterPath)
    if (!expanded.has(selected.path)) {
      toggleNode(selected.path)
    }
  }

  const handleNewFolder = () => {
    if (!selectedPath || !rootPath) return
    const selected = findNodeByPath(selectedPath)
    if (!selected || !selected.isDirectory) return
    const siblings = selected.children || []
    const name = generateUniqueName('新文件夹', siblings)
    let afterPath: string | null = null
    if (siblings.length > 0) {
      afterPath = siblings[siblings.length - 1].path
    }
    setEditingName(name)
    setEditingType('folder')
    setEditingParentPath(selected.path)
    setEditingAfterPath(afterPath)
    if (!expanded.has(selected.path)) {
      toggleNode(selected.path)
    }
  }

  const handleFinishEdit = async () => {
    if (!editingParentPath || !editingName.trim()) {
      setEditingParentPath(null)
      setEditingAfterPath(null)
      setEditingName('')
      setEditingType(null)
      return
    }
    try {
      const fullPath = editingParentPath + '/' + editingName.trim()
      await createFile(fullPath, editingType === 'folder')
      // 只刷新父节点的 children
      const children = await loadDirectory(editingParentPath)
      const currentNodes = useFileTreeStore.getState().nodes
      const updatedNodes = updateNodesWithChildren(currentNodes, editingParentPath, children)
      useFileTreeStore.getState().setNodes(updatedNodes)
      setEditingParentPath(null)
      setEditingAfterPath(null)
      setEditingName('')
      setEditingType(null)
    } catch (e) {
      console.error('Failed to create:', e)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit()
    } else if (e.key === 'Escape') {
      setEditingParentPath(null)
      setEditingAfterPath(null)
      setEditingName('')
      setEditingType(null)
    }
  }

  const isSelectedDirectory = selectedPath ? (findNodeByPath(selectedPath)?.isDirectory ?? false) : false

  const handleContextMenu = useCallback((node: FileNode, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node })
    setSelectedPath(node.path)
  }, [setSelectedPath])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0, node: null })
  }, [])

  const handleRenameFromContext = useCallback((node: FileNode) => {
    setEditingName(node.name)
    setEditingType(node.isDirectory ? 'folder' : 'file')
    // Find parent
    const findParent = (n: FileNode, list: FileNode[]): FileNode | null => {
      for (const item of list) {
        if (item.children) {
          if (item.children.some(c => c.path === n.path)) return item
          const found = findParent(n, item.children)
          if (found) return found
        }
      }
      return null
    }
    const parent = findParent(node, nodes)
    setEditingParentPath(parent?.path ?? null)
    setEditingAfterPath(parent?.path ? node.path : null)
  }, [nodes])

  const renderTree = () => {
    if (editingParentPath !== null) {
      const renderNode = (list: FileNode[], depth: number): React.ReactNode => {
        return list.map((node) => {
          const isEditing = editingAfterPath === node.path
          const isParentEmpty = editingParentPath === node.path && editingAfterPath === null
          const editDepth = isEditing ? depth : (isParentEmpty ? depth + 1 : 0)
          return (
            <div key={node.path}>
              <div
                data-path={node.path}
                className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-sm ${isEditing ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => !isEditing && handleSelect(node)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleContextMenu(node, e)
                }}
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
                <span className="truncate">{node.name}</span>
              </div>
              {node.children && expanded.has(node.path) && renderNode(node.children, depth + 1)}
              {/* 在直属最后一个子节点后插入新节点，与子节点同层级 */}
              {isEditing && (
                <div
                  className="flex items-center h-[24px] gap-1 text-sm text-[var(--text-secondary)]"
                  style={{ paddingLeft: `${editDepth * 12 + 8}px` }}
                >
                  <span className="w-[14px]" />
                  {editingType === 'folder' ? (
                    <Folder size={14} className="text-[#d4a05a]" />
                  ) : (
                    <FileText size={14} style={{ color: '#569cd6' }} />
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    className="flex-1 h-[20px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishEdit}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              )}
              {/* 没有直属子节点时，在父节点下直接新增 */}
              {isParentEmpty && (
                <div
                  className="flex items-center h-[24px] gap-1 text-sm text-[var(--text-secondary)]"
                  style={{ paddingLeft: `${editDepth * 12 + 8}px` }}
                >
                  <span className="w-[14px]" />
                  {editingType === 'folder' ? (
                    <Folder size={14} className="text-[#d4a05a]" />
                  ) : (
                    <FileText size={14} style={{ color: '#569cd6' }} />
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    className="flex-1 h-[20px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishEdit}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              )}
            </div>
          )
        })
      }
      return renderNode(nodes, 0)
    }

    return nodes.map((node) => (
      <TreeItem key={node.path} node={node} depth={0} onToggle={toggleNode} expanded={expanded} onSelect={handleSelect} selectedPath={selectedPath} onContextMenu={handleContextMenu} />
    ))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>资源管理器</span>
        <div className="flex items-center gap-0.5">
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }} onClick={handleOpenFolder}>
            <FolderOpen size={14} />
          </button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}
            onClick={handleNewFile}
            disabled={!isSelectedDirectory}
            title="新建文件"
          >
            <FilePlus size={14} />
          </button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}
            onClick={handleNewFolder}
            disabled={!isSelectedDirectory}
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </button>
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }} onClick={() => loadRoot(rootPath!)}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
          </div>
        ) : nodes.length > 0 ? (
          renderTree()
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <FolderOpen size={32} className="mb-2 opacity-50" />
            <p className="text-sm">未打开文件夹</p>
          </div>
        )}
      </div>
      <FileTreeContextMenu contextMenu={contextMenu} onClose={handleCloseContextMenu} onRename={handleRenameFromContext} />
    </div>
  )
}
