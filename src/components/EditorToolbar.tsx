/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Clipboard, Type, Maximize2, Minimize2, AlertTriangle, RefreshCw, GitMerge } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore, useEditorSettingsStore, useGitStore, usePluginStore } from '@/stores'
import type { ConflictRepoRecord } from '@/lib/tauri'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { useTranslation } from 'react-i18next'
import { pluginRightPanelType, renderPluginIcon, pluginSidebarView } from '@/lib/plugin-utils'

function EditorToolbar() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const toggleViewMode = useEditorStore((s) => s.toggleViewMode)
  const rightPanelType = useUIStore((s) => s.rightPanelType)
  const setRightPanelType = useUIStore((s) => s.setRightPanelType)
  const noteWidth = useUIStore((s) => s.noteWidth)
  const sidebarView = useUIStore((s) => s.sidebarView)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const settingsPanelVisible = useUIStore((s) => s.settingsPanelVisible)
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const normalPaddingVertical = useEditorSettingsStore((s) => s.normalPaddingVertical)
  const normalPaddingHorizontal = useEditorSettingsStore((s) => s.normalPaddingHorizontal)
  const widePaddingVertical = useEditorSettingsStore((s) => s.widePaddingVertical)
  const widePaddingHorizontal = useEditorSettingsStore((s) => s.widePaddingHorizontal)
  const conflictFilesMap = useGitStore((s) => s.conflictFilesMap)
  const conflictRepos = useGitStore((s) => s.conflictRepos)
  const editorToolbarPlugins = usePluginStore((s) => s.registry.editorToolbar)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [copied, setCopied] = useState(false)
  const [isWide, setIsWide] = useState(noteWidth === 'wide')
  const savedPaddingRef = useRef({ vertical: normalPaddingVertical, horizontal: normalPaddingHorizontal })
  const { t } = useTranslation()

  // Listen for padding changes from settings panel
  useEffect(() => {
    savedPaddingRef.current = { vertical: normalPaddingVertical, horizontal: normalPaddingHorizontal }
  }, [normalPaddingVertical, normalPaddingHorizontal])

  if (!activeTab) return null

  // Don't show toolbar for diff and conflict tabs
  if (activeTab.type === 'diff' || activeTab.type === 'conflict') return null

  const { path, viewMode } = activeTab
  const isMarkdown = /\.(md|markdown)$/i.test(path)

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
      console.error('Failed to open folder:', err)
    }
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch (err) {
      console.error('Failed to copy path:', err)
    }
  }

  const handleToggleWidth = () => {
    const container = document.querySelector('.blocknote-editor-container')
    if (!container) return

    const scrollArea = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
    if (!scrollArea) return

    const newWide = !isWide
    if (isWide) {
      scrollArea.style.paddingTop = `${savedPaddingRef.current.vertical}px`
      scrollArea.style.paddingBottom = `${savedPaddingRef.current.vertical}px`
      scrollArea.style.paddingLeft = `${savedPaddingRef.current.horizontal}px`
      scrollArea.style.paddingRight = `${savedPaddingRef.current.horizontal}px`
    } else {
      savedPaddingRef.current = {
        vertical: parseInt(scrollArea.style.paddingTop) || normalPaddingVertical,
        horizontal: parseInt(scrollArea.style.paddingLeft) || normalPaddingHorizontal
      }
      scrollArea.style.paddingTop = `${widePaddingVertical}px`
      scrollArea.style.paddingBottom = `${widePaddingVertical}px`
      scrollArea.style.paddingLeft = `${widePaddingHorizontal}px`
      scrollArea.style.paddingRight = `${widePaddingHorizontal}px`
    }
    setIsWide(newWide)
    useUIStore.getState().setNoteWidth(newWide ? 'wide' : 'normal')
  }

  return (
    <div className="flex items-center justify-between h-[25px] pl-3 pr-1 text-[11px]   select-none">
      {/* Left: File path - display relative path from root */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate" title={path}>{getRelativePath(path)}</span>
        {activeTab.hasExternalChange && (
          <span
            className="flex items-center gap-1 ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:opacity-80"
            style={{ background: 'var(--bg-warning)', color: 'var(--text-warning)' }}
            onClick={async () => {
              await useEditorStore.getState().loadTabContent(activeTab.id)
              useEditorStore.getState().clearExternalChange(activeTab.id)
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
        {(() => {
          const conflictFiles = conflictRepos
            .filter((r: ConflictRepoRecord) => path.startsWith(r.repo_path))
            .flatMap((r: ConflictRepoRecord) => conflictFilesMap[r.repo_path] || [])
          const isConflict = conflictFiles.includes(path)
          if (!isConflict) return null
          const conflictRepo = conflictRepos.find((r: ConflictRepoRecord) => path.startsWith(r.repo_path))
          // Compute the relative file path within the repo for auto-selection
          const relativeFilePath = conflictRepo ? path.substring(conflictRepo.repo_path.length + 1) : undefined
          return conflictRepo ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { useEditorStore.getState().openConflictTab(conflictRepo.repo_path, conflictRepo.repo_name, { autoSelectFile: relativeFilePath, autoHideTree: true }) }}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: 'var(--color-error)' }}
                >
                  <GitMerge size={14} style={{ color: 'inherit' }} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('editorToolbar.conflictResolve')}</TooltipContent>
            </Tooltip>
          ) : null
        })()}
        {isMarkdown && (<>
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
        </>)}
        {/* History, Open Folder, Copy - available for all file types */}
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

        {/* Plugin icons with iconPosition === 'editorToolbar' */}
        {editorToolbarPlugins.map((plugin) => {
          const handleClick = () => {
            if (plugin.contentPosition === 'rightPanel') {
              const pluginPanelType = pluginRightPanelType(plugin.id)
              if (rightPanelType === pluginPanelType) {
                setRightPanelType(null)
                usePluginStore.getState().setActivePlugin(null, 'rightPanel')
              } else {
                setRightPanelType(pluginPanelType)
                usePluginStore.getState().setActivePlugin(plugin.id, 'rightPanel')
              }
            } else if (plugin.contentPosition === 'leftPanel') {
              const pluginViewId = pluginSidebarView(plugin.id)
              const uiState = useUIStore.getState()
              if (uiState.sidebarView === pluginViewId && uiState.sidebarVisible) {
                uiState.toggleSidebar()
                // setActivePlugin(null, ...) below also resets sidebarView
                // to 'explorer' through the cross-store coupling in the
                // plugin store.
                usePluginStore.getState().setActivePlugin(null, 'leftPanel')
              } else {
                uiState.setSidebarVisible(true)
                uiState.setSidebarView(pluginViewId)
                usePluginStore.getState().setActivePlugin(plugin.id, 'leftPanel')
              }
            } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
              const pluginViewId = pluginSidebarView(plugin.id)
              const uiState = useUIStore.getState()
              if (uiState.settingsPanelVisible && uiState.sidebarView === pluginViewId) {
                uiState.setSettingsPanelVisible(false)
                // Reset sidebarView to explorer so a subsequent leftPanel
                // open shows the default view, not this plugin's stale view.
                uiState.setSidebarView('explorer')
                usePluginStore.getState().setActivePlugin(null, 'fullPanel')
              } else {
                uiState.setSettingsPanelVisible(true)
                uiState.setSidebarView(pluginViewId)
                usePluginStore.getState().setActivePlugin(plugin.id, 'fullPanel')
              }
            }
          }

          const isPluginActive = (() => {
            if (plugin.contentPosition === 'rightPanel') {
              return rightPanelType === pluginRightPanelType(plugin.id)
            } else if (plugin.contentPosition === 'fullPanel' || plugin.contentPosition === 'editorArea') {
              const pluginViewId = pluginSidebarView(plugin.id)
              return settingsPanelVisible && sidebarView === pluginViewId
            } else {
              const pluginViewId = pluginSidebarView(plugin.id)
              return sidebarView === pluginViewId && sidebarVisible
            }
          })()

          return (
            <Tooltip key={plugin.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleClick}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                  style={{ color: isPluginActive ? 'var(--theme-color)' : 'var(--text-primary)' }}
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
  )
}

export { EditorToolbar }