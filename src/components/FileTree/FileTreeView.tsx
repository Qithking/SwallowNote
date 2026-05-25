import { useEffect, useState, useRef } from 'react'
import { FileText, FilePlus, FolderPlus, Folder, FolderOpen, RefreshCw, ChevronRight, Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { useUIStore } from '@/stores/ui'
import { useGitStore } from '@/stores/git'
import { loadFileContent, loadDirectory } from '@/lib/api'
import { openFolderDialog, createFile } from '@/lib/tauri'
import { renameFile } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'
import { TreeNodeContextMenu } from './FileTreeContextMenu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getFileIcon } from '@/lib/utils/fileIcon'
import { useTranslation } from 'react-i18next'

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
  const { rootPath, workspaceFolders, addWorkspaceFolder, saveWorkspaceFile } = useWorkspaceStore()
  const { workspaceMode, showAllFiles, markdownOnly, showToast } = useUIStore()
  const { addTab, updateTabPath } = useEditorStore()
  const { nodes, expanded, selectedPath, isLoading, setSelectedPath, toggleNode, setNodes, refreshNode, refreshExpanded } = useFileTreeStore()
  const { cachedRepositories, isPulling, pullAllRepos } = useGitStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const editingCommitRef = useRef(false)
  const newItemCommitRef = useRef(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { t } = useTranslation()

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      // Determine the directory to refresh based on current selection
      let targetDir: string | null = null
      if (selectedPath) {
        const selectedNode = findNodeByPath(selectedPath, nodes)
        if (selectedNode?.isDirectory) {
          targetDir = selectedPath
        }
        // If a file is selected, find its parent directory
        else if (selectedPath) {
          const parentPath = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
          const parentNode = findNodeByPath(parentPath, nodes)
          if (parentNode?.isDirectory) {
            targetDir = parentPath
          }
        }
      }

      if (targetDir) {
        // Case 1: A directory is selected - refresh only that directory and its repo
        const currentRepo = cachedRepositories.find(r =>
          targetDir === r.path || targetDir.startsWith(r.path + '/')
        )

        const refreshPromise = refreshNode(targetDir)
        const pullPromise = currentRepo
          ? pullAllRepos([currentRepo])
          : Promise.resolve([] as import('@/stores/git').PullResult[])

        const [, pullResults] = await Promise.all([refreshPromise, pullPromise])
        showPullToast(pullResults)
      } else {
        // Case 2: No directory selected - refresh all root nodes and their repos
        const paths = workspaceMode === 'workspace'
          ? workspaceFolders
          : (rootPath ? [rootPath] : [])
        const currentRepos = paths
          .map(p => cachedRepositories.find(r => p === r.path || p.startsWith(r.path + '/')))
          .filter((r): r is NonNullable<typeof r> => r != null)
          .filter((r, i, arr) => arr.findIndex(x => x.path === r.path) === i)

        const refreshPromise = refreshExpanded()
        const pullPromise = currentRepos.length > 0
          ? pullAllRepos(currentRepos)
          : Promise.resolve([] as import('@/stores/git').PullResult[])

        const [, pullResults] = await Promise.all([refreshPromise, pullPromise])
        showPullToast(pullResults)
      }
    } catch (e) {
      console.error('Failed to refresh:', e)
    } finally {
      setIsRefreshing(false)
    }
  }

  const showPullToast = (pullResults: import('@/stores/git').PullResult[]) => {
    if (!Array.isArray(pullResults) || pullResults.length === 0) return
    const successCount = pullResults.filter(r => r.success).length
    const conflictRepos = pullResults.filter(r => r.isConflict)
    const failCount = pullResults.filter(r => !r.success && !r.isConflict).length

    // Show conflict-specific toast for repos with merge conflicts
    if (conflictRepos.length > 0) {
      const repoNames = conflictRepos.map(r => r.name).join(', ')
      showToast(t('git.pullConflict', { repos: repoNames }), 'error')
    }

    // Show other failures
    if (failCount > 0) {
      showToast(t('git.pullResult', { success: successCount, fail: failCount }), 'error')
    } else if (successCount > 0 && conflictRepos.length === 0) {
      showToast(t('git.pullSuccess', { count: successCount }), 'success')
    }
  }

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
  const [isNewItemFirstEdit, setIsNewItemFirstEdit] = useState(false)

  const handleStartEdit = (path: string, name: string, isDirectory: boolean) => {
    // 保存完整文件名，useEffect 中会设置选中范围
    setEditingPath(path)
    setEditingName(name)
    setEditingType(isDirectory ? 'folder' : 'file')
    setIsFirstEdit(true) // 初次编辑，选中文件名
  }

  useEffect(() => {
    // 延迟到下一帧确保 DOM 已更新
    requestAnimationFrame(() => {
      if (!inputRef.current) return

      if (editingPath !== null) {
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
      } else if (newItem !== null) {
        inputRef.current.focus()
        if (isNewItemFirstEdit) {
          const name = newItem.name
          if (newItem.type === 'file' && name.includes('.')) {
            const lastDot = name.lastIndexOf('.')
            inputRef.current.setSelectionRange(0, lastDot)
          } else {
            inputRef.current.select()
          }
          setIsNewItemFirstEdit(false)
        }
      }
    })
  }, [editingPath, newItem, editingName, nodes, isFirstEdit, isNewItemFirstEdit])

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
    if (path) {
      if (workspaceMode === 'workspace') {
        await addWorkspaceFolder(path)
      } else {
        useWorkspaceStore.getState().openFolder(path)
      }
    }
  }

  const handleFinishEdit = async () => {
    if (editingCommitRef.current) return // 防止 Enter + onBlur 重复触发
    editingCommitRef.current = true

    if (!editingPath || !editingName.trim()) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      editingCommitRef.current = false
      return
    }

    const node = findNodeByPath(editingPath, nodes)
    if (!node) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      editingCommitRef.current = false
      return
    }

    // 检查文件名是否改变
    if (editingName.trim() === node.name) {
      setEditingPath(null)
      setEditingName('')
      setEditingType(null)
      editingCommitRef.current = false
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
        const children = await loadDirectory(parent.path, showAllFiles, markdownOnly)
        const updatedNodes = updateNodesWithChildren(nodes, parent.path, children)
        setNodes(updatedNodes)
      } else {
        // 根节点重命名，刷新根
        const children = await loadDirectory(rootPath || editingPath, showAllFiles, markdownOnly)
        const rootNode: FileNode = {
          id: 'root',
          name: rootPath?.split(/[\\/]/).pop() || rootPath || '',
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
    editingCommitRef.current = false
  }

  const handleCancelEdit = () => {
    setEditingPath(null)
    setEditingName('')
    setEditingType(null)
  }

  const handleNewFile = async () => {
    if (!selectedPath) return
    const selected = findNodeByPath(selectedPath, nodes)
    if (!selected || !selected.isDirectory) return

    // Ensure the directory is expanded and children are loaded before showing the input
    if (!expanded.has(selected.path)) {
      await toggleNode(selected.path)
    }
    // Re-read nodes after toggleNode may have loaded children
    const currentNode = findNodeByPath(selected.path, useFileTreeStore.getState().nodes)
    const siblings = currentNode?.children || []
    const name = generateUniqueName(t('fileTree.defaultFileName'), siblings)
    setNewItem({ parentPath: selected.path, name, type: 'file' })
    setIsNewItemFirstEdit(true)
  }

  const handleNewFolder = async () => {
    if (!selectedPath) return
    const selected = findNodeByPath(selectedPath, nodes)
    if (!selected || !selected.isDirectory) return

    // Ensure the directory is expanded and children are loaded before showing the input
    if (!expanded.has(selected.path)) {
      await toggleNode(selected.path)
    }
    // Re-read nodes after toggleNode may have loaded children
    const currentNode = findNodeByPath(selected.path, useFileTreeStore.getState().nodes)
    const siblings = currentNode?.children || []
    const name = generateUniqueName(t('fileTree.defaultFolderName'), siblings)
    setNewItem({ parentPath: selected.path, name, type: 'folder' })
    setIsNewItemFirstEdit(true)
  }

  const handleFinishNewItem = async () => {
    if (newItemCommitRef.current) return // 防止 Enter + onBlur 重复触发
    newItemCommitRef.current = true

    if (!newItem || !newItem.name.trim()) {
      setNewItem(null)
      newItemCommitRef.current = false
      return
    }

    try {
      const fullPath = newItem.parentPath + '/' + newItem.name.trim()
      await createFile(fullPath, newItem.type === 'folder')
      const children = await loadDirectory(newItem.parentPath, showAllFiles, markdownOnly)
      const updatedNodes = updateNodesWithChildren(nodes, newItem.parentPath, children)
      setNodes(updatedNodes)
    } catch (e) {
      console.error('Failed to create:', e)
    }

    setNewItem(null)
    newItemCommitRef.current = false
  }

  const handleCancelNewItem = () => {
    setNewItem(null)
  }

  const handleNewItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault() // 防止触发 onBlur 重复提交
      handleFinishNewItem()
    } else if (e.key === 'Escape') {
      handleCancelNewItem()
    }
  }

  const isSelectedDirectory = selectedPath ? (findNodeByPath(selectedPath, nodes)?.isDirectory ?? false) : false

  const renderNode = (node: FileNode, depth: number): React.ReactNode => {
    const isNewItemNode = newItem?.parentPath === node.path
    const isEditing = editingPath === node.path
    const isSelected = node.path === selectedPath

    const nodeContent = (
      <div
        data-path={node.path}
        className={`flex items-center h-[22px] cursor-pointer select-none gap-1 text-xs ${isEditing || isSelected ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => !isEditing && handleSelect(node)}
      >
        {node.isDirectory ? (
          node.isLoading ? (
            <Loader2 size={12} className="animate-spin shrink-0" />
          ) : (
            <ChevronRight
              size={12}
              className={`transition-transform shrink-0 ${expanded.has(node.path) ? 'rotate-90' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.path)
              }}
            />
          )
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        {node.isDirectory ? (
          <Folder size={12} className="text-[#666666]" />
        ) : (
          getFileIcon(node.name)
        )}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-xs text-[var(--text-primary)]"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleFinishEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // 防止触发 onBlur 重复提交
                handleFinishEdit()
              } else if (e.key === 'Escape') {
                handleCancelEdit()
              }
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
        {expanded.has(node.path) && (
          <>
            {node.children?.map((child) => renderNode(child, depth + 1))}
            {/* New item input - rendered whenever a new item is pending under this directory */}
            {isNewItemNode && (
              <div
                className="flex items-center h-[22px] gap-1 text-xs text-[var(--text-secondary)]"
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <span className="w-[14px]" />
                {newItem.type === 'folder' ? (
                  <Folder size={12} className="text-[#666666]" />
                ) : (
                  getFileIcon(newItem.name || 'newfile')
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
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
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewFile} disabled={!isSelectedDirectory}>
                    <FilePlus size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('fileTree.newFile')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewFolder} disabled={!isSelectedDirectory}>
                    <FolderPlus size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('fileTree.newFolder')}</TooltipContent>
              </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh} disabled={isRefreshing || isPulling}>
                <RefreshCw size={12} className={isRefreshing || isPulling ? 'animate-spin' : ''} />
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
          <>
            {nodes.map((node) => renderNode(node, 0))}
            {/* 根目录下新建（当根目录没有直属子节点时） */}
            {newItem && nodes.length === 1 && nodes[0].children?.length === 0 && (
              <div
                className="flex items-center h-[22px] gap-1 text-xs text-[var(--text-secondary)]"
                style={{ paddingLeft: `${12 + 8}px` }}
              >
                <span className="w-[14px]" />
                {newItem.type === 'folder' ? (
                  <Folder size={12} className="text-[#666666]" />
                ) : (
                  <FileText size={12} style={{ color: '#569cd6' }} />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 h-[18px] px-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded outline-none text-sm text-[var(--text-primary)]"
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
            <FolderOpen size={24} className="mb-2 opacity-50" />
            <p>{t('fileTree.noFolderOpened')}</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
