/**
 * Editor Component - Main editor area
 * Shows the content of the active tab with appropriate editor
 */
import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore } from '@/stores'
import { setEditorContainerEl, setLastScrollTop } from '@/stores/editor'
import { detectFileType } from '@/lib/utils/fileTypeUtils'
import { pluginEditorRegistry } from '@/stores/pluginEditor'
import { restoreScrollTop } from '@/lib/scroll-position'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { builtinEditorRegistry, registerBuiltinEditors, usePluginEditorBridge } from '@/components/editors/builtin-editors'
import type { EditorProps } from '@/components/editors/editor-registry'
import { FileCode, FolderOpen, FileText, Clock, GitFork, ArrowRight, Layers } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from 'react-i18next'
import { openFolderDialog, openFileDialog, getFolderHistory } from '@/lib/tauri'
import { formatShortcutForDisplay, getShortcutKey } from '@/lib/shortcuts'
import appIconUrl from '@/assets/app-icon.png'
import { logger } from '@/lib/logger'

// 注册内置编辑器(幂等)
registerBuiltinEditors()

interface UnsupportedEditorProps {
  filename: string
  reason: string
}

function UnsupportedEditor({ filename, reason }: UnsupportedEditorProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary-gradient,var(--bg-primary))]">
      <div className="text-center">
        <FileCode size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg text-[var(--text-muted)]">{t('editor.cannotOpen')}</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">{filename}</p>
        <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">{reason}</p>
      </div>
    </div>
  )
}

function WelcomeActionItem({
  icon: Icon,
  label,
  shortcut,
  description,
  onClick,
}: {
  icon: React.ElementType
  label: string
  shortcut?: string
  description?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 w-full px-4 py-2.5 rounded-md text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{ color: 'var(--text-primary)' }}
    >
      <Icon size={18} className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--theme-color)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{label}</span>
          {shortcut && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-mono"
              style={{
                background: 'var(--bg-hover)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-color)'
              }}
            >
              {shortcut}
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{description}</p>
        )}
      </div>
      <ArrowRight size={14} className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />
    </button>
  )
}

function RecentFileItem({ path, onClick }: { path: string; onClick: () => void }) {
  const isWorkspace = path.endsWith('.swallow-workspace')
  const name = isWorkspace
    ? (path.split('/').pop() || path).replace('.swallow-workspace', '')
    : (path.split('/').pop() || path)
  const dir = path.substring(0, path.lastIndexOf('/'))
  const dirName = dir.split('/').pop() || dir

  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2 w-full px-4 py-1.5 rounded-sm text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{ color: 'var(--text-primary)' }}
    >
      {isWorkspace ? (
        <Layers size={13} className="shrink-0" style={{ color: 'var(--theme-color)' }} />
      ) : (
        <FolderOpen size={13} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
      )}
      <span className="text-[13px] flex-1 truncate">{name}</span>
      <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{dirName}</span>
    </button>
  )
}

function WelcomeScreen() {
  const { t } = useTranslation()
  const customShortcuts = useUIStore((s) => s.customShortcuts)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const [recentPaths, setRecentPaths] = useState<string[]>([])

  // Use the imported app icon URL (Vite static asset)
  const appIconSrc = appIconUrl

  const getShortcut = useCallback((key: string) => {
    const sc = getShortcutKey(key as any, customShortcuts)
    return formatShortcutForDisplay(sc)
  }, [customShortcuts])

  // Load recent folder history on mount
  useEffect(() => {
    getFolderHistory().then((paths) => setRecentPaths(paths)).catch((e) => logger.warn('editor', 'getFolderHistory failed', e))
  }, [])

  const handleOpenFolder = useCallback(async () => {
    try {
      if (workspaceMode === 'workspace') {
        const { openWorkspaceDialog } = await import('@/lib/tauri')
        const path = await openWorkspaceDialog()
        if (path) {
          await useWorkspaceStore.getState().loadWorkspaceFile(path)
        }
      } else {
        const path = await openFolderDialog()
        if (path) {
          await useWorkspaceStore.getState().openFolder(path)
        }
      }
    } catch (e) {
      logger.error('editor', 'Failed to open:', e)
    }
  }, [workspaceMode])

  const handleOpenFile = useCallback(async () => {
    try {
      const path = await openFileDialog()
      if (!path) return
      // Open file as a tab
      const name = path.split('/').pop() || 'untitled.md'
      const id = `file-${Date.now()}`
      useEditorStore.getState().addTab({
        id,
        path,
        name,
        // Use undefined to indicate "not loaded yet" so loadTabContent
        // and EditorView's auto-load useEffect can trigger correctly.
        // Using '' would be treated as "loaded empty file" and skip loading.
        content: undefined as unknown as string,
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
      })
      useEditorStore.getState().loadTabContent(id)
    } catch (e) {
      logger.error('editor', 'Failed to open file:', e)
    }
  }, [])

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      const isWorkspace = path.endsWith('.swallow-workspace')
      const { switchMode } = useWorkspaceStore.getState()
      if (isWorkspace) {
        // Switch to workspace mode first if needed, then load the workspace file
        if (workspaceMode !== 'workspace') {
          await switchMode('workspace')
        }
        await useWorkspaceStore.getState().loadWorkspaceFile(path)
      } else {
        // Switch to folder mode first if needed, then open the folder
        if (workspaceMode !== 'folder') {
          await switchMode('folder')
        }
        await useWorkspaceStore.getState().openFolder(path)
      }
    } catch (e) {
      logger.error('editor', 'Failed to open recent:', e)
    }
  }, [workspaceMode])

  const handleCloneRepo = useCallback(() => {
    // Dispatch event to open the clone dialog (handled by TitleBarRecentPopover)
    window.dispatchEvent(new CustomEvent('open-clone-dialog'))
  }, [])

  return (
    <div className="flex-1 overflow-auto flex items-center justify-center">
      <div className="max-w-[720px] w-full px-8 py-10 flex flex-col items-center">
        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
          }}>
            <img src={appIconSrc} alt="SwallowNote" className="w-full h-full object-contain" draggable={false} />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('editor.welcome')}
          </h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>
            {t('editor.welcomeHint')}
          </p>
        </div>

        {/* Action Cards */}
        <div className="w-full grid grid-cols-2 gap-3 mb-6 max-w-[600px]">
          {/* Start Card */}
          <div className="rounded-lg p-4 space-y-1" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            border: '1px solid var(--border-color)'
          }}>
            <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              {t('welcome.start')}
            </p>
            <WelcomeActionItem
              icon={FileText}
              label={t('welcome.openFile')}
              shortcut={getShortcut('openFile')}
              onClick={handleOpenFile}
            />
            <WelcomeActionItem
              icon={FolderOpen}
              label={t('welcome.openFolder')}
              shortcut={getShortcut('openFile')}
              onClick={handleOpenFolder}
            />
            <WelcomeActionItem
              icon={GitFork}
              label={t('welcome.cloneRepo')}
              onClick={handleCloneRepo}
            />
          </div>

          {/* Recent Card */}
          <div className="rounded-lg p-4" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            border: '1px solid var(--border-color)'
          }}>
            <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              {t('welcome.recent')}
            </p>
            {recentPaths.length > 0 ? (
              <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
                {recentPaths.slice(0, 8).map((path) => (
                  <RecentFileItem
                    key={path}
                    path={path}
                    onClick={() => handleOpenRecent(path)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('welcome.noRecent')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Keyboard Shortcuts Hint */}
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>{getShortcut('commandPalette')}</kbd> {t('welcome.quickOpen')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>{getShortcut('newFile')}</kbd> {t('welcome.newFile')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>{getShortcut('saveFile')}</kbd> {t('welcome.save')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>{getShortcut('settings')}</kbd> {t('welcome.settings')}</span>
        </div>
      </div>
    </div>
  )
}

export function EditorView() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const updateTabContent = useEditorStore((s) => s.updateTabContent)
  const scrollToLine = useEditorStore((s) => s.scrollToLine)
  const loadTabContent = useEditorStore((s) => s.loadTabContent)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const scrollToLineRef = useRef(scrollToLine)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const prevActiveTabIdRef = useRef<string | null>(null)
  /** 标记已恢复 scrollTop 的 tab id，避免 content 变化时重复恢复覆盖用户手动滚动 */
  const restoredTabIdRef = useRef<string | null>(null)

  // 注册编辑器容器引用到 store，供 setActiveTab 读取 scrollTop
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    editorContainerRef.current = el
    setEditorContainerEl(el)
  }, [])
  const { t } = useTranslation()

  // 持续跟踪编辑器滚动位置到模块级缓存。
  // 应用退出（tauri://close-requested）触发时 React 可能已开始卸载 Editor，
  // editorContainerEl 变为 null，此时 readActiveEditorScrollTop 读不到 DOM。
  // 用 scroll 捕获监听持续把 scrollTop 写入缓存，退出时 store 优先读 DOM、
  // 失败时回退到缓存，保证用户滚动位置不丢失。
  // 捕获阶段（capture: true）能监听到 .cm-scroller / Radix viewport 等内部
  // 滚动容器的 scroll 事件，无需关心它们何时 mount。
  useEffect(() => {
    const handler = (e: Event) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      const container = editorContainerRef.current
      if (!container) return
      // 只关心编辑器容器内的 scroll 事件
      if (target !== container && !container.contains(target)) return
      const activeId = useEditorStore.getState().activeTabId
      if (!activeId) return
      setLastScrollTop(activeId, target.scrollTop)
    }
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [])

  // Re-render when the plugin editor registry changes. The plugin
  // store fires its `onLoad` / `onUnload` / `onEnable` / `onDisable`
  // hooks asynchronously after the plugin module is evaluated, so
  // the registry can flip *after* the user has already clicked a
  // `.smm` file. Without this re-render hook the dispatcher would
  // see an empty registry and fall through to the compatibility
  // shim. We delegate the bus subscription to a centralised
  // `usePluginEditors` hook so the host-side permission grant and
  // handler tagging are guaranteed consistent — the `revision`
  // counter increments on every mutation, which we fold into the
  // editor's `key` to force a clean remount of the dispatcher
  // output (so a user who disables → re-enables the mind-map
  // plugin sees the open tab swap from the shim to the live
  // editor without a manual reload).
  const { revision: editorRegistryRev } = usePluginEditorBridge()

  // Listen for scroll-to-line events
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line
      scrollToLineRef.current?.(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => window.removeEventListener('scroll-to-line', handler)
  }, [])

  // Auto-load content when switching to a tab that hasn't been loaded yet
  useEffect(() => {
    if (!activeTab) return
    if (activeTab.type === 'diff' || activeTab.type === 'conflict') return

    // Check if content needs to be loaded
    // content === undefined means not loaded yet (empty string is valid content)
    // 插件 tab 的内容由插件通过 openEditorTab 提供，不走文件系统加载流程
    const needsLoad = activeTab.content === undefined && !activeTab.isLoading && activeTab.type !== 'plugin'

    if (needsLoad) {
      // Small delay to ensure UI is ready
      const timer = setTimeout(() => {
        loadTabContent(activeTab.id)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [activeTab?.id, activeTab?.content, activeTab?.isLoading, activeTab?.type, loadTabContent])

  // 恢复滚动位置：新 tab 内容渲染完成后恢复 scrollTop
  // 保存逻辑在 store 的 setActiveTab 中处理（切换前同步读取 DOM）
  useEffect(() => {
    const currentId = activeTab?.id ?? null

    // tab 切换时重置已恢复标记
    if (prevActiveTabIdRef.current !== currentId) {
      restoredTabIdRef.current = null
      prevActiveTabIdRef.current = currentId
    }

    // 新 tab 恢复：仅在该 tab 首次内容就绪时恢复一次，避免覆盖用户手动滚动
    if (
      currentId &&
      currentId !== restoredTabIdRef.current &&
      activeTab?.scrollTop != null &&
      activeTab.scrollTop > 0 &&
      activeTab.content !== undefined
    ) {
      const savedTop = activeTab.scrollTop
      restoredTabIdRef.current = currentId
      let cancelled = false
      const raf = requestAnimationFrame(() => {
        if (cancelled) return
        restoreScrollTop(editorContainerRef.current, savedTop).catch(() => { /* noop */ })
      })
      return () => {
        cancelled = true
        cancelAnimationFrame(raf)
      }
    }
  }, [activeTab?.id, activeTab?.scrollTop, activeTab?.content])

  if (!activeTab) {
    return <WelcomeScreen />
  }

  const pluginExtensions = pluginEditorRegistry.getActivePluginExtensions()
  const fileType = activeTab.type === 'plugin'
    ? 'markdown'
    : detectFileType(activeTab.name, activeTab.content, pluginExtensions)

  const handleContentChange = (content: string) => {
    updateTabContent(activeTab.id, content)
  }

  // 查表:用 registry resolve 替代 if-else 树
  const descriptor = builtinEditorRegistry.resolve({
    tab: activeTab,
    fileType,
    pluginExtensions,
  })

  // BinaryView fallback:registry 返回 null(内置 + 插件均未命中)
  if (!descriptor) {
    return (
      <div ref={setContainerRef} className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab.isLoading && (
          <div className="absolute top-0 left-0 right-0 z-10">
            <Progress />
          </div>
        )}
        <ErrorBoundary>
          <UnsupportedEditor filename={activeTab.name} reason={t('editor.binaryFile')} />
        </ErrorBoundary>
      </div>
    )
  }

  // 构造统一 EditorProps:adapter 负责 content 转换和 onChange 包装
  // source mode 的 frontmatter 处理已下沉到 sourceModeAdapter
  const editorProps: EditorProps = descriptor.adapter({
    tab: activeTab,
    onChange: handleContentChange,
  })

  // 渲染组件:统一走 descriptor(内置 + 插件均已通过 registry 注册)
  const EditorComponent = descriptor.component
  // 插件 enable/disable 时 revision 变化,强制 remount 以切换组件实现
  const editorKey = `${activeTab.id}:${descriptor.id}:${editorRegistryRev}`

  return (
    <div ref={setContainerRef} className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab.isLoading && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <Progress />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Progress /></div>}>
          <ErrorBoundary key={editorKey}>
            <EditorComponent {...editorProps} />
          </ErrorBoundary>
        </Suspense>
      </div>
    </div>
  )
}
