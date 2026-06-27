import '@/i18n'
import { lazy, Suspense } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { NotePropertiesPanel } from '@/components/NoteProperties/NotePropertiesPanel'
import { SettingsView } from '@/components/Settings/SettingsView'
const AIView = lazy(() => import('@/components/AI/AIView').then(m => ({ default: m.AIView })))
import { flushAllEditors } from '@/lib/editor-flush'
const DirectoryView = lazy(() => import('@/components/Directory/DirectoryView').then(m => ({ default: m.DirectoryView })))
const HistoryView = lazy(() => import('@/components/History/HistoryView').then(m => ({ default: m.HistoryView })))
const EditorSettings = lazy(() => import('@/components/EditorSettings/EditorSettings').then(m => ({ default: m.EditorSettings })))
const PluginManagerView = lazy(() => import('@/components/Plugin/PluginManagerView').then(m => ({ default: m.PluginManagerView })))

// Simple loading placeholder for PluginManager
function PluginManagerLoading() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  )
}

// Preload function for PluginManagerView - can be called on hover
let pluginManagerPreloaded = false
export function preloadPluginManager() {
  if (!pluginManagerPreloaded) {
    pluginManagerPreloaded = true
    // Preload the main component and its sub-components
    void import('@/components/Plugin/PluginManagerView')
  }
}
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
  const activeTabId = useEditorStore((s: EditorState) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
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
  // rAF 节流：拖拽面板宽度时每帧最多更新一次
  const rafRef = useRef<number | null>(null)
  // 防止 StrictMode 双调用导致 init() 重复执行
  // 开发模式下 StrictMode 会调用 effect 两次，导致 restoreSessionState、
  // scanPlugins 等副作用并发执行，引发 MarkdownEditor 重复 mount
  const initRef = useRef(false)

  // ── Session 持久化 (提取自 App.tsx 的独立 hook) ──
  const { saveSessionStateNow, restoreSessionState } = useSessionPersistence()

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
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

      // Step 3: 设置加载完成后立即显示窗口，避免用户等待文件树加载
      try {
        await getCurrentWindow().show()
      } catch { /* ignore */ }

      // 显示窗口后立即应用 macOS 圆角窗口样式
      // （从独立 useEffect 迁移至此，避免与 init 的 IPC 调用竞争后端主线程）
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

      // Step 4: 窗口可见后加载文件树与恢复会话
      // loadLatestByMode 需先完成以建立文件树，再恢复会话状态
      await loadLatestByMode()
      await restoreSessionState()
      
      // Step 5: 延迟加载插件和后台服务，确保编辑器先就绪可交互

      // Sync current i18n language to the Rust backend (fire-and-forget)
      import('i18next').then(({ default: i18n }) => {
        setAppLocale(i18n.language).catch(() => {})
      }).catch(() => {})

      // 窗口可见后发射 app:ready（fire-and-forget，不阻塞）
      import('@/lib/plugin-host').then(({ emitAppReady }) => {
        emitAppReady()
      }).catch(() => { /* ignore */ })

      // 延迟 1500ms 后启动插件加载和后台服务
      // 确保编辑器完全挂载、用户可操作之后才执行非关键任务
      setTimeout(() => {
        // 1. 启动后台服务（文件监听、frontmatter 扫描、历史保存）
        useWorkspaceStore.getState().startBackgroundServices()

        // 2. 加载插件（动态导入、注册、初始化）
        ;(async () => {
          try {
            const { scanPlugins } = await import('@/lib/tauri')
            const { loadAllPlugins } = await import('@/lib/plugin-loader')
            const result = await scanPlugins().then(loadAllPlugins)
            const { plugins: defs, failures } = result
            usePluginStore.getState().setPlugins(defs)
            usePluginStore.getState().setLoadFailures(failures)
            usePluginStore.getState().setLoaded(true)

            // 以下操作互相独立，各自 try-catch 避免级联失败
            try {
              const { seedPluginStorageSizes } = await import('@/lib/plugin-telemetry')
              const { getAllPluginStorageSizes } = await import('@/lib/tauri')
              void getAllPluginStorageSizes()
                .then((sizes) => seedPluginStorageSizes(sizes))
                .catch((err) => {
                  console.warn('[App] failed to seed plugin storage sizes:', err)
                })
            } catch (err) {
              console.warn('[App] failed to init plugin storage sizes:', err)
            }

            try {
              const { subscribeToPluginStorageChanges } = await import('@/lib/plugin-telemetry')
              void subscribeToPluginStorageChanges().catch((err) => {
                console.warn('[App] failed to subscribe to plugin storage changes:', err)
              })
            } catch (err) {
              console.warn('[App] failed to subscribe plugin storage changes:', err)
            }

            try {
              const { hydratePermissionGuard } = await import('@/lib/plugin-permissions')
              void hydratePermissionGuard(defs.map((d) => d.id))
            } catch (err) {
              console.warn('[App] failed to hydrate permission guard:', err)
            }

            try {
              const { hydrateAutoUpdateFromLocalStorage, runAutoUpdateOnStartup } =
                await import('@/lib/plugin-auto-update')
              hydrateAutoUpdateFromLocalStorage()
              void runAutoUpdateOnStartup()
            } catch (err) {
              console.warn('[App] failed to init plugin auto update:', err)
            }
          } catch (err) {
            console.error('[App] Failed to load plugins on startup:', err)
            usePluginStore.getState().setLoaded(true)
          }
        })()
      }, 1500)

      // 空闲时段预加载 PluginManagerView chunk
      try {
        if ('requestIdleCallback' in window) {
          ;(window as unknown as { requestIdleCallback: (cb: () => void) => void })
            .requestIdleCallback(() => { void preloadPluginManager() })
        } else {
          setTimeout(() => { void preloadPluginManager() }, 3000)
        }
      } catch { /* ignore */ }
    }
    init()
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    const unlisten = win.listen('tauri://close-requested', async () => {
      // 通知插件 app 退出（不 await）
      try {
        const { emitAppExit } = await import('@/lib/plugin-host')
        emitAppExit()
      } catch { /* ignore */ }

      const { closeWithoutExit } = useUIStore.getState()
      const dirtyCount = useEditorStore.getState().getDirtyTabsCount()
      if (dirtyCount > 0) {
        const dirtyTabs = useEditorStore.getState().tabs.filter((t) => t.isDirty || t.frontmatterDirty)
        const names = dirtyTabs.slice(0, 5).map((t) => t.name)
        if (dirtyTabs.length > 5) names.push('...')
        setDirtyFileNames(names)
        setShowSaveDialog(true)
        pendingCloseRef.current = true
      } else if (closeWithoutExit) {
        await saveSessionStateNow()
        await win.hide()
        const { setDockIconVisibility } = await import('@/lib/tauri')
        // Cosmetic side effect — a failure here doesn't block close,
        // but log it so the silent loss isn't completely invisible.
        setDockIconVisibility(false).catch((err) => console.warn('[App] setDockIconVisibility failed', err))
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
            // Force reload: loadTabContent skips when content !== undefined,
            // but external modifications need to overwrite the cached content.
            editorStore.loadTabContent(tab.id, 0, true)
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
        const pushErrorPaths: string[] = []
        const pushConflictPaths: string[] = []
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
                // Track conflict repos from push phase
                if (errorMessage.startsWith('REBASE_CONFLICT:') || errorMessage.includes('rebase/merge is in progress')) {
                  pushConflictPaths.push(repo.path)
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
                  pushErrorPaths.push(repo.path)
                  console.error('Auto sync push failed:', repo.path, errorMessage)
                }
              }
            }
          }
        }

        // Update repository statuses based on pull + push results
        const allResults: PullResult[] = [
          ...results,
          ...pushConflictPaths.map(p => ({ path: p, name: repos.find(r => r.path === p)?.name || '', success: false, isConflict: true })),
          ...pushErrorPaths.map(p => ({ path: p, name: repos.find(r => r.path === p)?.name || '', success: false, isConflict: false })),
        ]
        gitStore.updateRepositoryStatuses(allResults)

        // Refresh repository list to update hasUncommittedChanges etc.
        try {
          const { scanGitRepos } = await import('@/lib/tauri')
          const { mapRepoInfosToRepositories } = await import('@/stores/git')
          const uiState = useUIStore.getState()
          const wsState = useWorkspaceStore.getState()
          const scanPaths = uiState.workspaceMode === 'workspace'
            ? (wsState.workspaceFolders || [])
            : (wsState.rootPath ? [wsState.rootPath] : [])
          const scanPromises = scanPaths.map(async (path) => {
            try { return await scanGitRepos(path) } catch { return [] }
          })
          const scanResults = await Promise.all(scanPromises)
          const freshRepos = mapRepoInfosToRepositories(scanResults.flat())
          // Preserve non-normal statuses from the sync results
          const statusMap = new Map<string, 'conflict' | 'error'>()
          for (const r of allResults) {
            if (r.isConflict) statusMap.set(r.path, 'conflict')
            else if (!r.success) statusMap.set(r.path, 'error')
          }
          const mergedRepos = freshRepos.map((repo: GitRepository) => {
            const status = statusMap.get(repo.path)
            if (status) return { ...repo, status }
            return repo
          })
          gitStore.setRepositories(mergedRepos)
          gitStore.setCachedRepositories(mergedRepos)
        } catch {
          // Ignore scan errors after sync
        }

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
          await gitStore.syncConflictReposFromPullResults(allResults)
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
    await flushAllEditors()
    await useEditorStore.getState().saveAllDirtyTabs()
    const win = getCurrentWindow()
    await saveSessionStateNow()
    const { closeWithoutExit } = useUIStore.getState()
    if (closeWithoutExit) {
      await win.hide()
      const { setDockIconVisibility } = await import('@/lib/tauri')
      // Cosmetic side effect — a failure here doesn't block close,
      // but log it so the silent loss isn't completely invisible.
      setDockIconVisibility(false).catch((err) => console.warn('[App] setDockIconVisibility failed', err))
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
      // Cosmetic side effect — a failure here doesn't block close,
      // but log it so the silent loss isn't completely invisible.
      setDockIconVisibility(false).catch((err) => console.warn('[App] setDockIconVisibility failed', err))
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

  const handleMouseDownLeft = useCallback(() => {
    setIsDraggingLeft(true)
  }, [])

  const handleMouseMoveLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft) return
    if (rafRef.current) return
    const clientX = e.clientX
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const newWidth = clientX - 48
      const maxWidth = window.innerWidth * 0.5
      if (newWidth >= 200 && newWidth <= maxWidth) {
        setSidebarWidth(newWidth)
      }
    })
  }, [isDraggingLeft])

  const handleMouseDownRight = useCallback(() => {
    setIsDraggingRight(true)
  }, [])

  const handleMouseMoveRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight) return
    if (rafRef.current) return
    const clientX = e.clientX
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const newWidth = window.innerWidth - clientX
      const maxWidth = window.innerWidth * 0.5
      if (newWidth >= 250 && newWidth <= maxWidth) {
        setRightPanelWidth(newWidth)
      }
    })
  }, [isDraggingRight])

  const handleMouseUp = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
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
          },
          activeTab?.content ?? '',
          activeTab?.path ?? ''
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
      case 'noteProperties': {
        if (!activeTab) return null
        const fm = activeTab.frontmatter
        return <NotePropertiesPanel tabId={activeTab.id} frontmatter={fm || {}} />
      }
      default: return null
    }
  }

  // Disable the system default context menu across the entire app
  // Custom context menus (Radix UI ContextMenu) handle their own right-click logic internally
  const handleContextMenu = useCallback((_e: React.MouseEvent) => {
    //_e.preventDefault()
  }, [])

  return (
    <TooltipProvider>
      <div
        className="h-screen w-screen flex flex-col p-px rounded-[12px]"
        style={{ background: 'var(--theme-color)', color: 'var(--text-primary)', fontSize: 'var(--font-size)' }}
        onContextMenu={handleContextMenu}
      >
        <div className="flex-1 flex flex-col overflow-hidden rounded-[11px]" style={{ background: 'var(--bg-primary-gradient, var(--bg-primary))'}}>
        {/* Title Bar */}
        <TitleBar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden gap-x-0.5 px-1 pr-1.5">
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
              <Suspense fallback={<PluginManagerLoading />}><PluginManagerView /></Suspense>
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
                  },
                  activeTab?.content ?? '',
                  activeTab?.path ?? ''
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
