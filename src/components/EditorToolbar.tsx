/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Copy } from 'lucide-react'
import { useState } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore } from '@/stores'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

function EditorToolbar() {
  const { tabs, activeTabId, toggleViewMode } = useEditorStore()
  const { rightPanelType, setRightPanelType } = useUIStore()
  const { rootPath } = useWorkspaceStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [copied, setCopied] = useState(false)

  if (!activeTab) return null

  const { path, viewMode } = activeTab
  
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

  return (
    <div className="flex items-center justify-between h-[25px] pl-3 pr-1 text-[11px]  bg-[var(--bg-tertiary)]  select-none">
      {/* Left: File path - display relative path from root */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate" title={path}>{getRelativePath(path)}</span>
      </div>

      {/* Right: Icons */}
      <div className="flex items-center shrink-0 ml-4">
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
          <TooltipContent>目录</TooltipContent>
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
          <TooltipContent>源码</TooltipContent>
        </Tooltip>
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
          <TooltipContent>历史</TooltipContent>
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
          <TooltipContent>复制路径</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export { EditorToolbar }
