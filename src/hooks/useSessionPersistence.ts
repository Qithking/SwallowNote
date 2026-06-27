/**
 * useSessionPersistence — 会话状态持久化 hook
 * 负责：保存/恢复标签页、文件树展开状态、侧边栏宽度、窗口尺寸等
 * 从 App.tsx 提取，保持 App.tsx 职责清晰
 */
import { useCallback } from 'react'
import { useUIStore, useEditorStore, useFileTreeStore, useEditorSettingsStore, type EditorTab, type EditorViewMode } from '@/stores'
import { useWorkspaceStore } from '@/stores'
import { saveSessionState, getSessionState } from '@/lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'

export function useSessionPersistence() {
  const { setSidebarWidth, setRightPanelWidth } = useUIStore()

  const saveSessionStateNow = useCallback(async () => {
    try {
      const editorState = useEditorStore.getState()
      const fileTreeState = useFileTreeStore.getState()
      const uiState = useUIStore.getState()
      const editorSettingsState = useEditorSettingsStore.getState()

      const fileTabs = editorState.tabs
      const tabsData = fileTabs.map(tab => {
        if (tab.type === 'conflict') {
          return {
            id: tab.id,
            path: tab.path,
            name: tab.name,
            type: tab.type,
            conflictRepoPath: tab.conflictRepoPath,
            conflictRepoName: tab.conflictRepoName,
            conflictAutoHideTree: tab.conflictAutoHideTree,
            conflictSelectedFile: tab.conflictSelectedFile,
            conflictCursorLine: tab.conflictCursorLine,
            viewMode: tab.viewMode,
          }
        }
        return {
          id: tab.id,
          path: tab.path,
          name: tab.name,
          viewMode: tab.viewMode,
          cursorPosition: tab.cursorPosition,
        }
      })

      const activeTabId = fileTabs.find(t => t.id === editorState.activeTabId)?.id || (fileTabs.length > 0 ? fileTabs[0].id : '')

      let windowWidth = '', windowHeight = '', windowX = '', windowY = '', isMaximized = '', isFullscreen = ''
      try {
        const win = getCurrentWindow()
        isMaximized = String(await win.isMaximized())
        isFullscreen = String(await win.isFullscreen())
        if (isMaximized !== 'true' && isFullscreen !== 'true') {
          const size = await win.innerSize()
          const scaleFactor = await win.scaleFactor()
          windowWidth = String(Math.round(size.width / scaleFactor))
          windowHeight = String(Math.round(size.height / scaleFactor))
          const position = await win.outerPosition()
          windowX = String(Math.round(position.x / scaleFactor))
          windowY = String(Math.round(position.y / scaleFactor))
        }
      } catch (e) {
        console.error('Failed to save window size:', e)
      }

      const updates: Record<string, string> = {
        tabs: JSON.stringify(tabsData),
        activeTabId,
        expanded: JSON.stringify(Array.from(fileTreeState.expanded)),
        selectedPath: fileTreeState.selectedPath || '',
        sidebarWidth: String(uiState.sidebarWidth),
        rightPanelWidth: String(uiState.rightPanelWidth),
        editorViewMode: uiState.editorViewMode,
        windowWidth,
        windowHeight,
        windowX,
        windowY,
        isMaximized,
        isFullscreen,
        editor_h1Size: String(editorSettingsState.h1Size),
        editor_h2Size: String(editorSettingsState.h2Size),
        editor_h3Size: String(editorSettingsState.h3Size),
        editor_h4Size: String(editorSettingsState.h4Size),
        editor_h5Size: String(editorSettingsState.h5Size),
        editor_bodySize: String(editorSettingsState.bodySize),
        editor_lineHeight: String(editorSettingsState.lineHeight),
        editor_letterSpacing: String(editorSettingsState.letterSpacing),
        editor_paragraphSpacing: String(editorSettingsState.paragraphSpacing),
        editor_firstLineIndent: String(editorSettingsState.firstLineIndent),
        editor_normalPaddingVertical: String(editorSettingsState.normalPaddingVertical),
        editor_normalPaddingHorizontal: String(editorSettingsState.normalPaddingHorizontal),
        editor_widePaddingVertical: String(editorSettingsState.widePaddingVertical),
        editor_widePaddingHorizontal: String(editorSettingsState.widePaddingHorizontal),
      }

      await saveSessionState(updates)
    } catch (e) {
      console.error('Failed to save session state:', e)
    }
  }, [])

  const restoreSessionState = useCallback(async () => {
    try {
      const states = await getSessionState()
      if (Object.keys(states).length === 0) return

      const { workspaceMode } = useUIStore.getState()
      const { rootPath, workspaceFolders } = useWorkspaceStore.getState()
      
      // 文件树为空时跳过会话恢复（loadLatestByMode 已 await 完成文件树加载，无需轮询）
      if (useFileTreeStore.getState().nodes.length === 0) {
        console.warn('File tree not loaded, skipping session restore')
        return
      }

      if (states.tabs) {
        const tabsData = JSON.parse(states.tabs) as Partial<EditorTab>[]
        const validTabs = tabsData.filter((tab): tab is Partial<EditorTab> => {
          if (!tab.path) return false
          // Conflict tabs are validated against the conflict repo database later
          if (tab.type === 'conflict') return true
          if (workspaceMode === 'workspace') {
            return workspaceFolders.some((f: string) => tab.path!.startsWith(f))
          }
          return !!(rootPath && tab.path.startsWith(rootPath))
        })
        if (validTabs.length > 0) {
          const restoredTabs: EditorTab[] = validTabs.map((tab) => ({
            id: tab.id || '',
            path: tab.path || '',
            name: tab.name || '',
            content: undefined as unknown as string, // Mark as not loaded yet (will trigger auto-load)
            isDirty: false,
            isEdited: false,
            type: tab.type || 'file',
            conflictRepoPath: tab.conflictRepoPath,
            conflictRepoName: tab.conflictRepoName,
            conflictAutoHideTree: tab.conflictAutoHideTree ?? false,
            conflictSelectedFile: tab.conflictSelectedFile,
            conflictCursorLine: tab.conflictCursorLine,
            viewMode: tab.viewMode || 'preview',
            fileSize: tab.fileSize,
            modifiedTime: tab.modifiedTime,
            wordCount: tab.wordCount,
          }))
          const activeTabId = states.activeTabId || null

          // Load conflict repos into the git store BEFORE restoring tabs,
          // so ConflictResolver can find conflict data when it mounts
          try {
            const { useGitStore } = await import('@/stores')
            await useGitStore.getState().loadConflictRepos()
          } catch (e) {
            console.error('Failed to load conflict repos before restore:', e)
          }

          useEditorStore.getState().restoreTabs(restoredTabs, activeTabId)
          
          // Delay loading tab content to ensure UI is ready
          if (activeTabId) {
            const activeTab = restoredTabs.find(t => t.id === activeTabId)
            // Only load content for file tabs, not for conflict/diff tabs
            if (activeTab?.type === 'file' || !activeTab?.type) {
              setTimeout(() => {
                useEditorStore.getState().loadTabContent(activeTabId)
              }, 100)
            }
          }

          // Validate conflict tabs: remove those whose repos no longer have conflicts
          try {
            const { getConflictRepoRecords } = await import('@/lib/tauri')
            const conflictRecords = await getConflictRepoRecords()
            const conflictRepoPaths = new Set(conflictRecords.map(r => r.repo_path))
            const editorStore = useEditorStore.getState()
            const conflictTabs = editorStore.tabs.filter(t => t.type === 'conflict')
            for (const tab of conflictTabs) {
              if (!conflictRepoPaths.has(tab.conflictRepoPath || tab.path)) {
                editorStore.removeTab(tab.id)
              }
            }
          } catch (e) {
            console.error('Failed to validate conflict tabs during restore:', e)
          }
        }
      }

      // 文件树定位由 TabBar 的 useEffect 监听 activeTabId 统一处理，
      // restoreTabs 设置 activeTabId 后会自动触发 revealPath，无需在此重复调用。

      if (states.sidebarWidth) setSidebarWidth(Number(states.sidebarWidth))
      if (states.rightPanelWidth) setRightPanelWidth(Number(states.rightPanelWidth))
      if (states.editorViewMode) {
        useUIStore.getState().setEditorViewMode(states.editorViewMode as EditorViewMode)
      }

      // 恢复窗口尺寸和位置
      const win = getCurrentWindow()
      try {
        if (states.isMaximized === 'true') {
          await win.maximize()
        } else if (states.isFullscreen === 'true') {
          await win.setFullscreen(true)
        } else {
          // 并行恢复窗口尺寸与位置，减少串行等待
          const ops: Promise<unknown>[] = []
          if (states.windowWidth && states.windowHeight) {
            const width = Number(states.windowWidth)
            const height = Number(states.windowHeight)
            if (width > 0 && height > 0) {
              ops.push(win.setSize(new LogicalSize(width, height)))
            }
          }
          if (states.windowX && states.windowY) {
            const x = Number(states.windowX)
            const y = Number(states.windowY)
            const screen = window.screen
            const isValidPosition = !isNaN(x) && !isNaN(y) &&
              x >= -200 && x < screen.availWidth &&
              y >= -200 && y < screen.availHeight
            if (isValidPosition) {
              ops.push(win.setPosition(new LogicalPosition(x, y)))
            }
          }
          if (ops.length > 0) {
            await Promise.all(ops)
          }
        }
      } catch (e) {
        console.error('Failed to restore window size:', e)
      }
    } catch (e) {
      console.error('Failed to restore session state:', e)
    }
  }, [setSidebarWidth, setRightPanelWidth])

  return { saveSessionStateNow, restoreSessionState }
}
