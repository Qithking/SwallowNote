/**
 * FileTree Context Menu - Right-click menu for file tree nodes
 * Built with shadcn ContextMenu component
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  FileText,
  FolderOpen,
  Copy,
  Scissors,
  ClipboardPaste,
  Edit3,
  Trash2,
  History,
} from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore, useUIStore } from '@/stores'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { deleteFile } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'

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

function getRelativePath(rootPath: string, fullPath: string): string {
  if (!rootPath) return fullPath
  return fullPath.substring(rootPath.length + 1)
}

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

function getDestinationPath(targetDir: string, sourcePath: string): string {
  const fileName = getFileName(sourcePath)
  return `${targetDir}/${fileName}`
}

interface TreeNodeContextMenuProps {
  node: FileNode
  children: React.ReactNode
  onRename?: () => void
}

export function TreeNodeContextMenu({ node, children, onRename }: TreeNodeContextMenuProps) {
  const { rootPath } = useWorkspaceStore()
  const { addTab } = useEditorStore()
  const { nodes, setSelectedPath, toggleNode, setNodes } = useFileTreeStore()
  const { clipboardFiles, clipboardIsCut, setClipboardFiles, showToast } = useUIStore()

  const hasClipboard = clipboardFiles.length > 0
  // 只有目标是目录时才显示粘贴菜单
  const canPaste = hasClipboard && node.isDirectory

  const handleOpen = async () => {
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
    try {
      await invoke('open_in_finder', { path: node.path })
    } catch (e) {
      console.error('Failed to open in finder:', e)
    }
  }

  const handleOpenHistory = () => {
    console.log('Open history for:', node.path)
  }

  const handleCopyPath = async (relative: boolean) => {
    const pathToCopy = relative && rootPath ? getRelativePath(rootPath, node.path) : node.path
    try {
      await navigator.clipboard.writeText(pathToCopy)
      showToast('路径已复制')
    } catch (e) {
      console.error('Failed to copy path:', e)
      showToast('复制路径失败')
    }
  }

  const handleCopy = () => {
    setClipboardFiles([node.path], false)
    showToast(`已复制: ${node.name}`)
  }

  const handleCut = () => {
    setClipboardFiles([node.path], true)
    showToast(`已剪切: ${node.name}`)
  }

  const handlePaste = async () => {
    if (!canPaste || !rootPath) return

    let successCount = 0
    let failCount = 0

    for (const sourcePath of clipboardFiles) {
      const destPath = getDestinationPath(node.path, sourcePath)
      try {
        await invoke('copy_file', {
          req: {
            old_path: sourcePath,
            new_path: destPath,
          },
        })
        successCount++

        // 如果是剪切模式，删除源文件
        if (clipboardIsCut) {
          await deleteFile(sourcePath)
        }
      } catch (e) {
        console.error('Failed to paste:', e)
        failCount++
      }
    }

    // 清除剪贴板（剪切模式下）
    if (clipboardIsCut) {
      setClipboardFiles([], false)
    }

    // 刷新目标目录
    const children = await loadDirectory(node.path)
    const updatedNodes = updateNodesWithChildren(nodes, node.path, children)
    setNodes(updatedNodes)

    if (failCount === 0) {
      showToast(`已粘贴 ${successCount} 个文件`)
    } else {
      showToast(`已粘贴 ${successCount} 个文件，${failCount} 个失败`)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`确定要删除 "${node.name}" 吗？${node.isDirectory ? '（包含所有内容）' : ''}`)) return
    try {
      await deleteFile(node.path)
      // Refresh parent
      const parent = findNodeParent(node, nodes)
      if (parent) {
        const children = await loadDirectory(parent.path)
        const updatedNodes = updateNodesWithChildren(nodes, parent.path, children)
        setNodes(updatedNodes)
      }
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  const handleRename = () => {
    if (onRename) {
      onRename()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[160px]"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* 粘贴菜单 - 在复制/剪切之前 */}
        {canPaste && (
          <>
            <ContextMenuItem
              onClick={handlePaste}
              style={{ color: 'var(--text-secondary)' }}
              className="cursor-pointer"
            >
              <ClipboardPaste size={12} />
              <span>粘贴</span>
            </ContextMenuItem>
            <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
          </>
        )}

        <ContextMenuItem onClick={handleOpen} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          {node.isDirectory ? <FolderOpen size={12} /> : <FileText size={12} />}
          <span>打开</span>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleShowInFinder} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FolderOpen size={12} />
          <span>在文件资源管理器中显示</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={handleOpenHistory} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <History size={12} />
          <span>打开历史记录</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={() => handleCopyPath(false)} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FileText size={12} />
          <span>复制路径</span>
        </ContextMenuItem>

        <ContextMenuItem onClick={() => handleCopyPath(true)} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FileText size={12} />
          <span>复制相对路径</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={handleCopy} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <Copy size={12} />
          <span>复制</span>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleCut}
          style={{ color: clipboardIsCut ? 'var(--theme-color)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <Scissors size={12} />
          <span>剪切</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={handleRename} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <Edit3 size={12} />
          <span>重命名</span>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleDelete}
          style={{ color: 'var(--danger-color, #f44336)' }}
          className="cursor-pointer"
        >
          <Trash2 size={12} />
          <span style={{ color: 'var(--danger-color, #f44336)' }}>删除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
