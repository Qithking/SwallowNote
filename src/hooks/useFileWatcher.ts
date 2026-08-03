/**
 * useFileWatcher — 文件监听 hook
 * 监听 Tauri file-watcher-event，处理文件修改/创建/删除/重命名事件，
 * 更新编辑器标签页和文件树状态。Git 同步期间跳过避免干扰。
 * 从 App.tsx 提取，保持行为不变。
 */
import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useEditorStore, useFileTreeStore, useGitStore, useUIStore, useWorkspaceStore } from '@/stores'

export function useFileWatcher() {
  useEffect(() => {
    const unlisten = listen('file-watcher-event', (event) => {
      const { type, path } = event.payload as { type: string; path: string }

      // Git sync 期间跳过文件事件避免干扰
      const gitStore = useGitStore.getState()
      if (gitStore.isPulling || gitStore.syncStatus.isSyncing) {
        return
      }

      if (type === 'modified') {
        const editorStore = useEditorStore.getState()
        // Skip if this path is currently being saved (atomic write may trigger modified event)
        if (editorStore.isPathSaving(path)) return
        const tab = editorStore.tabs.find(t => t.path === path)
        if (tab && tab.type !== 'conflict') {
          if (tab.isDirty) {
            editorStore.markExternalChange(tab.id)
          } else {
            // 强制重载覆盖缓存内容
            editorStore.loadTabContent(tab.id, 0, true)
          }
        }
      } else if (type === 'created' || type === 'removed' || type === 'renamed') {
        // Close tabs for removed files
        if (type === 'removed') {
          const editorStore = useEditorStore.getState()
          // 原子写 .tmp→rename 可能触发 remove 事件
          if (editorStore.isPathSaving(path)) return
          // Check if removed path matches any open tab or is a parent of a tab
          const tabsToClose = editorStore.tabs.filter(tab =>
            tab.path === path || tab.path.startsWith(path + '/')
          )
          for (const tab of tabsToClose) {
            editorStore.removeTab(tab.id)
          }

          // 清理文件树选中状态：若删除的是当前选中文件/其父目录，则清空 selectedPath
          const fileTreeStore = useFileTreeStore.getState()
          const currentSelectedPath = fileTreeStore.selectedPath
          if (currentSelectedPath && (currentSelectedPath === path || currentSelectedPath.startsWith(path + '/'))) {
            fileTreeStore.setSelectedPath(null)
            fileTreeStore.clearMultiSelection()
            fileTreeStore.setLastClickedPath(null)
          }
        }

        const { workspaceMode } = useUIStore.getState()
        const { rootPath, workspaceFolders } = useWorkspaceStore.getState()
        const parentPath = path.substring(0, path.lastIndexOf('/'))

        if (workspaceMode === 'workspace') {
          for (const folder of workspaceFolders) {
            if (parentPath === folder || parentPath.startsWith(folder + '/')) {
              const fileTreeStore = useFileTreeStore.getState()
              fileTreeStore.refreshNodeDebounced(parentPath)
              break
            }
          }
        } else if (rootPath && (parentPath === rootPath || parentPath.startsWith(rootPath + '/'))) {
          const fileTreeStore = useFileTreeStore.getState()
          fileTreeStore.refreshNodeDebounced(parentPath)
        }
      }
    })

    return () => { unlisten.then(fn => fn()) }
  }, [])
}
