/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History, FolderOpen, Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useEditorStore, useUIStore } from '@/stores'
import { invoke } from '@tauri-apps/api/core'

function EditorToolbar() {
  const { tabs, activeTabId, toggleViewMode } = useEditorStore()
  const { rightPanelType, setRightPanelType, aiPanelVisible, toggleAIPanel } = useUIStore()
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
    <div className="flex items-center justify-between h-[22px] px-3 text-[11px] border-b border-border bg-[var(--bg-tertiary)] text-[var(--text-muted)] select-none">
      {/* Left: File path */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate">{path}</span>
      </div>

      {/* Right: Icons */}
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <button
          onClick={() => setRightPanelType(rightPanelType === 'directory' ? null : 'directory')}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: rightPanelType === 'directory' ? 'var(--theme-color)' : 'var(--text-muted)' }}
          title="目录"
        >
          <BookOpen size={14} style={{ color: 'inherit' }} />
        </button>       
        <button
          onClick={toggleViewMode}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: viewMode === 'source' ? 'var(--theme-color)' : 'var(--text-muted)' }}
          title="源码"
        >
          <Code size={14} style={{ color: 'inherit' }} />
        </button>
        <button
          onClick={() => setRightPanelType(rightPanelType === 'history' ? null : 'history')}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: rightPanelType === 'history' ? 'var(--theme-color)' : 'var(--text-muted)' }}
          title="历史"
        >
          <History size={14} style={{ color: 'inherit' }} />
        </button>
         <button
          onClick={handleOpenFolder}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          title="打开所在文件夹"
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={handleCopyPath}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: copied ? 'var(--theme-color)' : 'var(--text-muted)' }}
          title="复制路径"
        >
          <Copy size={14} style={{ color: 'inherit' }} />
        </button>        
      </div>
    </div>
  )
}

export { EditorToolbar }
