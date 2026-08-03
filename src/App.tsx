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
import { PluginManagerView, PluginManagerLoading, preloadPluginManager } from '@/components/PluginManagerLoading'
const LogViewer = lazy(() => import('@/components/LogViewer').then(m => ({ default: m.LogViewer })))
import { StatusBar } from '@/components/StatusBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useUIStore, useWorkspaceStore, useEditorStore, usePluginStore } from '@/stores'
import type { UIState } from '@/stores'
import { useTheme, useKeyboardShortcuts } from '@/hooks'
import { useAutoSync } from '@/hooks/useAutoSync'
import { usePanelResize } from '@/hooks/usePanelResize'
import { useSessionPersistence } from '@/hooks/useSessionPersistence'
import { useSessionAutoSave } from '@/hooks/useSessionAutoSave'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { TooltipProvider } from '@/components'
import { Toaster } from 'sonner'
import { useState, useCallback, useEffect, useRef } from 'react'
import { enableModernWindowStyle } from '@cloudworxx/tauri-plugin-mac-rounded-corners'
import { setAppLocale } from '@/lib/tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { logTime } from '@/lib/app-startup'
import { SaveConfirmDialog } from '@/components/Dialogs/SaveConfirmDialog'
import { TabLoadErrorDialog } from '@/components/Dialogs/TabLoadErrorDialog'
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
  const sidebarView = useUIStore((s: UIState) => s.sidebarView)
  const hasTabs = useEditorStore((s) => s.tabs.length > 0)
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
  // StrictMode 双调用导致副作用重复执行
  const initRef = useRef(false)
  // 标记启动关键路径已完成，自动同步可以开始
  const startupReadyRef = useRef(false)

  const { saveSessionStateNow, restoreSessionState, restoreWindowGeometry } = useSessionPersistence()

  const {
    isDraggingLeft, isDraggingRight, isHoveringLeft, isHoveringRight,
    setIsHoveringLeft, setIsHoveringRight, handleMouseDownLeft, handleMouseDownRight,
  } = usePanelResize(saveSessionStateNow)

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

  useFileWatcher()

  useSessionAutoSave(saveSessionStateNow)

  useAutoSync(startupReadyRef, tRef)

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
        <SaveConfirmDialog
          open={showSaveDialog}
          dirtyFileNames={dirtyFileNames}
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={handleCancelClose}
        />

        {/* Tab Load Error Dialog */}
        <TabLoadErrorDialog
          open={showLoadErrorDialog}
          failedTabInfo={failedTabInfo}
          onClose={() => {
            if (failedTabInfo) {
              useEditorStore.getState().removeTab(failedTabInfo.id)
            }
            setShowLoadErrorDialog(false)
            setFailedTabInfo(null)
          }}
        />

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
