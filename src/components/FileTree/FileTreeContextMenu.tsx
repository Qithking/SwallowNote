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
  FilePlus,
  FolderPlus,
  FolderOpen,
  Copy,
  Scissors,
  ClipboardPaste,
  Edit3,
  Trash2,
  GitBranch,
  MessageSquare,
  GitFork,
} from 'lucide-react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore, useUIStore, useGitStore } from '@/stores'
import type { GitRepository } from '@/stores/git'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { deleteFile } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'
import { removeFolderHistory } from '@/lib/tauri'
import { useTranslation } from 'react-i18next'
import { PluginContextMenuItems } from '@/components/Plugin/PluginContextMenuItems'
import { updateNodesWithChildren, findParentNode } from '@/lib/utils/treeUtils'
import { usePluginEditors } from '@/stores/pluginEditor'
import { countWords } from '@/lib/utils/wordCount'

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
  onNewFile?: () => void
  onNewFolder?: () => void
  onNewMindMap?: () => void
}

export function TreeNodeContextMenu({ node, children, onRename, onNewFile, onNewFolder, onNewMindMap }: TreeNodeContextMenuProps) {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const showAllFiles = useUIStore((s) => s.showAllFiles)
  const markdownOnly = useUIStore((s) => s.markdownOnly)
  const addTab = useEditorStore((s) => s.addTab)
  const nodes = useFileTreeStore((s) => s.nodes)
  const setSelectedPath = useFileTreeStore((s) => s.setSelectedPath)
  const clearMultiSelection = useFileTreeStore((s) => s.clearMultiSelection)
  const setLastClickedPath = useFileTreeStore((s) => s.setLastClickedPath)
  const toggleNode = useFileTreeStore((s) => s.toggleNode)
  const setNodes = useFileTreeStore((s) => s.setNodes)
  const removeRoot = useFileTreeStore((s) => s.removeRoot)
  const clipboardFiles = useUIStore((s) => s.clipboardFiles)
  const clipboardIsCut = useUIStore((s) => s.clipboardIsCut)
  const setClipboardFiles = useUIStore((s) => s.setClipboardFiles)
  const showToast = useUIStore((s) => s.showToast)
  const addAiAttachedFile = useUIStore((s) => s.addAiAttachedFile)
  const repositories = useGitStore((s) => s.repositories)
  const { t } = useTranslation()

  // Re-render when the plugin editor registry changes so the
  // "new mind map" entry disappears the moment the user disables
  // / uninstalls the plugin that owns the `.smm` extension. The
  // hook wraps the host-bus subscription, self-grants the
  // `events` permission in memory only, and exposes a fresh
  // `extensions` Set on every mutation so the conditional render
  // below picks up the new value synchronously — no manual reload
  // required. We pass the returned `revision` through to the
  // `<ContextMenuItem key>` so a fresh DOM node is mounted for
  // the menu entry the moment the underlying state flips.
  const { extensions: pluginExtensions } = usePluginEditors()
  const hasMindMapEditor = pluginExtensions.has('.smm')

  const isRootFolder = workspaceMode === 'workspace' && workspaceFolders.includes(node.path)

  // 检查节点是否在 git 仓库中
  const isInGitRepo = repositories.some((repo: GitRepository) => {
    // 节点路径等于仓库路径，或节点路径在仓库路径下
    return node.path === repo.path || node.path.startsWith(repo.path + '/')
  })
  // "同步初始化"只在不在 git 项目中时显示
  const canShowGitInit = node.isDirectory && !isInGitRepo

  const hasClipboard = clipboardFiles.length > 0
  // 粘贴菜单：剪贴板非空即可显示（文件节点粘贴到其父目录）
  const canPaste = hasClipboard
  // 粘贴目标目录：目录节点用自身路径，文件节点取父目录路径
  const targetDir = node.isDirectory
    ? node.path
    : node.path.substring(0, node.path.lastIndexOf('/'))

  const handleOpen = async () => {
    if (node.isDirectory) {
      toggleNode(node.path)
    } else {
      // 清理多选状态，与 FileTreeView.handleSelect 行为一致
      clearMultiSelection()
      setSelectedPath(node.path)
      setLastClickedPath(node.path)
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

  const handleAddToChat = () => {
    addAiAttachedFile(node.path)
    useUIStore.getState().setRightPanelType('ai')
    showToast(t('contextMenu.addedToChat', { name: node.name }))
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
    if (!canPaste || !targetDir) return

    let successCount = 0
    let failCount = 0
    let skipCount = 0

    for (const sourcePath of clipboardFiles) {
      const destPath = getDestinationPath(targetDir, sourcePath)
      // 跳过源路径与目标路径完全相同的条目（复制到自身所在目录）
      if (sourcePath === destPath) { skipCount++; continue }
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
          // 源文件已删除，使其 frontmatter 缓存失效
          const { invalidateFrontmatterCache } = await import('@/lib/utils/searchQuery')
          invalidateFrontmatterCache(sourcePath)
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
    const children = await loadDirectory(targetDir, showAllFiles, markdownOnly)
    const updatedNodes = updateNodesWithChildren(nodes, targetDir, children)
    setNodes(updatedNodes)

    if (failCount === 0 && skipCount === 0) {
      showToast(t('contextMenu.pastedSuccess', { count: successCount }))
    } else if (failCount === 0 && skipCount > 0 && successCount === 0) {
      // 全部跳过（复制到自身目录），无需提示成功
    } else {
      showToast(t('contextMenu.pastedPartial', { count: successCount, failCount }))
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('dialog.confirmDelete', { name: node.name, extra: node.isDirectory ? t('dialog.confirmDeleteDir') : '' }))) return
    try {
      await deleteFile(node.path)

      // 删除文件后使该路径的 frontmatter 缓存失效，避免残留
      const { invalidateFrontmatterCache } = await import('@/lib/utils/searchQuery')
      invalidateFrontmatterCache(node.path)

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

      // 清理文件树选中状态，与 useFileTreeActions.handleDeleteSelected 行为一致
      clearMultiSelection()
      setSelectedPath(null)
      setLastClickedPath(null)
      
      // Refresh parent
      const parent = findParentNode(node, nodes)
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
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* 新建文件/文件夹 - 仅目录显示 */}
        {node.isDirectory && (
          <>
            <ContextMenuItem
              onClick={onNewFile}
              style={{ color: 'var(--text-secondary)' }}
              className="cursor-pointer"
            >
              <FilePlus size={12} />
              <span>{t('contextMenu.newFile')}</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={onNewFolder}
              style={{ color: 'var(--text-secondary)' }}
              className="cursor-pointer"
            >
              <FolderPlus size={12} />
              <span>{t('contextMenu.newFolder')}</span>
            </ContextMenuItem>
            {/* 新建思维导图：仅当某个插件声明拥有 .smm 文件编辑器
                时才显示此菜单项。原来的 host 在 mind map 仍是内置
                编辑器时硬编码显示；现在 mind map 已迁出 host，
                没有插件就根本没有能渲染 .smm 文件的入口，菜单项
                也就失去意义。判断走 pluginEditorRegistry 而不是
                写死插件 id：以后任何插件声明 editorFileExtensions
                含 .smm 都会让该项出现，便于第三方扩展。 */}
            {hasMindMapEditor && (
              <ContextMenuItem
                onClick={onNewMindMap}
                style={{ color: 'var(--text-secondary)' }}
                className="cursor-pointer"
              >
                <GitFork size={12} />
                <span>{t('contextMenu.newMindMap')}</span>
              </ContextMenuItem>
            )}
            <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
          </>
        )}

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

        {/* 同步初始化 - 只在不在 git 项目中的文件夹显示 */}
        {canShowGitInit && (
          <>
            <ContextMenuItem onClick={handleGitInit} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
              <GitBranch size={12} />
              <span>{t('contextMenu.syncInit')}</span>
            </ContextMenuItem>
          </>
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

        {!node.isDirectory && (
          <ContextMenuItem onClick={handleAddToChat} style={{ color: 'var(--text-secondary)' }} className="cursor-pointer">
            <MessageSquare size={12} />
            <span>{t('contextMenu.addToChat')}</span>
          </ContextMenuItem>
        )}

        {(!node.isDirectory || canPaste) && (
          <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
        )}

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

        {/* Plugin-contributed items. They appear after the host's own
            items so the standard order is preserved and plugins
            extend rather than compete. The helper renders a
            separator + items only when at least one contribution
            is applicable, so it's a no-op when no plugin is
            registered. */}
        <PluginContextMenuItems
          location="fileTree"
          ctx={{ path: node.path, isDirectory: node.isDirectory }}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
