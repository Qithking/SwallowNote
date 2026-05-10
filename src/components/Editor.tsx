/**
 * Editor Component - Main editor area
 * Shows the content of the active tab
 */
import { useEditorStore } from '@/stores'

export function EditorView() {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-lg">Welcome to SwallowNote</p>
          <p className="text-sm mt-2">Open a file or create a new one to start editing</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--bg-primary)]">
      <div className="flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
        {activeTab.content}
      </div>
    </div>
  )
}
