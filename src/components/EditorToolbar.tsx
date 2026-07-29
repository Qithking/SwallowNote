/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Clipboard, Type, Maximize2, Minimize2, AlertTriangle, RefreshCw, GitMerge, Settings2, DownloadCloud, Loader2, Search } from 'lucide-react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore, useGitStore, usePluginStore } from '@/stores'
import type { EditorToolbarConfig } from '@/stores/editor'
import { useShallow } from 'zustand/react/shallow'
import type { ConflictRepoRecord } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { useTranslation } from 'react-i18next'
import { pluginRightPanelType, renderPluginIcon, pluginSidebarView, createToolbarButtonProps, renderPluginToolbarButton } from '@/lib/plugin-utils'
import { PluginErrorBoundary } from '@/components/Plugin/PluginErrorBoundary'
import { downloadCoordinator } from '@/lib/download-coordinator'
import { logger } from '@/lib/logger'
import { FindReplacePanel } from '@/components/FindReplacePanel'
import type { FindReplaceEditorType, FindReplaceMatchCount, FindReplaceOptions } from '@/components/FindReplacePanel'

function EditorToolbar() {
  const toggleViewMode = useEditorStore((s) => s.toggleViewMode)
  const rightPanelType = useUIStore((s) => s.rightPanelType)
  const setRightPanelType = useUIStore((s) => s.setRightPanelType)
  const noteWidth = useUIStore((s) => s.noteWidth)
  const setNoteWidth = useUIStore((s) => s.setNoteWidth)
  const sidebarView = useUIStore((s) => s.sidebarView)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const settingsPanelVisible = useUIStore((s) => s.settingsPanelVisible)
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const conflictFilesMap = useGitStore((s) => s.conflictFilesMap)
  const conflictRepos = useGitStore((s) => s.conflictRepos)
  const editorToolbarPlugins = usePluginStore((s) => s.registry.editorToolbar)
  // Select only the fields EditorToolbar needs.
  // Note: content is included because createToolbarButtonProps requires it.
  const activeTab = useEditorStore(
    useShallow((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      if (!tab) return null
      return {
        id: tab.id,
        path: tab.path,
        name: tab.name,
        content: tab.content ?? '',
        isDirty: tab.isDirty,
        viewMode: tab.viewMode,
        type: tab.type,
        fileSize: tab.fileSize,
        modifiedTime: tab.modifiedTime,
        wordCount: tab.wordCount,
        cursorPosition: tab.cursorPosition,
        hasExternalChange: tab.hasExternalChange ?? false,
        toolbarConfig: tab.toolbarConfig,
      }
    })
  )
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 查找/替换面板状态
  const [findReplaceVisible, setFindReplaceVisible] = useState(false)
  const findReplaceVisibleRef = useRef(findReplaceVisible)
  useEffect(() => { findReplaceVisibleRef.current = findReplaceVisible }, [findReplaceVisible])
  const [findReplaceMatchCount, setFindReplaceMatchCount] = useState<FindReplaceMatchCount>({ current: 0, total: 0 })
  const [findReplaceError, setFindReplaceError] = useState<string | null>(null)
  const [findReplaceQuery, setFindReplaceQuery] = useState('')
  const [findReplaceReplaceText, setFindReplaceReplaceText] = useState('')
  const [findReplaceOptions, setFindReplaceOptions] = useState<FindReplaceOptions>({
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
  })

  useEffect(() => {
    return () => clearTimeout(copyTimer.current)
  }, [])
  // isWide 直接派生自 store，保持与 noteWidth 单一数据源同步
  const isWide = noteWidth === 'wide'
  const [downloading, setDownloading] = useState(false)
  const { t } = useTranslation()

  // 订阅下载协调器 busy 状态变化（事件驱动，替代轮询），在下载期间禁用下载按钮
  useEffect(() => {
    // 初始化为当前状态，避免错过订阅前已发生的变化
    setDownloading(downloadCoordinator.isBusy)
    const unsubscribe = downloadCoordinator.onBusyChange(() => {
      setDownloading(downloadCoordinator.isBusy)
    })
    return unsubscribe
  }, [])

  // 查找/替换:显隐切换(事件与图标按钮共用,关闭时清理高亮)
  const handleToggleFindReplace = useCallback(() => {
    if (findReplaceVisibleRef.current) {
      window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
      setFindReplaceMatchCount({ current: 0, total: 0 })
      setFindReplaceError(null)
    }
    setFindReplaceVisible((v) => !v)
  }, [])

  // 查找/替换:监听 editor:toggle-find-replace 事件切换面板显隐
  useEffect(() => {
    const onMatchCount = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const next = { current: detail.current ?? 0, total: detail.total ?? 0 }
      setFindReplaceMatchCount(next)
    }
    const onReplaceText = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      setFindReplaceReplaceText(detail.text ?? '')
    }
    const onError = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      setFindReplaceError(detail.message ?? null)
    }
    window.addEventListener('editor:toggle-find-replace', handleToggleFindReplace)
    window.addEventListener('editor:find-replace:match-count', onMatchCount)
    window.addEventListener('editor:find-replace:replace-text', onReplaceText)
    window.addEventListener('editor:find-replace:error', onError)
    return () => {
      window.removeEventListener('editor:toggle-find-replace', handleToggleFindReplace)
      window.removeEventListener('editor:find-replace:match-count', onMatchCount)
      window.removeEventListener('editor:find-replace:replace-text', onReplaceText)
      window.removeEventListener('editor:find-replace:error', onError)
    }
  }, [handleToggleFindReplace])

  // AC-11:切换 tab 时自动关闭查找面板
  useEffect(() => {
    setFindReplaceVisible(false)
    // 关闭时清除编辑器内高亮
    window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
    setFindReplaceMatchCount({ current: 0, total: 0 })
    setFindReplaceError(null)
    setFindReplaceQuery('')
    setFindReplaceReplaceText('')
    setFindReplaceOptions({ caseSensitive: false, wholeWord: false, regexp: false })
  }, [activeTab?.id])

  // 冲突文件判定与关联仓库信息（memo 化，避免每次渲染重算 filter/flatMap/includes）。
  // 因 hook 不能在条件 return 之后调用，这里用 activeTab?.path 兼容 activeTab 为 null 的场景。
  const conflictInfo = useMemo(() => {
    const p = activeTab?.path
    if (!p) return { isConflict: false, conflictRepo: null as ConflictRepoRecord | null, relativeFilePath: undefined as string | undefined }
    const conflictFiles = conflictRepos
      .filter((r: ConflictRepoRecord) => p.startsWith(r.repo_path))
      .flatMap((r: ConflictRepoRecord) => conflictFilesMap[r.repo_path] || [])
    const isConflict = conflictFiles.includes(p)
    const conflictRepo = conflictRepos.find((r: ConflictRepoRecord) => p.startsWith(r.repo_path)) ?? null
    const relativeFilePath = conflictRepo ? p.substring(conflictRepo.repo_path.length + 1) : undefined
    return { isConflict, conflictRepo, relativeFilePath }
  }, [conflictRepos, conflictFilesMap, activeTab?.path])

  // 查找/替换:事件处理 callback(必须在条件 return 之前定义)
  const handleCloseFindReplace = useCallback(() => {
    setFindReplaceVisible(false)
    window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
    setFindReplaceMatchCount({ current: 0, total: 0 })
    setFindReplaceError(null)
  }, [])
  const handleFindReplaceQueryChange = useCallback((text: string, options: FindReplaceOptions) => {
    // 不将输入文本回写到 findReplaceQuery,避免双向同步导致输入框光标跳动/无法输入
    setFindReplaceOptions(options)
    window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
      detail: { text, caseSensitive: options.caseSensitive, wholeWord: options.wholeWord, regexp: options.regexp },
    }))
  }, [])
  const handleFindReplaceReplaceTextChange = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', { detail: { text } }))
  }, [])
  const handleFindNext = useCallback(() => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
  }, [])
  const handleFindPrev = useCallback(() => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-prev'))
  }, [])
  const handleReplaceNext = useCallback((replaceText: string) => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-next', { detail: { text: replaceText } }))
  }, [])
  const handleReplaceAll = useCallback((replaceText: string) => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-all', { detail: { text: replaceText } }))
  }, [])

  if (!activeTab) return null

  // Don't show toolbar for diff and conflict tabs
  if (activeTab.type === 'diff' || activeTab.type === 'conflict') return null

  const { path, viewMode } = activeTab
  // 插件 tab 的内容为 markdown，无论 path 扩展名如何
  const isMarkdown = activeTab.type === 'plugin' || /\.(md|markdown)$/i.test(path)
  // 工具栏项可见性：toolbarConfig 中设置为 false 的隐藏，未设置或 true 的显示（默认显示）
  const show = (key: keyof EditorToolbarConfig): boolean => !(activeTab.toolbarConfig?.[key] === false)

  // 查找/替换:根据实际渲染的编辑器决定类型
  // source 视图下 markdown 文件实际使用 CodeEditor,应走 codemirror 模式
  const isBlockNoteEditor = isMarkdown && viewMode !== 'source'
  const findReplaceEditorType: FindReplaceEditorType = isBlockNoteEditor ? 'blocknote' : 'codemirror'

  // Get path relative to workspace root directory, starting with /rootDir/
  const getRelativePath = (absolutePath: string): string => {
    // Normalize path separators for comparison
    const normalizedPath = absolutePath.replace(/\\/g, '/')

    if (workspaceMode === 'workspace' && workspaceFolders.length > 0) {
      for (const folder of workspaceFolders) {
        const normalizedFolder = folder.replace(/\\/g, '/')
        if (normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + '/')) {
          const folderName = normalizedFolder.split('/').pop() || ''
          const relativePart = normalizedPath.substring(normalizedFolder.length + 1)
          return relativePart ? `${folderName}/${relativePart}` : folderName
        }
      }
    }
    if (rootPath) {
      const normalizedRoot = rootPath.replace(/\\/g, '/')
      if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
        const rootDirName = normalizedRoot.split('/').pop() || ''
        const relativePart = normalizedPath.substring(normalizedRoot.length + 1)
        return relativePart ? `${rootDirName}/${relativePart}` : rootDirName
      }
    }
    // Fallback: if no root matches, just show the filename
    return normalizedPath.split('/').pop() || normalizedPath
  }

  const handleOpenFolder = async () => {
    try {
      await invoke('open_in_finder', { path })
    } catch (err) {
      logger.error('editor-toolbar', 'Failed to open folder:', err)
    }
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 3000)
    } catch (err) {
      logger.error('editor-toolbar', 'Failed to copy path:', err)
    }
  }

  // 切换宽窄模式：仅更新 store，排版 padding 由 MarkdownEditor 订阅 noteWidth 自行应用，
  // 避免直接操作 DOM 在 tab 切换后丢失样式的脆弱问题
  const handleToggleWidth = () => {
    setNoteWidth(isWide ? 'normal' : 'wide')
  }

  // Helper: compute activate/deactivate callbacks for a plugin
  const getPluginActivateCallbacks = (pluginId: string, contentPosition: string | undefined) => {
    const activate = () => {
      if (contentPosition === 'rightPanel') {
        setRightPanelType(pluginRightPanelType(pluginId))
        usePluginStore.getState().setActivePlugin(pluginId, 'rightPanel')
      } else if (contentPosition === 'leftPanel') {
        const pluginViewId = pluginSidebarView(pluginId)
        const uiState = useUIStore.getState()
        uiState.setSidebarVisible(true)
        uiState.setSidebarView(pluginViewId)
        usePluginStore.getState().setActivePlugin(pluginId, 'leftPanel')
      } else if (contentPosition === 'fullPanel' || contentPosition === 'editorArea') {
        const pluginViewId = pluginSidebarView(pluginId)
        const uiState = useUIStore.getState()
        uiState.setSettingsPanelVisible(true)
        uiState.setSidebarView(pluginViewId)
        usePluginStore.getState().setActivePlugin(pluginId, 'fullPanel')
      }
    }
    const deactivate = () => {
      if (contentPosition === 'rightPanel') {
        setRightPanelType(null)
        usePluginStore.getState().setActivePlugin(null, 'rightPanel')
      } else if (contentPosition === 'leftPanel') {
        const uiState = useUIStore.getState()
        uiState.toggleSidebar()
        usePluginStore.getState().setActivePlugin(null, 'leftPanel')
      } else if (contentPosition === 'fullPanel' || contentPosition === 'editorArea') {
        const uiState = useUIStore.getState()
        uiState.setSettingsPanelVisible(false)
        uiState.setSidebarView('explorer')
        usePluginStore.getState().setActivePlugin(null, 'fullPanel')
      }
    }
    return { activate, deactivate }
  }

  // Helper: check if a plugin is currently active
  const isPluginActive = (plugin: { id: string; contentPosition?: string }): boolean => {
    if (plugin.contentPosition === 'rightPanel') {
      return rightPanelType === pluginRightPanelType(plugin.id)
    } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
      const pluginViewId = pluginSidebarView(plugin.id)
      return settingsPanelVisible && sidebarView === pluginViewId
    } else {
      const pluginViewId = pluginSidebarView(plugin.id)
      return sidebarView === pluginViewId && sidebarVisible
    }
  }

  return (
    <div className="relative">
    <div className="flex items-center justify-between h-[25px] pl-3 pr-1 text-[11px]   select-none">
      {/* Left: File path - display relative path from root */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {show('showFilePath') && (
          <span className="truncate" title={path}>{getRelativePath(path)}</span>
        )}
        {show('externalChangeWarning') && activeTab.hasExternalChange && (
          <span
            className="flex items-center gap-1 ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:opacity-80"
            style={{ background: 'var(--bg-warning)', color: 'var(--text-warning)' }}
            onClick={async () => {
              // Force reload to overwrite cached content with external changes.
              // loadTabContent clears hasExternalChange on success and keeps it
              // true on failure, so no need to manually clear here.
              await useEditorStore.getState().loadTabContent(activeTab.id, 0, true)
            }}
          >
            <AlertTriangle size={10} />
            {t('editorToolbar.externalChange')}
            <RefreshCw size={10} />
          </span>
        )}
      </div>

      {/* Right: Icons */}
      <div className="flex items-center shrink-0 ml-4">
        {/* Conflict indicator - only shown when the file is actually a conflict file */}
        {show('conflictIndicator') && conflictInfo.isConflict && conflictInfo.conflictRepo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { useEditorStore.getState().openConflictTab(conflictInfo.conflictRepo!.repo_path, conflictInfo.conflictRepo!.repo_name, { autoSelectFile: conflictInfo.relativeFilePath, autoHideTree: true }) }}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: 'var(--color-error)' }}
              >
                <GitMerge size={14} style={{ color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('editorToolbar.conflictResolve')}</TooltipContent>
          </Tooltip>
        )}
        {isMarkdown && (<>
          {show('noteProperties') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRightPanelType(rightPanelType === 'noteProperties' ? null : 'noteProperties')}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: rightPanelType === 'noteProperties' ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  <Settings2 size={14} style={{ color: 'inherit' }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.noteProperties')}</TooltipContent>
            </Tooltip>
          )}
          {show('directory') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRightPanelType(rightPanelType === 'directory' ? null : 'directory')}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: rightPanelType === 'directory' ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  <BookOpen size={14} style={{ color: 'inherit' }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.openMarkdownFolder')}</TooltipContent>
            </Tooltip>
          )}
          {show('sourceView') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleViewMode}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: viewMode === 'source' ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  <Code size={14} style={{ color: 'inherit' }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.toggleSourceView')}</TooltipContent>
            </Tooltip>
          )}
          {show('noteWidth') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleWidth}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: isWide ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  {isWide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.toggleWidth')}</TooltipContent>
            </Tooltip>
          )}
          {show('contentLayout') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRightPanelType(rightPanelType === 'editorSettings' ? null : 'editorSettings')}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: rightPanelType === 'editorSettings' ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  <Type size={14} style={{ color: 'inherit' }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.contentLayout')}</TooltipContent>
            </Tooltip>
          )}
          {show('downloadRemoteImages') && viewMode !== 'source' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('editor:download-remote-images', { detail: { tabId: activeTab.id } }))}
                  disabled={downloading}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  style={{ color: 'var(--text-primary)' }}
                  aria-label={t('editorToolbar.downloadRemoteImages')}
                >
                  {downloading ? (
                    <Loader2 size={14} className="animate-spin" style={{ color: 'inherit' }} />
                  ) : (
                    <DownloadCloud size={14} style={{ color: 'inherit' }} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.downloadRemoteImages')}</TooltipContent>
            </Tooltip>
          )}
        </>)}
        {/* History, Open Folder, Copy - available for all file types */}
        {show('openHistory') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setRightPanelType(rightPanelType === 'history' ? null : 'history')}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: rightPanelType === 'history' ? 'var(--theme-color)' : 'var(--text-primary)' }}
              >
                <History size={14} style={{ color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('editorToolbar.openHistory')}</TooltipContent>
          </Tooltip>
        )}
        {show('openLocation') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleOpenFolder}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: 'var(--text-primary)' }}
              >
                <FolderOpen size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('editorToolbar.openLocation')}</TooltipContent>
          </Tooltip>
        )}
        {/* 查找/替换:file/plugin tab 显示,CM/BN 均支持查找与替换 */}
        {show('showFindReplace') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleFindReplace}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: findReplaceVisible ? 'var(--theme-color)' : 'var(--text-primary)' }}
                title={t('editorToolbar.findReplace.toggle')}
              >
                <Search size={14} style={{ color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('editorToolbar.findReplace.toggle')}</TooltipContent>
          </Tooltip>
        )}
        {show('copyPath') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopyPath}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: copied ? 'var(--theme-color)' : 'var(--text-primary)' }}
              >
                <Clipboard size={14} style={{ color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('editorToolbar.copyFullPath')}</TooltipContent>
          </Tooltip>
        )}

        {/* Plugin icons with iconPosition === 'editorToolbar' */}
        {editorToolbarPlugins.map((plugin) => {
          const active = isPluginActive(plugin)

          // If the plugin provides a custom toolbarButton, render it
          if (plugin.toolbarButton) {
            const { activate, deactivate } = getPluginActivateCallbacks(plugin.id, plugin.contentPosition)
            const toolbarProps = createToolbarButtonProps(plugin.id, active, 14, activate, deactivate, activeTab.content ?? '', activeTab.path ?? '')
            try {
              return (
                <PluginErrorBoundary
                  key={plugin.id}
                  pluginId={plugin.id}
                  pluginName={plugin.name}
                  resetKey={`${plugin.id}-${activeTab.id}`}
                  variant="toolbar"
                  onCrash={(_id, err) => logger.error('editor-toolbar', `Plugin ${plugin.name} crashed:`, err)}
                >
                  {renderPluginToolbarButton(plugin.toolbarButton, toolbarProps)}
                </PluginErrorBoundary>
              )
            } catch (e) {
              // toolbarButton 同步渲染抛错：记录日志并降级为下方默认图标渲染
              logger.error('editor-toolbar', 'Plugin toolbarButton render failed:', e)
            }
          }

          // Default rendering: icon + button that toggles panel
          const handleClick = () => {
            if (active) {
              const { deactivate } = getPluginActivateCallbacks(plugin.id, plugin.contentPosition)
              deactivate()
            } else {
              const { activate } = getPluginActivateCallbacks(plugin.id, plugin.contentPosition)
              activate()
            }
          }

          return (
            <Tooltip key={plugin.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClick}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: active ? 'var(--theme-color)' : 'var(--text-primary)' }}
                >
                  {renderPluginIcon(plugin.icon, 14)}
                </button>
              </TooltipTrigger>
              <TooltipContent>{plugin.name}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
    <FindReplacePanel
      visible={findReplaceVisible}
      editorType={findReplaceEditorType}
      matchCount={findReplaceMatchCount}
      error={findReplaceError}
      initialQuery={findReplaceQuery}
      initialReplaceText={findReplaceReplaceText}
      initialCaseSensitive={findReplaceOptions.caseSensitive}
      initialWholeWord={findReplaceOptions.wholeWord}
      initialRegexp={findReplaceOptions.regexp}
      onClose={handleCloseFindReplace}
      onQueryChange={handleFindReplaceQueryChange}
      onReplaceTextChange={handleFindReplaceReplaceTextChange}
      onFindNext={handleFindNext}
      onFindPrev={handleFindPrev}
      onReplaceNext={handleReplaceNext}
      onReplaceAll={handleReplaceAll}
    />
    </div>
  )
}

export { EditorToolbar }
