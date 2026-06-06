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
      
      // Wait for file tree to be ready (non-empty nodes)
      let waitCount = 0
      const maxWait = 50 // Max 5 seconds (50 * 100ms)
      while (useFileTreeStore.getState().nodes.length === 0 && waitCount < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      
      if (useFileTreeStore.getState().nodes.length === 0) {
        console.warn('File tree not loaded after waiting, skipping session restore')
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
            // Also load conflict repos into the git store
            const { useGitStore } = await import('@/stores')
            useGitStore.getState().loadConflictRepos()
          } catch (e) {
            console.error('Failed to validate conflict tabs during restore:', e)
          }
        }
      }

      if (states.activeTabId) {
        const editorState = useEditorStore.getState()
        const activeTab = editorState.tabs.find((t) => t.id === states.activeTabId)
        if (activeTab?.path) {
          // Only expand the directory path for the active tab's file,
          // not all previously expanded directories (avoid flash of expanded-then-collapsed dirs)
          await useFileTreeStore.getState().revealPath(activeTab.path, 
            workspaceMode === 'workspace' && workspaceFolders.length > 0
              ? workspaceFolders.find((f: string) => activeTab.path.startsWith(f)) || rootPath!
              : rootPath!
          )
        }
      }

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
          if (states.windowWidth && states.windowHeight) {
            const width = Number(states.windowWidth)
            const height = Number(states.windowHeight)
            if (width > 0 && height > 0) {
              await win.setSize(new (await import('@tauri-apps/api/dpi')).LogicalSize(width, height))
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
              await win.setPosition(new (await import('@tauri-apps/api/dpi')).LogicalPosition(x, y))
            }
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
