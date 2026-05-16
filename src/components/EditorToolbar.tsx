/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Copy, Settings, Maximize2, Minimize2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore, useEditorSettingsStore } from '@/stores'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

function EditorToolbar() {
  const { tabs, activeTabId, toggleViewMode } = useEditorStore()
  const { rightPanelType, setRightPanelType } = useUIStore()
  const { rootPath } = useWorkspaceStore()
  const { normalPaddingVertical, normalPaddingHorizontal, widePaddingVertical, widePaddingHorizontal } = useEditorSettingsStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [copied, setCopied] = useState(false)
  const [isWide, setIsWide] = useState(false)
  const savedPaddingRef = useRef({ vertical: normalPaddingVertical, horizontal: normalPaddingHorizontal })

  // Listen for padding changes from settings panel
  useEffect(() => {
    savedPaddingRef.current = { vertical: normalPaddingVertical, horizontal: normalPaddingHorizontal }
  }, [normalPaddingVertical, normalPaddingHorizontal])

  if (!activeTab) return null

  const { path, viewMode } = activeTab
  const isMarkdown = /\.(md|markdown)$/i.test(path)

  // Get path relative to workspace root directory, starting with /rootDir/
  const getRelativePath = (absolutePath: string): string => {
    if (!rootPath) return absolutePath
    if (absolutePath.startsWith(rootPath)) {
      const rootDirName = rootPath.split('/').pop() || ''
      const relativePart = absolutePath.substring(rootPath.length + 1)
      return `${rootDirName}/${relativePart}`
    }
    return absolutePath
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

    if (isWide) {
      // 恢复到普通模式的内边距
      scrollArea.style.paddingTop = `${savedPaddingRef.current.vertical}px`
      scrollArea.style.paddingBottom = `${savedPaddingRef.current.vertical}px`
      scrollArea.style.paddingLeft = `${savedPaddingRef.current.horizontal}px`
      scrollArea.style.paddingRight = `${savedPaddingRef.current.horizontal}px`
    } else {
      // 保存当前值并切换到宽模式
      savedPaddingRef.current = {
        vertical: parseInt(scrollArea.style.paddingTop) || normalPaddingVertical,
        horizontal: parseInt(scrollArea.style.paddingLeft) || normalPaddingHorizontal
      }
      scrollArea.style.paddingTop = `${widePaddingVertical}px`
      scrollArea.style.paddingBottom = `${widePaddingVertical}px`
      scrollArea.style.paddingLeft = `${widePaddingHorizontal}px`
      scrollArea.style.paddingRight = `${widePaddingHorizontal}px`
    }
    setIsWide(!isWide)
  }

  return (
    <div className="flex items-center justify-between h-[25px] pl-3 pr-1 text-[11px]  bg-[var(--bg-tertiary)]  select-none">
      {/* Left: File path - display relative path from root */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate" title={path}>{getRelativePath(path)}</span>
      </div>

      {/* Right: Icons */}
      <div className="flex items-center shrink-0 ml-4">
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
            <TooltipContent>打开MarkDown目录</TooltipContent>
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
            <TooltipContent>切换源码视图</TooltipContent>
          </Tooltip>
        </>)}
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
          <TooltipContent>打开历史记录</TooltipContent>
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
          <TooltipContent>打开所在文件夹</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopyPath}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ color: copied ? 'var(--theme-color)' : 'var(--text-primary)' }}
            >
              <Copy size={14} style={{ color: 'inherit' }} />
            </button>
          </TooltipTrigger>
          <TooltipContent>复制完整路径</TooltipContent>
        </Tooltip>
        {isMarkdown && (
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
            <TooltipContent>切换编辑器视图宽度</TooltipContent>
          </Tooltip>
        )}
        {isMarkdown && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setRightPanelType(rightPanelType === 'editorSettings' ? null : 'editorSettings')}
                className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ color: rightPanelType === 'editorSettings' ? 'var(--theme-color)' : 'var(--text-primary)' }}
              >
                <Settings size={14} style={{ color: 'inherit' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>内容排版设置</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export { EditorToolbar }