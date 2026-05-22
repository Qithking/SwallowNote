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
  GitBranch,
} from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore, useUIStore, useGitStore } from '@/stores'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { deleteFile } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'
import { removeFolderHistory } from '@/lib/tauri'
import { useTranslation } from 'react-i18next'

/**
 * Count words in content, properly handling CJK characters.
 */
function countWords(content: string): number {
  let count = 0
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
  const cjkMatches = content.match(cjkRegex)
  if (cjkMatches) {
    count += cjkMatches.length
  }
  const withoutCjk = content.replace(cjkRegex, ' ')
  const latinWords = withoutCjk.split(/\s+/).filter(Boolean)
  count += latinWords.length
  return count
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

function getRelativePath(rootPath: string, fullPath: string): string {
  if (!rootPath) return fullPath
  return fullPath.substring(rootPath.length + 1)
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
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
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode, showAllFiles, markdownOnly } = useUIStore()
  const { addTab } = useEditorStore()
  const { nodes, setSelectedPath, toggleNode, setNodes, removeRoot } = useFileTreeStore()
  const { clipboardFiles, clipboardIsCut, setClipboardFiles, showToast } = useUIStore()
  const { repositories } = useGitStore()
  const { t } = useTranslation()

  const isRootFolder = workspaceMode === 'workspace' && workspaceFolders.includes(node.path)

  // 检查节点是否在 git 仓库中
  const isInGitRepo = repositories.some(repo => {
    // 节点路径等于仓库路径，或节点路径在仓库路径下
    return node.path === repo.path || node.path.startsWith(repo.path + '/')
  })
  // "同步初始化"只在不在 git 项目中时显示
  const canShowGitInit = node.isDirectory && !isInGitRepo

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
          wordCount: countWords(content),
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

  const handleGitInit = async () => {
    if (!node.isDirectory) return
    try {
      await invoke('git_init', { path: node.path })
      showToast(t('contextMenu.gitInitSuccess'))
      // Refresh the directory to show .git folder
      const children = await loadDirectory(node.path, showAllFiles, markdownOnly)
      const updatedNodes = updateNodesWithChildren(nodes, node.path, children)
      setNodes(updatedNodes)
    } catch (e) {
      console.error('Failed to init git:', e)
      showToast(t('contextMenu.gitInitFailed', { error: String(e) }))
    }
  }

  const handleCopyPath = async (relative: boolean) => {
    const pathToCopy = relative && rootPath ? getRelativePath(rootPath, node.path) : node.path
    try {
      await navigator.clipboard.writeText(pathToCopy)
      showToast(t('tabBar.pathCopied'))
    } catch (e) {
      console.error('Failed to copy path:', e)
      showToast(t('contextMenu.copied', { name: 'path' }))
    }
  }

  const handleCopy = () => {
    setClipboardFiles([node.path], false)
    showToast(t('contextMenu.copied', { name: node.name }))
  }

  const handleCut = () => {
    setClipboardFiles([node.path], true)
    showToast(t('contextMenu.cutted', { name: node.name }))
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

        // 如果是剪切模式，删除源文件并更新/关闭相关 tab
        if (clipboardIsCut) {
          await deleteFile(sourcePath)
          // Update tabs: move from source path to destination path
          const editorStore = useEditorStore.getState()
          const destName = getFileName(destPath)
          editorStore.updateTabPath(sourcePath, destPath, destName)
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
    const children = await loadDirectory(node.path, showAllFiles, markdownOnly)
    const updatedNodes = updateNodesWithChildren(nodes, node.path, children)
    setNodes(updatedNodes)

    if (failCount === 0) {
      showToast(t('contextMenu.pastedSuccess', { count: successCount }))
    } else {
      showToast(t('contextMenu.pastedPartial', { count: successCount, failCount }))
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('dialog.confirmDelete', { name: node.name, extra: node.isDirectory ? t('dialog.confirmDeleteDir') : '' }))) return
    try {
      await deleteFile(node.path)
      
      // Close any open tabs for the deleted file or files within the deleted directory
      const editorStore = useEditorStore.getState()
      const tabsToClose = editorStore.tabs.filter(tab => {
        if (node.isDirectory) {
          // Close all tabs whose path starts with the deleted directory path
          return tab.path === node.path || tab.path.startsWith(node.path + '/')
        }
        // Close the tab with the exact path
        return tab.path === node.path
      })
      for (const tab of tabsToClose) {
        editorStore.removeTab(tab.id)
      }
      
      // Refresh parent
      const parent = findNodeParent(node, nodes)
      if (parent) {
        const children = await loadDirectory(parent.path, showAllFiles, markdownOnly)
        const updatedNodes = updateNodesWithChildren(nodes, parent.path, children)
        setNodes(updatedNodes)
      }
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  const handleRemoveRecord = async () => {
    if (!isRootFolder) return
    try {
      removeRoot(node.path)
      await removeFolderHistory(node.path)
      
      const { removeWorkspaceFolder } = useWorkspaceStore.getState()
      removeWorkspaceFolder(node.path)
      
      showToast(t('contextMenu.removed', { name: node.name }))
    } catch (e) {
      console.error('Failed to remove record:', e)
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
          background: 'var(--bg-primary)',
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
              <span>{t('contextMenu.paste')}</span>
            </ContextMenuItem>
            <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
          </>
        )}

        <ContextMenuItem onClick={handleOpen} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          {node.isDirectory ? <FolderOpen size={12} /> : <FileText size={12} />}
          <span>{t('contextMenu.open')}</span>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleShowInFinder} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FolderOpen size={12} />
          <span>{t('contextMenu.showInExplorer')}</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        {/* 打开历史记录 - 只在 git 项目中显示 */}
        {isInGitRepo && (
          <ContextMenuItem onClick={handleOpenHistory} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
            <History size={12} />
            <span>{t('contextMenu.openHistory')}</span>
          </ContextMenuItem>
        )}

        {/* 同步初始化 - 只在不在 git 项目中的文件夹显示 */}
        {canShowGitInit && (
          <>
            <ContextMenuItem onClick={handleGitInit} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
              <GitBranch size={12} />
              <span>{t('contextMenu.syncInit')}</span>
            </ContextMenuItem>
          </>
        )}

        {(isInGitRepo || canShowGitInit) && (
          <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
        )}

        <ContextMenuItem onClick={() => handleCopyPath(false)} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FileText size={12} />
          <span>{t('contextMenu.copyPath')}</span>
        </ContextMenuItem>

        <ContextMenuItem onClick={() => handleCopyPath(true)} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <FileText size={12} />
          <span>{t('contextMenu.copyRelativePath')}</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={handleCopy} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <Copy size={12} />
          <span>{t('contextMenu.copy')}</span>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleCut}
          style={{ color: clipboardIsCut ? 'var(--theme-color)' : 'var(--text-secondary)' }}
          className="cursor-pointer"
        >
          <Scissors size={12} />
          <span>{t('contextMenu.cut')}</span>
        </ContextMenuItem>

        <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />

        <ContextMenuItem onClick={handleRename} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
          <Edit3 size={12} />
          <span>{t('contextMenu.rename')}</span>
        </ContextMenuItem>

        {isRootFolder && (
          <ContextMenuItem
            onClick={handleRemoveRecord}
            style={{ color: 'var(--danger-color, #f44336)' }}
            className="cursor-pointer"
          >
            <Trash2 size={12} />
            <span style={{ color: 'var(--danger-color, #f44336)' }}>{t('contextMenu.softDelete')}</span>
          </ContextMenuItem>
        )}

        <ContextMenuItem
          onClick={handleDelete}
          style={{ color: 'var(--danger-color, #f44336)' }}
          className="cursor-pointer"
        >
          <Trash2 size={12} />
          <span style={{ color: 'var(--danger-color, #f44336)' }}>{t('contextMenu.hardDelete')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
