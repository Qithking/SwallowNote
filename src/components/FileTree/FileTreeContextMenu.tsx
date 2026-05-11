/**
 * FileTree Context Menu - Right-click menu for file tree nodes
 */
import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  FolderOpen,
  Copy,
  Scissors,
  File,
  Edit3,
  Trash2,
  History,
} from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore, useUIStore } from '@/stores'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { deleteFile } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  node: FileNode | null
}

interface FileTreeContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onRename: (node: FileNode) => void
}

function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildren(n.children, path, children) }
    return n
  })
}

function findNodeParent(node: FileNode, list: FileNode[]): FileNode | null {
  for (const n of list) {
    if (n.children) {
      if (n.children.some(c => c.path === node.path)) return n
      const found = findNodeParent(node, n.children)
      if (found) return found
    }
  }
  return null
}

export function FileTreeContextMenu({ contextMenu, onClose, onRename }: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { rootPath } = useWorkspaceStore()
  const { addTab } = useEditorStore()
  const { setSelectedPath, toggleNode } = useFileTreeStore()
  const { showToast } = useUIStore()
  const [cutPath, setCutPath] = useState<string | null>(null)

  const { visible, x, y, node } = contextMenu

  useEffect(() => {
    if (!visible) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [visible, onClose])

  if (!visible || !node) return null

  const getRelativePath = (fullPath: string): string => {
    if (!rootPath) return fullPath
    return fullPath.substring(rootPath.length + 1)
  }

  const handleOpen = async () => {
    onClose()
    if (node.isDirectory) {
      toggleNode(node.path)
    } else {
      setSelectedPath(node.path)
      try {
        const content = await loadFileContent(node.path)
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
      } catch (e) {
        console.error('Failed to open file:', e)
      }
    }
  }

  const handleShowInFinder = async () => {
    onClose()
    try {
      await invoke('open_in_finder', { path: node.path })
    } catch (e) {
      console.error('Failed to open in finder:', e)
    }
  }

  const handleOpenHistory = () => {
    onClose()
    // TODO: Implement history view
    console.log('Open history for:', node.path)
  }

  const handleCopyPath = async (relative: boolean) => {
    onClose()
    const pathToCopy = relative ? getRelativePath(node.path) : node.path
    try {
      await navigator.clipboard.writeText(pathToCopy)
      showToast('路径已复制')
    } catch (e) {
      console.error('Failed to copy path:', e)
      showToast('复制路径失败')
    }
  }

  const handleCopy = async () => {
    onClose()
    setCutPath(null)
    try {
      await invoke('copy_file_to_clipboard', { path: node.path })
      showToast(`已复制: ${node.name}`)
    } catch (e) {
      console.error('Failed to copy file to clipboard:', e)
      showToast('复制失败')
    }
  }

  const handleCut = () => {
    setCutPath(node.path)
    showToast(`已剪切: ${node.name}`)
    onClose()
  }

  const handleDelete = async () => {
    onClose()
    if (!confirm(`确定要删除 "${node.name}" 吗？${node.isDirectory ? '（包含所有内容）' : ''}`)) return
    try {
      await deleteFile(node.path)
      // Refresh parent
      const parent = findNodeParent(node, useFileTreeStore.getState().nodes)
      if (parent) {
        const children = await loadDirectory(parent.path)
        const currentNodes = useFileTreeStore.getState().nodes
        const updatedNodes = updateNodesWithChildren(currentNodes, parent.path, children)
        useFileTreeStore.getState().setNodes(updatedNodes)
      }
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  const handleRename = () => {
    onClose()
    onRename(node)
  }

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
    minWidth: '180px',
    padding: '4px 0',
    borderRadius: '6px',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    transition: 'background-color 0.15s',
  }

  const menuItemHoverStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-primary)',
  }

  const separatorStyle: React.CSSProperties = {
    height: '1px',
    backgroundColor: 'var(--border-color)',
    margin: '4px 0',
  }

  return (
    <div ref={menuRef} style={menuStyle}>
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={handleOpen}
      >
        {node.isDirectory ? <FolderOpen size={14} /> : <FileText size={14} />}
        <span>打开</span>
      </div>
      <div style={separatorStyle} />
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={handleShowInFinder}
      >
        <FolderOpen size={14} />
        <span>在文件资源管理器中显示</span>
      </div>
      <div style={separatorStyle} />
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={handleOpenHistory}
      >
        <History size={14} />
        <span>打开历史记录</span>
      </div>
      <div style={separatorStyle} />
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={() => handleCopyPath(false)}
      >
        <File size={14} />
        <span>复制路径</span>
      </div>
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={() => handleCopyPath(true)}
      >
        <File size={14} />
        <span>复制相对路径</span>
      </div>
      <div style={separatorStyle} />
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={handleCopy}
      >
        <Copy size={14} />
        <span>复制</span>
      </div>
      <div
        style={{
          ...menuItemStyle,
          color: cutPath === node.path ? 'var(--theme-color)' : 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = cutPath === node.path ? 'var(--theme-color)' : 'var(--text-secondary)'
        }}
        onClick={handleCut}
      >
        <Scissors size={14} />
        <span>剪切</span>
      </div>
      <div style={separatorStyle} />
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onClick={handleRename}
      >
        <Edit3 size={14} />
        <span>重命名</span>
      </div>
      <div
        style={menuItemStyle}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--danger-color, #f44336)'
        }}
        onClick={handleDelete}
      >
        <Trash2 size={14} />
        <span style={{ color: 'var(--danger-color, #f44336)' }}>删除</span>
      </div>
    </div>
  )
}
