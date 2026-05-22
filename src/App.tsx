import '@/i18n'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { SettingsView } from '@/components/Settings/SettingsView'
import { AIView } from '@/components/AI/AIView'
import { DirectoryView } from '@/components/Directory/DirectoryView'
import { HistoryView } from '@/components/History/HistoryView'
import { EditorSettings } from '@/components/EditorSettings/EditorSettings'
import { StatusBar } from '@/components/StatusBar'
import { useUIStore, useWorkspaceStore, useEditorStore, useFileTreeStore, useEditorSettingsStore } from '@/stores'
import { useTheme, useKeyboardShortcuts } from '@/hooks'
import { TooltipProvider } from '@/components'
import { Toaster } from 'sonner'
import { useState, useCallback, useEffect, useRef } from 'react'
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'
import { saveSessionState, getSessionState, setAppLocale } from '@/lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

function App() {
  useTheme()
  useKeyboardShortcuts()
  const { t } = useTranslation()
  const { settingsPanelVisible, rightPanelType, sidebarWidth, rightPanelWidth, setSidebarWidth, setRightPanelWidth } = useUIStore()
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isHoveringLeft, setIsHoveringLeft] = useState(false)
  const [isHoveringRight, setIsHoveringRight] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [dirtyFileNames, setDirtyFileNames] = useState<string[]>([])
  const [showLoadErrorDialog, setShowLoadErrorDialog] = useState(false)
  const [failedTabInfo, setFailedTabInfo] = useState<{ id: string; path: string; name: string } | null>(null)
  const pendingCloseRef = useRef(false)

  useEffect(() => {
    const init = async () => {
      const { initMode, loadLatestByMode } = useWorkspaceStore.getState()
      const { loadSettings: loadEditorSettings } = useEditorSettingsStore.getState()
      const { loadSettings: loadUISettings } = useUIStore.getState()
      await initMode()
      await loadLatestByMode()
      await Promise.all([
        restoreSessionState(),
        loadEditorSettings(),
        loadUISettings(),
      ])
      // Sync current i18n language to the Rust backend
      const { default: i18n } = await import('i18next')
      setAppLocale(i18n.language).catch(() => {})
    }
    init()
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    const unlisten = win.listen('tauri://close-requested', async () => {
      const { closeWithoutExit } = useUIStore.getState()
      const dirtyCount = useEditorStore.getState().getDirtyTabsCount()
      if (dirtyCount > 0) {
        const dirtyTabs = useEditorStore.getState().tabs.filter((t) => t.isDirty)
        const names = dirtyTabs.slice(0, 5).map((t) => t.name)
        if (dirtyTabs.length > 5) names.push('...')
        setDirtyFileNames(names)
        setShowSaveDialog(true)
        pendingCloseRef.current = true
      } else if (closeWithoutExit) {
        await saveSessionStateNow()
        await win.hide()
        const { setDockIconVisibility } = await import('@/lib/tauri')
        setDockIconVisibility(false).catch(() => {})
      } else {
        await saveSessionStateNow()
        await win.destroy()
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  useEffect(() => {
    const handleSaveError = (e: Event) => {
      const detail = (e as CustomEvent).detail
      toast.error(t('common.save') + `: ${detail.path}`, { description: String(detail.error) })
    }
    window.addEventListener('save-error', handleSaveError)
    return () => { window.removeEventListener('save-error', handleSaveError) }
  }, [])

  useEffect(() => {
    const handleTabLoadError = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setFailedTabInfo({ id: detail.id, path: detail.path, name: detail.name })
      setShowLoadErrorDialog(true)
    }
    window.addEventListener('tab-load-error', handleTabLoadError)
    return () => { window.removeEventListener('tab-load-error', handleTabLoadError) }
  }, [])

  useEffect(() => {
    const unlisten = listen('file-watcher-event', (event) => {
      const { type, path } = event.payload as { type: string; path: string }
      
      if (type === 'modified') {
        const editorStore = useEditorStore.getState()
        const tab = editorStore.tabs.find(t => t.path === path)
        if (tab) {
          if (tab.isDirty) {
            editorStore.markExternalChange(tab.id)
          } else {
            editorStore.loadTabContent(tab.id)
          }
        }
      } else if (type === 'created' || type === 'removed' || type === 'renamed') {
        // Close tabs for removed files
        if (type === 'removed') {
          const editorStore = useEditorStore.getState()
          // Check if the removed path matches any open tab (file) or is a parent of any tab (directory)
          const tabsToClose = editorStore.tabs.filter(tab =>
            tab.path === path || tab.path.startsWith(path + '/')
          )
          for (const tab of tabsToClose) {
            editorStore.removeTab(tab.id)
          }
        }
        
        const { workspaceMode } = useUIStore.getState()
        const { rootPath, workspaceFolders } = useWorkspaceStore.getState()
        const parentPath = path.substring(0, path.lastIndexOf('/'))
        
        if (workspaceMode === 'workspace') {
          for (const folder of workspaceFolders) {
            if (parentPath === folder || parentPath.startsWith(folder + '/')) {
              const fileTreeStore = useFileTreeStore.getState()
              fileTreeStore.refreshNode(parentPath)
              break
            }
          }
        } else if (rootPath && (parentPath === rootPath || parentPath.startsWith(rootPath + '/'))) {
          const fileTreeStore = useFileTreeStore.getState()
          fileTreeStore.refreshNode(parentPath)
        }
      }
    })
    
    return () => { unlisten.then(fn => fn()) }
  }, [])

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    
    const handleTabsChange = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveSessionStateNow().catch(console.error)
        saveTimer = null
      }, 500)
    }
    
    const unsubscribe = useEditorStore.subscribe(handleTabsChange)
    
    return () => {
      unsubscribe()
      if (saveTimer) clearTimeout(saveTimer)
    }
  }, [])

  const handleSaveAndClose = async () => {
    setShowSaveDialog(false)
    await useEditorStore.getState().saveAllDirtyTabs()
    if (pendingCloseRef.current) {
      const win = getCurrentWindow()
      await saveSessionStateNow()
      const { closeWithoutExit } = useUIStore.getState()
      if (closeWithoutExit) {
        await win.hide()
        const { setDockIconVisibility } = await import('@/lib/tauri')
        setDockIconVisibility(false).catch(() => {})
      } else {
        await win.destroy()
      }
    }
  }

  const handleDiscardAndClose = async () => {
    setShowSaveDialog(false)
    useEditorStore.getState().resetDirtyTabs()
    if (pendingCloseRef.current) {
      const win = getCurrentWindow()
      await saveSessionStateNow()
      const { closeWithoutExit } = useUIStore.getState()
      if (closeWithoutExit) {
        await win.hide()
        const { setDockIconVisibility } = await import('@/lib/tauri')
        setDockIconVisibility(false).catch(() => {})
      } else {
        await win.destroy()
      }
    }
  }

  const handleCancelClose = () => {
    setShowSaveDialog(false)
    pendingCloseRef.current = false
  }

  useEffect(() => {
    const initRoundedCorners = async () => {
      try {
        const platform = await import('@tauri-apps/plugin-os').then(m => m.platform())
        if (platform === 'linux') {
          document.documentElement.style.borderRadius = '12px'
          document.body.style.borderRadius = '12px'
        } else if (platform === 'macos') {
          await enableModernWindowStyle({ cornerRadius: 12 })
        } else if (platform === 'windows') {
          await enableModernWindowStyle({ cornerRadius: 12 })
          // Windows 11 provides rounded corners via DWM, but the web content
          // also needs matching border-radius to prevent black corner artifacts
          document.documentElement.style.borderRadius = '8px'
          document.body.style.borderRadius = '8px'
        }
      } catch {
        // ignore errors
      }
    }
    initRoundedCorners()
  }, [])

  const handleMouseDownLeft = useCallback(() => {
    setIsDraggingLeft(true)
  }, [])

  const handleMouseMoveLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft) return
    const newWidth = e.clientX - 48
    const maxWidth = window.innerWidth * 0.5
    if (newWidth >= 200 && newWidth <= maxWidth) {
      setSidebarWidth(newWidth)
    }
  }, [isDraggingLeft])

  const handleMouseDownRight = useCallback(() => {
    setIsDraggingRight(true)
  }, [])

  const handleMouseMoveRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight) return
    const newWidth = window.innerWidth - e.clientX
    const maxWidth = window.innerWidth * 0.5
    if (newWidth >= 250 && newWidth <= maxWidth) {
      setRightPanelWidth(newWidth)
    }
  }, [isDraggingRight])

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }, [])

  useEffect(() => {
    if (isDraggingLeft) {
      document.addEventListener('mousemove', handleMouseMoveLeft)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveLeft)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
    if (isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMoveRight)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveRight)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMoveLeft, handleMouseMoveRight, handleMouseUp])

  const restoreSessionState = async () => {
    try {
      const states = await getSessionState()
      console.log('Restoring session state:', states)
      if (Object.keys(states).length === 0) {
        console.log('No session state found')
        return
      }

      const { workspaceMode } = useUIStore.getState()
      const { rootPath, workspaceFolders } = useWorkspaceStore.getState()
      console.log('Workspace mode:', workspaceMode, 'rootPath:', rootPath, 'workspaceFolders:', workspaceFolders)

      if (states.tabs) {
        const tabsData = JSON.parse(states.tabs)
        console.log('Found tabs in session:', tabsData.length)
        const validTabs = tabsData.filter((tab: { path: string }) => {
          if (workspaceMode === 'workspace') {
            return workspaceFolders.some((f: string) => tab.path.startsWith(f))
          }
          return rootPath && tab.path.startsWith(rootPath)
        })
        if (validTabs.length > 0) {
          const restoredTabs = validTabs.map((tab: any) => ({
            ...tab,
            content: '',
            isDirty: false,
            isEdited: false,
            fileSize: tab.fileSize,
            modifiedTime: tab.modifiedTime,
            wordCount: tab.wordCount,
          }))
          const activeTabId = states.activeTabId || null
          useEditorStore.getState().restoreTabs(restoredTabs, activeTabId)
          if (activeTabId) {
            useEditorStore.getState().loadTabContent(activeTabId)
          }
        }
      }

      if (states.expanded) {
        const expandedPaths = JSON.parse(states.expanded)
        const selectedPath = states.selectedPath || null
        useFileTreeStore.getState().restoreTreeState(expandedPaths, selectedPath)
      }

      // After restoring tree state, reveal the active tab's path in the file tree
      // This ensures the file tree scrolls to and loads nodes for the current tab
      if (states.activeTabId) {
        const editorState = useEditorStore.getState()
        const activeTab = editorState.tabs.find((t: any) => t.id === states.activeTabId)
        if (activeTab?.path) {
          const fileTreeStore = useFileTreeStore.getState()
          if (workspaceMode === 'workspace' && workspaceFolders.length > 0) {
            const folder = workspaceFolders.find((f: string) => activeTab.path.startsWith(f))
            if (folder) {
              // Delay to ensure file tree nodes are rendered after restoreTreeState
              setTimeout(() => fileTreeStore.revealPath(activeTab.path, folder), 100)
            }
          } else if (rootPath) {
            setTimeout(() => fileTreeStore.revealPath(activeTab.path, rootPath), 100)
          }
        }
      }

      if (states.sidebarWidth) {
        setSidebarWidth(Number(states.sidebarWidth))
      }
      if (states.rightPanelWidth) {
        setRightPanelWidth(Number(states.rightPanelWidth))
      }
      if (states.editorViewMode) {
        useUIStore.getState().setEditorViewMode(states.editorViewMode as any)
      }

      // Restore window size and position
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
            if (!isNaN(x) && !isNaN(y)) {
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
  }

  const saveSessionStateNow = async () => {
    try {
      const editorState = useEditorStore.getState()
      const fileTreeState = useFileTreeStore.getState()
      const uiState = useUIStore.getState()
      const editorSettingsState = useEditorSettingsStore.getState()

      const fileTabs = editorState.tabs.filter(tab => tab.type !== 'diff')
      const tabsData = fileTabs.map(tab => ({
        id: tab.id,
        path: tab.path,
        name: tab.name,
        viewMode: tab.viewMode,
        cursorPosition: tab.cursorPosition,
      }))

      const activeTabId = fileTabs.find(t => t.id === editorState.activeTabId)?.id || (fileTabs.length > 0 ? fileTabs[0].id : '')

      // Save window size and position
      let windowWidth = ''
      let windowHeight = ''
      let windowX = ''
      let windowY = ''
      let isMaximized = ''
      let isFullscreen = ''
      try {
        const win = getCurrentWindow()
        isMaximized = String(await win.isMaximized())
        isFullscreen = String(await win.isFullscreen())
        if (isMaximized !== 'true' && isFullscreen !== 'true') {
          const size = await win.innerSize()
          // Convert from physical to logical pixels
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
        editor_normalPaddingVertical: String(editorSettingsState.normalPaddingVertical),
        editor_normalPaddingHorizontal: String(editorSettingsState.normalPaddingHorizontal),
        editor_widePaddingVertical: String(editorSettingsState.widePaddingVertical),
        editor_widePaddingHorizontal: String(editorSettingsState.widePaddingHorizontal),
      }

      await saveSessionState(updates)
    } catch (e) {
      console.error('Failed to save session state:', e)
    }
  }

  const renderRightPanel = () => {
    switch (rightPanelType) {
      case 'ai': return <AIView />
      case 'directory': return <DirectoryView />
      case 'history': return <HistoryView visible={true} />
      case 'editorSettings': return <EditorSettings />
      default: return null
    }
  }

  return (
    <TooltipProvider>
      <div
        className="h-screen w-screen flex flex-col overflow-hidden p-1"
        style={{ background: 'var(--bg-primary-gradient, var(--bg-primary))', color: 'var(--text-primary)', fontSize: 'var(--font-size)' }}
      >
        {/* Title Bar */}
        <TitleBar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden gap-x-0.5 pr-0.5">
          {/* Activity Bar */}
          <ActivityBar />

          {/* Sidebar - hidden when settings panel is open */}
          {!settingsPanelVisible && (
            <div 
              className="flex-shrink-0 flex flex-col overflow-hidden rounded-[var(--radius)]" 
              style={{ width: sidebarWidth, background: 'var(--bg-secondary-gradient, var(--bg-secondary))' }}
            >
              <Sidebar />
            </div>
          )}

          {/* Left Resize Handle */}
          {!settingsPanelVisible && (
            <div
              className="flex-shrink-0 w-[1px] h-full flex items-center justify-center cursor-col-resize"
              onMouseDown={handleMouseDownLeft}
              onMouseEnter={() => setIsHoveringLeft(true)}
              onMouseLeave={() => setIsHoveringLeft(false)}
            >
              <div 
                className="w-[1px] h-[100%] rounded-full transition-opacity duration-200"
                style={{ 
                  backgroundColor: 'var(--theme-color)',
                  opacity: isHoveringLeft || isDraggingLeft ? 1 : 0
                }}
              />
            </div>
          )}

          {/* Editor Area */}
          <div className="flex-1 flex flex-col overflow-hidden rounded-[var(--radius)]" style={{ background: 'var(--bg-secondary-gradient, var(--bg-secondary))'}}>
            {settingsPanelVisible ? (
              <SettingsView />
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <TabBar />
                <EditorToolbar />
                <EditorView />
              </div>
            )}
          </div>

          {/* Right Resize Handle */}
          {rightPanelType && (
            <div
              className="flex-shrink-0 w-[1px] h-full flex items-center justify-center cursor-col-resize"
              onMouseDown={handleMouseDownRight}
              onMouseEnter={() => setIsHoveringRight(true)}
              onMouseLeave={() => setIsHoveringRight(false)}
            >
              <div 
                className="w-[1px] h-[100%] rounded-full transition-opacity duration-200"
                style={{ 
                  backgroundColor: 'var(--theme-color)',
                  opacity: isHoveringRight || isDraggingRight ? 1 : 0
                }}
              />
            </div>
          )}

          {/* Right Panel - moved outside editor, same level as sidebar */}
          {rightPanelType && (
            <div className="shrink-0 flex flex-col overflow-hidden rounded-[var(--radius)] " style={{ width: rightPanelWidth, background: 'var(--bg-secondary-gradient, var(--bg-secondary))', borderColor: 'var(--border-color)' }}>
              {renderRightPanel()}
            </div>
          )}
        </div>

        {/* statusbar */}
        <StatusBar />

        {/* Toast Notification */}
        <Toaster 
          position="bottom-center"
          duration={3000}
          toastOptions={{
            style: {
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
            },
          }}
        />

        {/* Save Confirmation Dialog */}
        <AlertDialog open={showSaveDialog} onOpenChange={(open: boolean) => { if (!open) handleCancelClose() }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('dialog.saveChanges')}</AlertDialogTitle>
              <AlertDialogDescription className="text-left">
                <div className="mb-2">{t('dialog.unsavedFiles', { count: dirtyFileNames.length })}</div>
                <div className="max-h-32 overflow-y-auto">
                  {dirtyFileNames.map((name, i) => (
                    <p key={i} className="truncate text-xs font-mono" title={name}>
                      {name.length > 20 ? name.slice(0, 20) + '...' : name}
                    </p>
                  ))}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleDiscardAndClose}>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleSaveAndClose}>{t('common.save')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Tab Load Error Dialog */}
        <AlertDialog open={showLoadErrorDialog} onOpenChange={(open: boolean) => {
          if (!open) {
            if (failedTabInfo) {
              useEditorStore.getState().removeTab(failedTabInfo.id)
            }
            setShowLoadErrorDialog(false)
            setFailedTabInfo(null)
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('dialog.fileLoadFailed')}</AlertDialogTitle>
              <AlertDialogDescription className="text-left">
                <p className="mb-2">{t('dialog.fileLoadFailedDesc')}</p>
                <p className="font-mono text-xs truncate" title={failedTabInfo?.path}>
                  {failedTabInfo?.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1 truncate" title={failedTabInfo?.path}>
                  {failedTabInfo?.path}
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>{t('common.close')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

export { App }
