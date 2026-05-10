/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, word count, and view toggles
 */
import { BookOpen, Code, History } from 'lucide-react'
import { useEditorStore } from '@/stores'

function EditorToolbar() {
  const { tabs, activeTabId, toggleViewMode } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  if (!activeTab) return null

  const { path, fileSize, modifiedTime, wordCount, viewMode } = activeTab

  return (
    <div className="flex items-center justify-between h-[22px] px-3 text-[11px] border-b border-border bg-[var(--bg-tertiary)] text-[var(--text-muted)] select-none">
      {/* Left: File path */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span className="truncate">{path}</span>
      </div>

      {/* Right: Icons + File metadata */}
      <div className="flex items-center gap-2 shrink-0 ml-4">
        {/* View toggle icons */}
        <button
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          title="目录"
        >
          <BookOpen size={14} />
        </button>
        <button
          onClick={toggleViewMode}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          style={{ color: viewMode === 'source' ? 'var(--theme-color)' : undefined }}
          title="源码"
        >
          <Code size={14} />
        </button>
        <button
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          title="历史"
        >
          <History size={14} />
        </button>
       
      </div>
    </div>
  )
}

export { EditorToolbar }
