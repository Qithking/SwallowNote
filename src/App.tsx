import '@/i18n'
import { lazy, Suspense } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { TabBar } from '@/components/TabBar'
import { EditorToolbar } from '@/components/EditorToolbar'
import { EditorView } from '@/components/Editor'
import { RightPanelContent, FullPanelPluginContent } from '@/components/PanelContent'
import { SettingsView } from '@/components/Settings/SettingsView'
import { flushAllEditors } from '@/lib/editor-flush'
import { readActiveEditorScrollTop } from '@/stores/editor'
import { attachLogger, logger } from '@/lib/logger'
import { GitErrorCode } from '@/lib/git/errors'
const PluginManagerView = lazy(() => import('@/components/Plugin/PluginManagerView').then(m => ({ default: m.PluginManagerView })))
const LogViewer = lazy(() => import('@/components/LogViewer').then(m => ({ default: m.LogViewer })))

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
import { StatusBar } from '@/components/StatusBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useUIStore, useWorkspaceStore, useEditorStore, useFileTreeStore, useGitStore, usePluginStore } from '@/stores'
import type { UIState, GitState, PullResult } from '@/stores'
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
import { invoke } from '@tauri-apps/api/core'

function logTime(stage: string, t0: number) {
  const elapsed = Math.round(performance.now() - t0)
  logger.info('app', `[STARTUP-TIME] ${stage} t=${elapsed}`)
  try {
    invoke('log_startup_time', { stage, elapsed_ms: elapsed }).catch((e) => logger.warn('app', 'log_startup_time failed', e))
  } catch { /* ignore */ }
}
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useEditorSettingsStore } from '@/stores'
import { isPluginSidebarView } from '@/lib/plugin-utils'

function App() {
  useTheme()
  useKeyboardShortcuts()
  const { t } = useTranslation()
  // 用 ref 跟踪最新的 t，避免同步定时器 effect 依赖 t 导致语言切换时重建定时器
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const settingsPanelVisible = useUIStore((s: UIState) => s.settingsPanelVisible)
  const logViewerVisible = useUIStore((s: UIState) => s.logViewerVisible)
  const toggleLogViewer = useUIStore((s: UIState) => s.toggleLogViewer)
  const rightPanelType = useUIStore((s: UIState) => s.rightPanelType)
  const sidebarWidth = useUIStore((s: UIState) => s.sidebarWidth)
  const rightPanelWidth = useUIStore((s: UIState) => s.rightPanelWidth)
  const sidebarVisible = useUIStore((s: UIState) => s.sidebarVisible)
  const setSidebarWidth = useUIStore((s: UIState) => s.setSidebarWidth)
  const setRightPanelWidth = useUIStore((s: UIState) => s.setRightPanelWidth)
  const syncInterval = useUIStore((s: UIState) => s.syncInterval)
  const autoSyncPush = useUIStore((s: UIState) => s.autoSyncPush)
  const sidebarView = useUIStore((s: UIState) => s.sidebarView)
  // 布尔 selector：仅在 tab 增删时重渲染
  const hasTabs = useEditorStore((s) => s.tabs.length > 0)
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
  // 托盘"退出"菜单请求标志：由 tray-quit-requested listener 设置，
  // close-requested handler 读取后重置。为 true 时跳过 closeWithoutExit 的 hide 分支，走真正退出。
  const forceQuitRef = useRef(false)
  // rAF 节流：拖拽面板宽度时每帧最多更新一次
  const rafRef = useRef<number | null>(null)
  // StrictMode 双调用导致副作用重复执行
  const initRef = useRef(false)
  // 标记启动关键路径已完成，自动同步可以开始
  const startupReadyRef = useRef(false)

  // ── Session 持久化 (提取自 App.tsx 的独立 hook) ──
  const { saveSessionStateNow, restoreSessionState, restoreWindowGeometry } = useSessionPersistence()

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    const init = async () => {
      const appInitT0 = performance.now()
      logTime('app_init_begin', appInitT0)
      // 初始化统一日志模块（注入 @tauri-apps/plugin-log 为 fileWriter）
      await attachLogger()
      const { initMode, loadLatestByMode } = useWorkspaceStore.getState()
      const { loadSettings: loadEditorSettings } = useEditorSettingsStore.getState()
      const { loadSettings: loadUISettings } = useUIStore.getState()

      // Step 1: Initialize workspace mode first (determines folder vs workspace)
      await initMode()
      logTime('app_init_mode', appInitT0)

      // Step 2: Load settings in parallel (these are independent)
      await Promise.all([
        loadEditorSettings(),
        loadUISettings(),
      ])
      logTime('app_init_settings', appInitT0)

      // Step 3: 在显示窗口前恢复窗口几何（尺寸/位置/最大化/全屏），
      // 避免用户先看到默认尺寸再被 resize 产生的"闪一下"
      await restoreWindowGeometry()
      logTime('app_init_geometry', appInitT0)

      // 设置加载完成后立即显示窗口，避免用户等待文件树加载
      try {
        await getCurrentWindow().show()
        logTime('app_window_shown', appInitT0)
      } catch (e) {
        logger.warn('app', 'Failed to show window:', e)
      }

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
          // Windows: html/body 圆角匹配 DWM 窗口圆角裁剪，应用边框由外层容器 inset-[2px] + background 间隙绘制
          document.documentElement.style.borderRadius = '12px'
          document.body.style.borderRadius = '12px'
        }
        logTime('app_init_window_style', appInitT0)
      } catch (e) {
        logger.warn('app', 'Failed to set window style:', e)
      }

      // Step 4: 窗口可见后加载文件树与恢复会话
      // loadLatestByMode 需先完成以建立文件树，再恢复会话状态
      await loadLatestByMode()
      logTime('app_init_filetree', appInitT0)
      await restoreSessionState()
      logTime('app_init_session_restored', appInitT0)

      // 启动关键路径已完成，自动同步可以开始
      // checkReady 会通过 cachedRepositories.length > 0 等待首次仓库扫描完成
      startupReadyRef.current = true
      
      // Step 5: 延迟加载插件和后台服务，确保编辑器先就绪可交互

      // Sync current i18n language to the Rust backend (fire-and-forget)
      import('i18next').then(({ default: i18n }) => {
        setAppLocale(i18n.language).catch((e) => logger.warn('app', 'setAppLocale failed', e))
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
                  logger.warn('app', 'failed to seed plugin storage sizes:', err)
                })
            } catch (err) {
              logger.warn('app', 'failed to init plugin storage sizes:', err)
            }

            try {
              const { subscribeToPluginStorageChanges } = await import('@/lib/plugin-telemetry')
              void subscribeToPluginStorageChanges().catch((err) => {
                logger.warn('app', 'failed to subscribe to plugin storage changes:', err)
              })
            } catch (err) {
              logger.warn('app', 'failed to subscribe plugin storage changes:', err)
            }

            try {
              const { hydratePermissionGuard } = await import('@/lib/plugin-permissions')
              void hydratePermissionGuard(defs.map((d) => d.id))
            } catch (err) {
              logger.warn('app', 'failed to hydrate permission guard:', err)
            }

            try {
              const { hydrateAutoUpdateFromLocalStorage, runAutoUpdateOnStartup } =
                await import('@/lib/plugin-auto-update')
              hydrateAutoUpdateFromLocalStorage()
              void runAutoUpdateOnStartup()
            } catch (err) {
              logger.warn('app', 'failed to init plugin auto update:', err)
            }

            // 后台检查插件更新以显示角标
            try {
              const { usePluginMarketStore } = await import('@/stores/plugin-market')
              const marketStore = usePluginMarketStore.getState()
              await marketStore.loadRepoSources()
              void marketStore.refreshIndex({ background: true })
              void marketStore.refreshUpdates({ background: true })
            } catch (err) {
              logger.warn('app', 'failed to check plugin updates on startup:', err)
            }
          } catch (err) {
            logger.error('app', 'Failed to load plugins on startup:', err)
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

  // 记录 App 组件首次渲染完成时间
  useEffect(() => {
    logTime('app_first_render', 0)
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    // 使用 onCloseRequested 而非 win.listen('tauri://close-requested', ...)：
    // onCloseRequested 会 await handler 完成，handler 完成后才自动 destroy；
    // win.listen 是 fire-and-forget，Tauri 不等 async handler，会在第一个 await 后销毁窗口，
    // 导致 saveSessionStateNow 等 async 保存逻辑被打断（Layer 5 根因）。
    const unlistenPromise = win.onCloseRequested(async (event) => {
      // 关闭前保存当前活动 tab 的滚动位置
      try {
        const activeId = useEditorStore.getState().activeTabId
        if (activeId) {
          const top = readActiveEditorScrollTop()
          if (top != null && top > 0) {
            useEditorStore.getState().updateScrollTop(activeId, top)
          }
        }
      } catch (e) {
        logger.warn('app', 'save scrollTop on close failed', e)
      }

      // 通知插件 app 退出（不 await）
      try {
        const { emitAppExit } = await import('@/lib/plugin-host')
        emitAppExit()
      } catch { /* ignore */ }

      // 退出前刷新所有插件 storage 缓存到磁盘，避免防抖/飞行中写入丢失
      try {
        const { flushAllPluginStorage } = await import('@/lib/plugin-host')
        await flushAllPluginStorage()
      } catch (e) {
        logger.warn('app', 'flushAllPluginStorage on close failed', e)
      }

      // 先 flush 编辑器防抖内容避免丢失
      try {
        const { flushAllEditors } = await import('@/lib/editor-flush')
        await flushAllEditors()
      } catch (e) {
        logger.warn('app', 'flushAllEditors on close failed', e)
      }

      const { closeWithoutExit } = useUIStore.getState()
      const dirtyCount = useEditorStore.getState().getDirtyTabsCount()
      // 托盘"退出"菜单触发时 forceQuitRef=true，跳过 closeWithoutExit 的 hide 分支，走真正退出。
      // dirty>0 走 SaveDialog 分支时不 reset forceQuitRef——交给 handleSaveAndClose /
      // handleDiscardAndClose / handleCancelClose 在流程结束时消费，否则这些 handler 读不到标志，
      // 会按 closeWithoutExit 走 win.hide() 而非 win.destroy()，导致托盘"退出"被拦截为"隐藏"。
      const isForceQuit = forceQuitRef.current
      if (dirtyCount > 0) {
        const dirtyTabs = useEditorStore.getState().tabs.filter((t) => t.isDirty || t.frontmatterDirty)
        const names = dirtyTabs.slice(0, 5).map((t) => t.name)
        if (dirtyTabs.length > 5) names.push('...')
        setDirtyFileNames(names)
        setShowSaveDialog(true)
        pendingCloseRef.current = true
        // 阻止默认关闭，等用户在 SaveDialog 选择后再处理
        event.preventDefault()
      } else if (closeWithoutExit && !isForceQuit) {
        // closeWithoutExit 模式：保存后隐藏而非销毁，阻止默认 destroy
        await saveSessionStateNow()
        await win.hide()
        const { setDockIconVisibility } = await import('@/lib/tauri')
        // 次要副作用，失败不阻塞退出
        setDockIconVisibility(false).catch((err) => logger.warn('app', 'setDockIconVisibility failed', err))
        event.preventDefault()
      } else {
        // 真正退出：保存后允许默认 destroy（不调 preventDefault）
        await saveSessionStateNow()
      }
    })
    return () => { unlistenPromise.then(fn => fn()) }
  }, [])

  // 托盘"退出"菜单：Rust 端 emit tray-quit-requested 设置 forceQuit 标志后立即 window.close()，
  // 前端收到事件只设置 forceQuit 标志（不调 window.close()，避免与 Rust 端重复 close）。
  // close 触发的 close-requested handler 检测 forceQuit 后跳过 closeWithoutExit 的 hide 分支。
  useEffect(() => {
    let unlistenFn: (() => void) | null = null
    listen('tray-quit-requested', () => {
      forceQuitRef.current = true
    }).then((fn) => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
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

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
        saveTimer = null
      }, 500)
    }

    // 仅在 tabs 切片变化时触发保存，避免 cursorPosition 等无关状态变更无谓触发防抖保存
    const unsubscribeTabs = useEditorStore.subscribe(s => s.tabs, scheduleSave)

    // 面板宽度变化时也触发保存（拖拽缩放后即使无标签变化也能持久化）
    const unsubscribeUI = useUIStore.subscribe((state, prevState) => {
      if (state.sidebarWidth !== prevState.sidebarWidth ||
          state.rightPanelWidth !== prevState.rightPanelWidth) {
        scheduleSave()
      }
    })

    // Listen for save-session-now events (e.g., before install & restart)
    const handleSaveSessionNow = () => {
      saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
    }
    window.addEventListener('save-session-now', handleSaveSessionNow)

    return () => {
      unsubscribeTabs()
      unsubscribeUI()
      window.removeEventListener('save-session-now', handleSaveSessionNow)
      if (saveTimer) clearTimeout(saveTimer)
    }
  }, [saveSessionStateNow])

  // Auto sync: periodically pull all git repositories based on syncInterval setting
  const syncIntervalRef = useRef(syncInterval)
  syncIntervalRef.current = syncInterval
  const autoSyncPushRef = useRef(autoSyncPush)
  autoSyncPushRef.current = autoSyncPush
  const cachedReposRef = useRef(cachedRepositories)
  cachedReposRef.current = cachedRepositories
  const pullAllReposRef = useRef(pullAllRepos)
  pullAllReposRef.current = pullAllRepos
  // 防止 setInterval 触发的 doSync 与上一次重叠（弱网下 pull 120s 超时 + push 可能超过 syncInterval）
  const isSyncingRef = useRef(false)
  // 标记当前是否为启动首次同步，用于跳过同步后的冗余重扫
  const isInitialStartupSyncRef = useRef(true)
  // 标记启动首次同步是否已尝试完成，用于收紧 30s 去重兜底
  const hasCompletedInitialStartupSyncRef = useRef(false)

  useEffect(() => {
    const doSync = async () => {
      // 重入保护：上一次同步未完成时跳过，避免并发 git 操作导致 index 锁冲突
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const repos = cachedReposRef.current
      if (repos.length === 0) {
        isSyncingRef.current = false
        return
      }
      const gitStore = useGitStore.getState()

      // 启动阶段兜底：启动首次同步完成前，30 秒内已成功同步过则跳过，避免重复触发
      const last = gitStore.syncStatus.lastSyncTime
      if (!hasCompletedInitialStartupSyncRef.current && last && Date.now() - last < 30_000) {
        isSyncingRef.current = false
        return
      }

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
            const { commitAndPushRepo } = await import('@/lib/git/service')
            for (const repo of reposWithChanges) {
              const r = await commitAndPushRepo(repo, 'Auto sync')
              if (r.success) {
                // G-02 修复：auto sync 只统计有实际提交或推送的
                if (r.committed || r.pushed) {
                  pushSucceeded++
                }
                continue
              }
              if (r.needsCredential) {
                // auto-sync 静默跳过, 无凭证不弹 dialog
                continue
              }
              const code = r.errorCode ?? GitErrorCode.Unknown
              const errorMessage = r.error || ''
              // Track conflict repos from push phase
              if (code === GitErrorCode.RebaseConflict || errorMessage.includes('rebase/merge is in progress')) {
                pushConflictPaths.push(repo.path)
                continue
              }
              // G-04 修复：rebase --continue 或 merge commit 失败，按冲突处理
              if (code === GitErrorCode.RebaseContinueFailed || code === GitErrorCode.MergeCommitFailed) {
                pushConflictPaths.push(repo.path)
                continue
              }
              // G-06 修复：detached HEAD 跳过，不重试
              if (code === GitErrorCode.DetachedHead) {
                continue
              }
              pushFailed++
              pushErrorPaths.push(repo.path)
              logger.error('app', 'Auto sync push failed:', repo.path, errorMessage)
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

        // 启动首次同步刚完成过扫描，无需立即重扫；后续周期同步仍需刷新 hasUncommittedChanges
        if (!isInitialStartupSyncRef.current) {
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
          toast.warning(tRef.current('git.pullConflict', { repos: repoNames }))

          // Do NOT auto-open conflict tabs — user must click conflict icon or repo to open
          // Sync conflict repos to database for persistence
          await gitStore.syncConflictReposFromPullResults(allResults)
        }
      } catch (e) {
        logger.error('app', 'Auto sync failed:', e)
        gitStore.setSyncStatus({ isSyncing: false })
      } finally {
        isSyncingRef.current = false
      }
    }

    let intervalId: ReturnType<typeof setInterval> | null = null
    let checkId: ReturnType<typeof setTimeout> | null = null
    let postReadyDelayId: ReturnType<typeof setTimeout> | null = null
    let maxWaitId: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    const scheduleInterval = () => {
      if (intervalId) clearInterval(intervalId)
      const intervalMs = syncIntervalRef.current * 60 * 1000
      if (intervalMs > 0) {
        intervalId = setInterval(() => {
          doSync()
        }, intervalMs)
      }
    }

    const startInitialSync = () => {
      // 启动就绪后再延迟 2 秒，确保 UI 完全稳定
      postReadyDelayId = setTimeout(() => {
        isInitialStartupSyncRef.current = true
        doSync().finally(() => {
          hasCompletedInitialStartupSyncRef.current = true
          isInitialStartupSyncRef.current = false
          scheduleInterval()
        })
      }, 2000)
    }

    const checkReady = () => {
      if (isCancelled) return
      if (startupReadyRef.current && cachedReposRef.current.length > 0) {
        startInitialSync()
        return
      }
      checkId = setTimeout(checkReady, 500)
    }

    // 最多等待 30 秒启动就绪，超时则只建立周期同步
    maxWaitId = setTimeout(() => {
      if (checkId) clearTimeout(checkId)
      if (!intervalId) scheduleInterval()
    }, 30_000)

    checkReady()

    // 运行时修改 syncInterval 需要重建周期定时器
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState | undefined) => {
      if (prevState && state.syncInterval !== prevState.syncInterval) {
        syncIntervalRef.current = state.syncInterval
        scheduleInterval()
      }
    })

    return () => {
      isCancelled = true
      if (checkId) clearTimeout(checkId)
      if (postReadyDelayId) clearTimeout(postReadyDelayId)
      if (maxWaitId) clearTimeout(maxWaitId)
      if (intervalId) clearInterval(intervalId)
      unsubscribe()
    }
  }, [])

  const handleSaveAndClose = async () => {
    // 标记已采取行动，阻止 onOpenChange 调用 handleCancelClose
    actionTakenRef.current = true
    const shouldClose = pendingCloseRef.current
    // 消费 forceQuit 标志：托盘"退出"触发 close-requested 时设置，dirty>0 走 SaveDialog 分支保留至此
    const isForceQuit = forceQuitRef.current
    forceQuitRef.current = false
    setShowSaveDialog(false)
    pendingCloseRef.current = false
    if (!shouldClose) { actionTakenRef.current = false; return }
    await flushAllEditors()
    await useEditorStore.getState().saveAllDirtyTabs()
    const win = getCurrentWindow()
    await saveSessionStateNow()
    const { closeWithoutExit } = useUIStore.getState()
    if (closeWithoutExit && !isForceQuit) {
      await win.hide()
      const { setDockIconVisibility } = await import('@/lib/tauri')
      // 次要副作用，失败不阻塞退出
      setDockIconVisibility(false).catch((err) => logger.warn('app', 'setDockIconVisibility failed', err))
    } else {
      await win.destroy()
    }
    actionTakenRef.current = false
  }

  const handleDiscardAndClose = async () => {
    // 标记已采取行动，阻止 onOpenChange 调用 handleCancelClose
    actionTakenRef.current = true
    const shouldClose = pendingCloseRef.current
    // 消费 forceQuit 标志：托盘"退出"触发 close-requested 时设置，dirty>0 走 SaveDialog 分支保留至此
    const isForceQuit = forceQuitRef.current
    forceQuitRef.current = false
    setShowSaveDialog(false)
    pendingCloseRef.current = false
    if (!shouldClose) { actionTakenRef.current = false; return }
    useEditorStore.getState().resetDirtyTabs()
    const win = getCurrentWindow()
    await saveSessionStateNow()
    const { closeWithoutExit } = useUIStore.getState()
    if (closeWithoutExit && !isForceQuit) {
      await win.hide()
      const { setDockIconVisibility } = await import('@/lib/tauri')
      // 次要副作用，失败不阻塞退出
      setDockIconVisibility(false).catch((err) => logger.warn('app', 'setDockIconVisibility failed', err))
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
    // 用户取消则放弃退出意图，托盘"退出"也被取消（应用保持打开）
    forceQuitRef.current = false
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
    // 拖拽结束后保存会话状态（面板宽度等），避免崩溃或强制关闭后丢失
    saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
  }, [saveSessionStateNow])

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

  const developerMode = useUIStore((s: UIState) => s.developerMode)

  // Disable the system default context menu across the entire app
  // Custom context menus (Radix UI ContextMenu) handle their own right-click logic internally
  const handleContextMenu = useCallback((_e: React.MouseEvent) => {
    if (!developerMode) {
      _e.preventDefault()
    }
  }, [developerMode])

  return (
    <TooltipProvider>
      {/* 外层: 铺满窗口, 2px padding 显示主题色作为边框 */}
      <div
        className="fixed inset-[2px] flex flex-col p-px rounded-[10px] box-border"
        style={{
          background: 'var(--theme-color)',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size)',
        }}
        onContextMenu={handleContextMenu}
      >
        {/* 内容层: 实际背景 */}
        <div
          className="flex-1 flex flex-col overflow-hidden rounded-[8px]"
          style={{ background: 'var(--bg-primary-gradient, var(--bg-primary))' }}
        >
        {/* Title Bar */}
        <TitleBar />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden gap-x-0.5 px-1 pr-1.5">
          {/* Activity Bar */}
          <ActivityBar />

          {/* Sidebar - hidden when settings/fullPanel/pluginManager open or collapsed */}
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
              <Suspense fallback={null}><FullPanelPluginContent plugin={activeFullPanelPlugin} /></Suspense>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {hasTabs && (
                  <>
                    <TabBar />
                    <EditorToolbar />
                  </>
                )}
                <ErrorBoundary fallback={
                  <div className="flex items-center justify-center flex-1 text-sm text-[var(--text-muted)]">
                    {t('editor.loadFailed')}
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
              <RightPanelContent />
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

        {/* LogViewer Dialog (Ctrl+Shift+Y) */}
        <Suspense fallback={null}>
          <LogViewer open={logViewerVisible} onOpenChange={(o) => { if (!o) toggleLogViewer() }} />
        </Suspense>
        </div>
      </div>
    </TooltipProvider>
  )
}

export { App }
