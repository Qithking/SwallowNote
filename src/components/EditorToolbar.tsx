/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Copy } from 'lucide-react'
import { useState } from 'react'
import { useEditorStore, useUIStore } from '@/stores'
import { invoke } from '@tauri-apps/api/core'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

function EditorToolbar() {
  const { tabs, activeTabId, toggleViewMode } = useEditorStore()
  const { rightPanelType, setRightPanelType } = useUIStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [copied, setCopied] = useState(false)

  if (!activeTab) return null

  const { path, viewMode } = activeTab

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
    <div className="flex items-center justify-between h-[22px] p-3 text-[11px]  bg-[var(--bg-tertiary)] text-[var(--text-muted)] select-none">
      {/* Left: File path */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate">{path}</span>
      </div>

      {/* Right: Icons */}
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setRightPanelType(rightPanelType === 'directory' ? null : 'directory')}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ color: rightPanelType === 'directory' ? 'var(--theme-color)' : 'var(--text-muted)' }}
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
              style={{ color: viewMode === 'source' ? 'var(--theme-color)' : 'var(--text-muted)' }}
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
              style={{ color: rightPanelType === 'history' ? 'var(--theme-color)' : 'var(--text-muted)' }}
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
              style={{ color: 'var(--text-muted)' }}
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
              style={{ color: copied ? 'var(--theme-color)' : 'var(--text-muted)' }}
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
