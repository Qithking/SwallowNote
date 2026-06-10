import '@/i18n'
import { lazy, Suspense } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { SettingsView } from '@/components/Settings/SettingsView'
const AIView = lazy(() => import('@/components/AI/AIView').then(m => ({ default: m.AIView })))
const DirectoryView = lazy(() => import('@/components/Directory/DirectoryView').then(m => ({ default: m.DirectoryView })))
const HistoryView = lazy(() => import('@/components/History/HistoryView').then(m => ({ default: m.HistoryView })))
const EditorSettings = lazy(() => import('@/components/EditorSettings/EditorSettings').then(m => ({ default: m.EditorSettings })))
const PluginManagerView = lazy(() => import('@/components/Plugin/PluginManagerView').then(m => ({ default: m.PluginManagerView })))
import { PluginPanelHost } from '@/components/Plugin/PluginPanelHost'
import { StatusBar } from '@/components/StatusBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useUIStore, useWorkspaceStore, useEditorStore, useFileTreeStore, useGitStore, usePluginStore } from '@/stores'
import type { UIState, EditorState, GitState, PullResult } from '@/stores'
import type { GitRepository } from '@/stores/git'
import { useTheme, useKeyboardShortcuts } from '@/hooks'
import { useSessionPersistence } from '@/hooks/useSessionPersistence'
import { TooltipProvider } from '@/components'
import { Toaster } from 'sonner'
import { useState, useCallback, useEffect, useRef } from 'react'
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'
import { setAppLocale } from '@/lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useEditorSettingsStore } from '@/stores'
import { isPluginSidebarView, isPluginRightPanelType, extractPluginId, pluginRightPanelType, createPluginPanelProps } from '@/lib/plugin-utils'

function App() {
  useTheme()
  useKeyboardShortcuts()
  const { t } = useTranslation()
  const settingsPanelVisible = useUIStore((s: UIState) => s.settingsPanelVisible)
  const rightPanelType = useUIStore((s: UIState) => s.rightPanelType)
  const sidebarWidth = useUIStore((s: UIState) => s.sidebarWidth)
  const rightPanelWidth = useUIStore((s: UIState) => s.rightPanelWidth)
  const sidebarVisible = useUIStore((s: UIState) => s.sidebarVisible)
  const setSidebarWidth = useUIStore((s: UIState) => s.setSidebarWidth)
  const setRightPanelWidth = useUIStore((s: UIState) => s.setRightPanelWidth)
  const syncInterval = useUIStore((s: UIState) => s.syncInterval)
  const autoSyncPush = useUIStore((s: UIState) => s.autoSyncPush)
  const sidebarView = useUIStore((s: UIState) => s.sidebarView)
  const tabs = useEditorStore((s: EditorState) => s.tabs)
  const cachedRepositories = useGitStore((s: GitState) => s.cachedRepositories)
  const pullAllRepos = useGitStore((s: GitState) => s.pullAllRepos)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isHoveringLeft, setIsHoveringLeft] = useState(false)
  const [isHoveringRight, setIsHoveringRight] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [dirtyFileNames, setDirtyFileNames] = useState<string[]>([])
  const [showLoadErrorDialog, setShowLoadErrorDialog] = useState(false)
  const [failedTabInfo, setFailedTabInfo] = useState<{ id: string; path: string; name: string } | null>(null)
  const pendingCloseRef = useRef(false)
  // 防止 Radix AlertDialog 的 onOpenChange 在 Save/Discard 点击后干扰关闭流程
  const actionTakenRef = useRef(false)

  // ── Session 持久化 (提取自 App.tsx 的独立 hook) ──
  const { saveSessionStateNow, restoreSessionState } = useSessionPersistence()

  useEffect(() => {
    const init = async () => {
      const { initMode, loadLatestByMode } = useWorkspaceStore.getState()
      const { loadSettings: loadEditorSettings } = useEditorSettingsStore.getState()
      const { loadSettings: loadUISettings } = useUIStore.getState()
      
      // Step 1: Initialize workspace mode first (determines folder vs workspace)
      await initMode()
      
      // Step 2: Load settings in parallel (these are independent)
      await Promise.all([
        loadEditorSettings(),
        loadUISettings(),
      ])
      
      // Step 3: Load workspace/folder first to establish file tree
      // This must complete before session restore to avoid race conditions
      await loadLatestByMode()
      
      // Step 4: Restore session state (tabs, expanded folders, etc.)
      // This depends on file tree being loaded first
      await restoreSessionState()
      
      // Step 5: Load plugins from <app_data>/plugins and register them in the
      // plugin store. Done in parallel with locale sync because both are
      // independent of the main app's rendering path. Plugin icons and
      // panels appear in ActivityBar / TitleBar / EditorToolbar / Sidebar
      // once `loaded` flips and the registry is rebuilt.
      const { scanPlugins } = await import('@/lib/tauri')
      const { loadAllPlugins } = await import('@/lib/plugin-loader')
      const { usePluginStore } = await import('@/stores/plugin')
      scanPlugins()
        .then(loadAllPlugins)
        .then((defs) => {
          usePluginStore.getState().setPlugins(defs)
          usePluginStore.getState().setLoaded(true)
        })
        .catch((err) => {
          console.error('[App] Failed to load plugins on startup:', err)
          usePluginStore.getState().setLoaded(true)
        })

      // Sync current i18n language to the Rust backend
      const { default: i18n } = await import('i18next')
      setAppLocale(i18n.language).catch(() => {})

      // Window was created hidden (visible:false) to prevent white→black flash.
      // Now that theme and settings are loaded, show the window.
      try {
        await getCurrentWindow().show()
      } catch { /* ignore */ }

      // Plugins that want to do post-startup work (e.g. register a
      // command palette entry) can listen for this event. We emit
      // *after* the window is visible so a plugin that does DOM work
      // in its handler sees a mounted document.
      try {
        const { emitAppReady } = await import('@/lib/plugin-host')
        emitAppReady()
      } catch { /* ignore */ }
    }
    init()
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    const unlisten = win.listen('tauri://close-requested', async () => {
      // Notify plugins that the app is about to exit. Plugins can
      // flush their storage synchronously here, but the user has
      // already chosen to quit, so we don't await async work – the
      // store `writePromise` will complete in the background as
      // long as the process stays alive long enough.
      try {
        const { emitAppExit } = await import('@/lib/plugin-host')
        emitAppExit()
      } catch { /* ignore */ }

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

      // Skip file events during Git sync to avoid interference with git pull/push operations
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
            editorStore.loadTabContent(tab.id)
          }
        }
      } else if (type === 'created' || type === 'removed' || type === 'renamed') {
        // Close tabs for removed files
        if (type === 'removed') {
          const editorStore = useEditorStore.getState()
          // Skip if this path is currently being saved
          // (atomic write: write to .tmp then rename can trigger a remove event on the original file)
          if (editorStore.isPathSaving(path)) return
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
    
    // Listen for save-session-now events (e.g., before install & restart)
    const handleSaveSessionNow = () => {
      saveSessionStateNow().catch(console.error)
    }
    window.addEventListener('save-session-now', handleSaveSessionNow)
    
    return () => {
      unsubscribe()
      window.removeEventListener('save-session-now', handleSaveSessionNow)
      if (saveTimer) clearTimeout(saveTimer)
    }
  }, [])

  // Auto sync: periodically pull all git repositories based on syncInterval setting
  const syncIntervalRef = useRef(syncInterval)
  syncIntervalRef.current = syncInterval
  const autoSyncPushRef = useRef(autoSyncPush)
  autoSyncPushRef.current = autoSyncPush
  const cachedReposRef = useRef(cachedRepositories)
  cachedReposRef.current = cachedRepositories
  const pullAllReposRef = useRef(pullAllRepos)
  pullAllReposRef.current = pullAllRepos

  useEffect(() => {
    const doSync = async () => {
      const repos = cachedReposRef.current
      if (repos.length === 0) return
      const gitStore = useGitStore.getState()
      gitStore.setSyncStatus({ isSyncing: true })
      try {
        // Step 1: Always pull first
        const results = await pullAllReposRef.current(repos)
        const succeeded = results.filter((r: PullResult) => r.success).length
        const failed = results.filter((r: PullResult) => !r.success && !r.isConflict).length
        const conflicted = results.filter((r: PullResult) => r.isConflict).length

        // Step 2: If autoSyncPush is enabled, commit and push repos with uncommitted changes
        // Skip repos that are in conflict state (detected in pull step)
        let pushSucceeded = 0
        let pushFailed = 0
        if (autoSyncPushRef.current) {
          const conflictedPaths = new Set(results.filter((r: PullResult) => r.isConflict).map((r: PullResult) => r.path))
          const reposWithChanges = repos.filter((r: GitRepository) => r.hasUncommittedChanges && r.remoteUrl && !conflictedPaths.has(r.path))
          if (reposWithChanges.length > 0) {
            const { gitCommitAndPush, gitCredentialGet, gitPushWithCredentials } = await import('@/lib/tauri')
            for (const repo of reposWithChanges) {
              try {
                await gitCommitAndPush(repo.path, 'Auto sync')
                pushSucceeded++
              } catch (e) {
                const errorMessage = String(e).trim()
                // Skip repos that have conflict errors - they need manual resolution
                if (errorMessage.startsWith('REBASE_CONFLICT:') || errorMessage.includes('rebase/merge is in progress')) {
                  continue
                }
                // Try saved credentials on auth error
                if (errorMessage.startsWith('AUTH_REQUIRED:')) {
                  try {
                    const savedCred = await gitCredentialGet(repo.path)
                    if (savedCred) {
                      try {
                        await gitPushWithCredentials(repo.path, savedCred.username, savedCred.password)
                        pushSucceeded++
                        continue
                      } catch {
                        // Saved credentials failed
                      }
                    }
                  } catch {
                    // Failed to get credentials
                  }
                }
                // Ignore "nothing to commit" errors (already committed by auto_commit)
                if (!errorMessage.includes('nothing to commit') &&
                    !errorMessage.includes('working tree clean') &&
                    !errorMessage.includes('no changes added to commit') &&
                    !errorMessage.startsWith('AUTH_REQUIRED:')) {
                  pushFailed++
                  console.error('Auto sync push failed:', repo.path, errorMessage)
                }
              }
            }
          }
        }

        // Update repository statuses based on pull results
        gitStore.updateRepositoryStatuses(results)

        gitStore.setSyncStatus({
          isSyncing: false,
          lastSyncTime: Date.now(),
          succeeded: succeeded + pushSucceeded,
          failed: failed + pushFailed,
          conflicted,
        })
        if (succeeded > 0 || conflicted > 0 || pushSucceeded > 0) {
          // Refresh file tree to reflect any pulled/pushed changes
          const fileTreeStore = useFileTreeStore.getState()
          fileTreeStore.refreshExpanded()
        }
        // Only show one consolidated toast for conflicts
        if (conflicted > 0) {
          const repoNames = results.filter((r: PullResult) => r.isConflict).map((r: PullResult) => r.name).join(', ')
          toast.warning(t('git.pullConflict', { repos: repoNames }))
          
          // Do NOT auto-open conflict tabs — user must click conflict icon or repo to open
          // Sync conflict repos to database for persistence
          await gitStore.syncConflictReposFromPullResults(results)
        }
      } catch (e) {
        console.error('Auto sync failed:', e)
        gitStore.setSyncStatus({ isSyncing: false })
      }
    }

    // Initial sync after a short delay
    const initialTimer = setTimeout(() => {
      doSync()
    }, 5000)

    // Set up periodic sync
    const intervalMs = syncInterval * 60 * 1000
    const intervalId = setInterval(() => {
      doSync()
    }, intervalMs)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [syncInterval, t])

  const handleSaveAndClose = async () => {
    // 标记已采取行动，阻止 onOpenChange 调用 handleCancelClose
    actionTakenRef.current = true
    const shouldClose = pendingCloseRef.current
    setShowSaveDialog(false)
    pendingCloseRef.current = false
    if (!shouldClose) { actionTakenRef.current = false; return }
    await useEditorStore.getState().saveAllDirtyTabs()
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
    actionTakenRef.current = false
  }

  const handleDiscardAndClose = async () => {
    // 标记已采取行动，阻止 onOpenChange 调用 handleCancelClose
    actionTakenRef.current = true
    const shouldClose = pendingCloseRef.current
    setShowSaveDialog(false)
    pendingCloseRef.current = false
    if (!shouldClose) { actionTakenRef.current = false; return }
    useEditorStore.getState().resetDirtyTabs()
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
    actionTakenRef.current = false
  }

  const handleCancelClose = () => {
    // 如果用户已点击保存或放弃，跳过取消逻辑
    if (actionTakenRef.current) return
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

  // Disable text selection while dragging to prevent content being selected
  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
    } else {
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
    }
    return () => {
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
    }
  }, [isDraggingLeft, isDraggingRight])

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

  // Get plugins for rendering
  const allPlugins = usePluginStore((s) => s.plugins)

  // Check if a full-panel/editorArea plugin is currently active
  const activeFullPanelPlugin = settingsPanelVisible && isPluginSidebarView(sidebarView)
    ? allPlugins.find((p) => {
        const pluginViewId = `plugin:${p.id}`
        return sidebarView === pluginViewId && (p.contentPosition === 'fullPanel' || p.contentPosition === 'editorArea')
      })
    : null

  // Check if the plugin manager is active
  const isPluginManagerActive = settingsPanelVisible && sidebarView === 'plugin:__plugin_manager'

  const renderRightPanel = () => {
    // Check for plugin right panel
    if (rightPanelType && isPluginRightPanelType(rightPanelType)) {
      const pluginId = extractPluginId(rightPanelType)
      const plugin = allPlugins.find((p) => p.id === pluginId)
      if (plugin) {
        const panel = plugin.panel
        const isActive = rightPanelType === pluginRightPanelType(plugin.id)
        const panelProps = createPluginPanelProps(
          plugin.id,
          isActive,
          () => {
            // Symmetric close path: hide the right panel and clear the
            // active plugin id, matching the ActivityBar/TitleBar close
            // paths.
            useUIStore.getState().setRightPanelType(null)
            usePluginStore.getState().setActivePlugin(null, 'rightPanel')
          }
        )
        // `key={pluginId}` on PluginPanelHost forces a remount when
        // the user switches from one right-panel plugin to another,
        // so onUnmount / onMount fire for the previous plugin. The
        // host itself dispatches onActivate / onDeactivate based on
        // the isActive prop.
        return <PluginPanelHost key={plugin.id} plugin={plugin} panel={panel} isActive={isActive} panelProps={panelProps} />
      }
      return null
    }
    switch (rightPanelType) {
      case 'ai': return <Suspense fallback={null}><AIView /></Suspense>
      case 'directory': return <Suspense fallback={null}><DirectoryView /></Suspense>
      case 'history': return <Suspense fallback={null}><HistoryView visible={true} /></Suspense>
      case 'editorSettings': return <Suspense fallback={null}><EditorSettings /></Suspense>
      default: return null
    }
  }

  // Disable the system default context menu across the entire app
  // Custom context menus (Radix UI ContextMenu) handle their own right-click logic internally
  const handleContextMenu = useCallback((_e: React.MouseEvent) => {
    _e.preventDefault()
  }, [])

  return (
    <TooltipProvider>
      <div
        className="h-screen w-screen flex flex-col p-[6px]"
        style={{ background: 'transparent', color: 'var(--text-primary)', fontSize: 'var(--font-size)' }}
        onContextMenu={handleContextMenu}
      >
        <div className="flex-1 flex flex-col overflow-hidden rounded-[var(--radius)]" style={{ background: 'var(--bg-primary-gradient, var(--bg-primary))', boxShadow: 'var(--shadow-app)' }}>
        {/* Title Bar */}
        <TitleBar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden gap-x-0.5 pr-0.5">
          {/* Activity Bar */}
          <ActivityBar />

          {/* Sidebar - hidden when settings/fullPanel/pluginManager is open, sidebar is collapsed, or sidebar view is 'settings' (settings shown in main area) */}
          {!settingsPanelVisible && sidebarVisible && sidebarView !== 'settings' && !activeFullPanelPlugin && !isPluginManagerActive && (
            <div 
              className="flex-shrink-0 flex flex-col overflow-hidden rounded-[var(--radius)]" 
              style={{ width: sidebarWidth, background: 'var(--bg-secondary-gradient, var(--bg-secondary))' }}
            >
              <Sidebar />
            </div>
          )}

          {/* Left Resize Handle */}
          {!settingsPanelVisible && sidebarVisible && sidebarView !== 'settings' && !activeFullPanelPlugin && !isPluginManagerActive && (
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

          {/* Editor Area / Full Panel / Plugin Manager */}
          <div className="flex-1 flex flex-col overflow-hidden rounded-[var(--radius)]" style={{ background: 'var(--bg-secondary-gradient, var(--bg-secondary))'}}>
            {settingsPanelVisible && sidebarView === 'settings' ? (
              <SettingsView />
            ) : isPluginManagerActive ? (
              <Suspense fallback={null}><PluginManagerView /></Suspense>
            ) : activeFullPanelPlugin ? (
              <Suspense fallback={null}>{(() => {
                const panel = activeFullPanelPlugin.panel
                const panelProps = createPluginPanelProps(
                  activeFullPanelPlugin.id,
                  true,
                  () => {
                    // Close the full-panel plugin AND reset sidebarView so
                    // the next time the user opens the sidebar, the default
                    // view is shown instead of this plugin's stale view.
                    // Also clear the active plugin id to match the
                    // ActivityBar/TitleBar close paths.
                    useUIStore.getState().setSettingsPanelVisible(false)
                    useUIStore.getState().setSidebarView('explorer')
                    usePluginStore.getState().setActivePlugin(null, 'fullPanel')
                  }
                )
                // `key={id}` ensures a fresh mount (and onMount /
                // onUnmount) when the user switches from one fullPanel
                // plugin to another. onActivate fires on the
                // initial mount because isActive=true.
                return (
                  <PluginPanelHost
                    key={activeFullPanelPlugin.id}
                    plugin={activeFullPanelPlugin}
                    panel={panel}
                    isActive={true}
                    panelProps={panelProps}
                  />
                )
              })()}</Suspense>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {tabs.length > 0 && (
                  <>
                    <TabBar />
                    <EditorToolbar />
                  </>
                )}
                <ErrorBoundary fallback={
                  <div className="flex items-center justify-center flex-1 text-sm text-[var(--text-muted)]">
                    编辑器加载失败，请关闭标签页重试
                  </div>
                }>
                  <EditorView />
                </ErrorBoundary>
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
      </div>
    </TooltipProvider>
  )
}

export { App }
