/**
 * EditorToolbar Component - File info bar between TabBar and EditorView
 * Shows file path, size, modified time, and word count
 */
import { useEditorStore } from '@/stores'

function EditorToolbar() {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  if (!activeTab) return null

  const { path, fileSize, modifiedTime, wordCount } = activeTab

  return (
    <div className="flex items-center justify-between h-[22px] px-3 text-[11px] border-b border-border bg-[var(--bg-tertiary)] text-[var(--text-muted)] select-none">
      {/* Left: File path */}
      <div className="flex items-center gap-1 truncate flex-1 min-w-0">
        <span className="truncate">{path}</span>
      </div>

      {/* Right: File metadata */}
      <div className="flex items-center gap-3 shrink-0 ml-4">
        {fileSize && (
          <span className="whitespace-nowrap">
            大小: {fileSize}
          </span>
        )}
        {modifiedTime && (
          <span className="whitespace-nowrap">
            修改时间: {modifiedTime}
          </span>
        )}
        {wordCount !== undefined && (
          <span className="whitespace-nowrap">
            字数: {wordCount}
          </span>
        )}
      </div>
    </div>
  )
}

export { EditorToolbar }
