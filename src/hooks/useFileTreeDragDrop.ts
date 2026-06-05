/**
 * useFileTreeDragDrop — 文件树拖拽逻辑 hook
 * 负责：拖拽开始、悬停、离开、放置、结束
 */
import { useState, useCallback } from 'react'
import { useEditorStore, useFileTreeStore } from '@/stores'
import { useUIStore } from '@/stores/ui'
import { loadDirectory } from '@/lib/api'
import type { FileNode } from '@/stores/filetree'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { updateNodesWithChildren, findNodeByPath } from '@/lib/utils/treeUtils'

export function useFileTreeDragDrop(nodes: FileNode[]) {
  const { showAllFiles, markdownOnly, showToast } = useUIStore()
  const { expanded, toggleNode, setNodes, setSelectedPath, clearMultiSelection,
    multiSelectedPaths } = useFileTreeStore()
  const { t } = useTranslation()

  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [dragSourcePaths, setDragSourcePaths] = useState<string[]>([])

  const isValidDropTarget = useCallback((targetPath: string, sourcePaths: string[]): boolean => {
    const targetNode = findNodeByPath(targetPath, nodes)
    if (!targetNode?.isDirectory) return false
    for (const src of sourcePaths) {
      if (targetPath === src || targetPath.startsWith(src + '/')) return false
    }
    return true
  }, [nodes])

  const handleDragStart = useCallback((e: React.DragEvent, node: FileNode) => {
    e.stopPropagation()
    const paths = multiSelectedPaths.size > 1 && multiSelectedPaths.has(node.path)
      ? Array.from(multiSelectedPaths)
      : [node.path]
    setDragSourcePaths(paths)
    e.dataTransfer.setData('application/json', JSON.stringify(paths))
    e.dataTransfer.effectAllowed = 'move'
  }, [multiSelectedPaths])

  const handleDragOver = useCallback((e: React.DragEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (isValidDropTarget(node.path, dragSourcePaths)) {
      e.dataTransfer.dropEffect = 'move'
      setDragOverPath(node.path)
    } else {
      e.dataTransfer.dropEffect = 'none'
    }
  }, [dragSourcePaths, isValidDropTarget])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      setDragOverPath(null)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPath(null)

    if (!isValidDropTarget(targetNode.path, dragSourcePaths)) {
      setDragSourcePaths([])
      return
    }

    const sourcePaths = [...dragSourcePaths]
    setDragSourcePaths([])
    if (sourcePaths.length === 0) return

    let successCount = 0
    let failCount = 0

    for (const srcPath of sourcePaths) {
      const fileName = srcPath.split('/').pop() || srcPath
      const destPath = `${targetNode.path}/${fileName}`
      if (srcPath === destPath) continue

      try {
        await invoke('rename_file', { req: { old_path: srcPath, new_path: destPath } })
        const editorStore = useEditorStore.getState()
        editorStore.updateTabPath(srcPath, destPath, fileName)
        successCount++
      } catch (err) {
        console.error('Failed to move:', srcPath, err)
        failCount++
      }
    }

    const dirsToRefresh = new Set<string>()
    dirsToRefresh.add(targetNode.path)
    for (const srcPath of sourcePaths) {
      const parentPath = srcPath.substring(0, srcPath.lastIndexOf('/'))
      if (parentPath && parentPath !== targetNode.path) dirsToRefresh.add(parentPath)
    }

    if (!expanded.has(targetNode.path)) {
      await toggleNode(targetNode.path)
    }

    for (const dirPath of dirsToRefresh) {
      try {
        const children = await loadDirectory(dirPath, showAllFiles, markdownOnly)
        const currentNodes = useFileTreeStore.getState().nodes
        setNodes(updateNodesWithChildren(currentNodes, dirPath, children))
      } catch (err) {
        console.error('Failed to refresh directory:', dirPath, err)
      }
    }

    clearMultiSelection()
    setSelectedPath(targetNode.path)

    if (failCount === 0) {
      showToast(t('fileTree.moveSuccess', { count: successCount, target: targetNode.name }), 'success')
    } else {
      showToast(t('fileTree.movePartial', { success: successCount, fail: failCount }), 'error')
    }
  }, [dragSourcePaths, isValidDropTarget, expanded, toggleNode, showAllFiles, markdownOnly, setNodes, clearMultiSelection, setSelectedPath, showToast, t])

  const handleDragEnd = useCallback(() => {
    setDragOverPath(null)
    setDragSourcePaths([])
  }, [])

  return {
    dragOverPath,
    dragSourcePaths,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  }
}
