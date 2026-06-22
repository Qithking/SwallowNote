/**
 * useFileTreeActions — 文件树操作逻辑 hook
 * 负责：重命名、新建文件/文件夹/思维导图、删除
 */
import { useState, useRef, useEffect } from 'react'
import { useWorkspaceStore, useEditorStore, useFileTreeStore } from '@/stores'
import { useUIStore } from '@/stores/ui'
import { loadDirectory } from '@/lib/api'
import { createFile, deleteFile as deleteFileTauri, renameFile, writeFile } from '@/lib/tauri'
import { injectDefaultFrontmatter } from '@/lib/utils/frontmatter'
import type { FileNode } from '@/stores/filetree'
import { useTranslation } from 'react-i18next'
import {
  updateNodesWithChildren,
  findNodeByPath,
  findParentNode,
  generateUniqueName,
} from '@/lib/utils/treeUtils'

export interface NewItemState {
  parentPath: string
  name: string
  type: 'file' | 'folder' | 'mindmap'
}

export function useFileTreeActions() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const updateTabPath = useEditorStore((s) => s.updateTabPath)
  const showAllFiles = useUIStore((s) => s.showAllFiles)
  const markdownOnly = useUIStore((s) => s.markdownOnly)
  const showToast = useUIStore((s) => s.showToast)
  const nodes = useFileTreeStore((s) => s.nodes)
  const expanded = useFileTreeStore((s) => s.expanded)
  const selectedPath = useFileTreeStore((s) => s.selectedPath)
  const toggleNode = useFileTreeStore((s) => s.toggleNode)
  const setNodes = useFileTreeStore((s) => s.setNodes)
  const setSelectedPath = useFileTreeStore((s) => s.setSelectedPath)
  const multiSelectedPaths = useFileTreeStore((s) => s.multiSelectedPaths)
  const setLastClickedPath = useFileTreeStore((s) => s.setLastClickedPath)
  const clearMultiSelection = useFileTreeStore((s) => s.clearMultiSelection)
  const { t } = useTranslation()

  const inputRef = useRef<HTMLInputElement>(null)
  const editingCommitRef = useRef(false)
  const newItemCommitRef = useRef(false)

  // 重命名状态
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // _editingType 保留以备未来功能扩展使用
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_editingType, setEditingType] = useState<'file' | 'folder' | null>(null)
  const [isFirstEdit, setIsFirstEdit] = useState(true)

  // 新建状态
  const [newItem, setNewItem] = useState<NewItemState | null>(null)
  const [isNewItemFirstEdit, setIsNewItemFirstEdit] = useState(false)

  // 自动聚焦并选中输入框内容
  useEffect(() => {
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      if (editingPath !== null) {
        inputRef.current.focus()
        if (isFirstEdit) {
          const editingNode = findNodeByPath(editingPath, nodes)
          if (editingNode && !editingNode.isDirectory && editingName.includes('.')) {
            inputRef.current.setSelectionRange(0, editingName.lastIndexOf('.'))
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
            inputRef.current.setSelectionRange(0, name.lastIndexOf('.'))
          } else {
            inputRef.current.select()
          }
          setIsNewItemFirstEdit(false)
        }
      }
    })
  }, [editingPath, newItem, editingName, nodes, isFirstEdit, isNewItemFirstEdit])

  const handleStartEdit = (path: string, name: string, isDirectory: boolean) => {
    setEditingPath(path)
    setEditingName(name)
    setEditingType(isDirectory ? 'folder' : 'file')
    setIsFirstEdit(true)
  }

  const handleFinishEdit = async () => {
    if (editingCommitRef.current) return
    editingCommitRef.current = true

    if (!editingPath || !editingName.trim()) {
      setEditingPath(null); setEditingName(''); setEditingType(null)
      editingCommitRef.current = false
      return
    }

    const node = findNodeByPath(editingPath, nodes)
    if (!node || editingName.trim() === node.name) {
      setEditingPath(null); setEditingName(''); setEditingType(null)
      editingCommitRef.current = false
      return
    }

    try {
      const parent = findParentNode(node, nodes)
      const parentPath = parent?.path || rootPath || ''
      const newName = editingName.trim()
      const newPath = parentPath + '/' + newName
      await renameFile(editingPath, newPath)
      updateTabPath(editingPath, newPath, newName)

      if (parent) {
        const children = await loadDirectory(parent.path, showAllFiles, markdownOnly)
        setNodes(updateNodesWithChildren(nodes, parent.path, children))
      } else {
        const children = await loadDirectory(rootPath || editingPath, showAllFiles, markdownOnly)
        setNodes([{ id: 'root', name: rootPath?.split(/[\\/]/).pop() || rootPath || '', path: rootPath || '', isDirectory: true, children }])
      }
    } catch (e) {
      console.error('Failed to rename:', e)
    }

    setEditingPath(null); setEditingName(''); setEditingType(null)
    editingCommitRef.current = false
  }

  const handleCancelEdit = () => {
    setEditingPath(null); setEditingName(''); setEditingType(null)
  }

  /**
   * Unified handler for creating new files, folders, and mind maps.
   * All three creation flows share identical logic — only the type and
   * default name differ.
   */
  const handleNewItem = async (type: 'file' | 'folder' | 'mindmap', dirPath?: string) => {
    const targetPath = dirPath || selectedPath
    if (!targetPath) return
    const selected = findNodeByPath(targetPath, nodes)
    if (!selected || !selected.isDirectory) return

    if (!expanded.has(selected.path)) {
      await toggleNode(selected.path)
    }
    const currentNode = findNodeByPath(selected.path, useFileTreeStore.getState().nodes)
    const siblings = currentNode?.children || []

    const defaultNameMap: Record<'file' | 'folder' | 'mindmap', string> = {
      file: t('fileTree.defaultFileName'),
      folder: t('fileTree.defaultFolderName'),
      mindmap: t('fileTree.defaultMindMapName'),
    }
    const name = generateUniqueName(defaultNameMap[type], siblings)

    setSelectedPath(selected.path)
    setNewItem({ parentPath: selected.path, name, type })
    setIsNewItemFirstEdit(true)
  }

  const handleFinishNewItem = async () => {
    if (newItemCommitRef.current) return
    newItemCommitRef.current = true

    if (!newItem || !newItem.name.trim()) {
      setNewItem(null)
      newItemCommitRef.current = false
      return
    }

    try {
      const fullPath = newItem.parentPath + '/' + newItem.name.trim()
      if (newItem.type === 'mindmap') {
        const defaultMindMapData = {
          root: { data: { text: newItem.name.replace(/\.smm$/i, '') }, children: [] },
          theme: 'default',
          layout: 'logicalStructure',
        }
        await createFile(fullPath, false)
        const { writeFile } = await import('@/lib/tauri')
        await writeFile(fullPath, JSON.stringify(defaultMindMapData, null, 2))
      } else if (newItem.type === 'folder') {
        await createFile(fullPath, true)
      } else {
        await createFile(fullPath, false)
        if (fullPath.endsWith('.md')) {
          await writeFile(fullPath, injectDefaultFrontmatter(newItem.name.trim()))
        }
      }
      const children = await loadDirectory(newItem.parentPath, showAllFiles, markdownOnly)
      setNodes(updateNodesWithChildren(nodes, newItem.parentPath, children))
    } catch (e) {
      console.error('Failed to create:', e)
    }

    setNewItem(null)
    newItemCommitRef.current = false
  }

  const handleCancelNewItem = () => setNewItem(null)

  const handleDeleteSelected = async () => {
    const pathsToDelete = multiSelectedPaths.size > 1
      ? Array.from(multiSelectedPaths)
      : (selectedPath ? [selectedPath] : [])

    if (pathsToDelete.length === 0) return

    const confirmMsg = pathsToDelete.length === 1
      ? t('dialog.confirmDelete', {
          name: pathsToDelete[0].split('/').pop() || pathsToDelete[0],
          extra: (() => {
            const node = findNodeByPath(pathsToDelete[0], nodes)
            return node?.isDirectory ? t('dialog.confirmDeleteDir') : ''
          })(),
        })
      : t('dialog.confirmDeleteMulti', { count: pathsToDelete.length })

    if (!confirm(confirmMsg)) return

    let successCount = 0
    let failCount = 0

    for (const path of pathsToDelete) {
      try {
        await deleteFileTauri(path)
        const editorStore = useEditorStore.getState()
        const node = findNodeByPath(path, nodes)
        const tabsToClose = editorStore.tabs.filter(tab =>
          node?.isDirectory ? (tab.path === path || tab.path.startsWith(path + '/')) : tab.path === path
        )
        for (const tab of tabsToClose) editorStore.removeTab(tab.id)
        successCount++
      } catch (e) {
        console.error('Failed to delete:', path, e)
        failCount++
      }
    }

    clearMultiSelection()
    setSelectedPath(null)
    setLastClickedPath(null)

    const parentDirs = new Set<string>()
    for (const path of pathsToDelete) {
      const lastSlash = path.lastIndexOf('/')
      if (lastSlash > 0) parentDirs.add(path.substring(0, lastSlash))
    }
    for (const dirPath of parentDirs) {
      try {
        const children = await loadDirectory(dirPath, showAllFiles, markdownOnly)
        const currentNodes = useFileTreeStore.getState().nodes
        setNodes(updateNodesWithChildren(currentNodes, dirPath, children))
      } catch (e) {
        console.error('Failed to refresh directory:', dirPath, e)
      }
    }

    if (failCount === 0) {
      showToast(t('fileTree.deleteSuccess', { count: successCount }), 'success')
    } else {
      showToast(t('fileTree.deletePartial', { success: successCount, fail: failCount }), 'error')
    }
  }

  return {
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
  }
}

/** Type-safe node for the FileNode type used in this hook */
export type { FileNode }
