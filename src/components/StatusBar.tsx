/**
 * StatusBar Component - Bottom status bar
 */
import { GitBranch, GitCommit } from 'lucide-react'
import { useEditorStore, useGitStore } from '@/stores'

function StatusBar() {
  const { tabs, activeTabId } = useEditorStore()
  const { currentBranch, hasUncommittedChanges, uncommittedCount } = useGitStore()

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const wordCount = activeTab?.wordCount

  return (
    <div
      className="h-[22px] flex items-center justify-between px-3 text-[12px] shrink-0 select-none"
      style={{ backgroundColor: 'var(--status-bg)', color: 'var(--status-fg)' }}
    >
      {/* Left Section */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 opacity-80 hover:opacity-100 cursor-pointer">
          <GitBranch size={12} />
          {currentBranch || 'master'}
        </span>
        {hasUncommittedChanges && (
          <span className="flex items-center gap-1 opacity-80 hover:opacity-100 cursor-pointer">
            <GitCommit size={12} />
            {uncommittedCount}
          </span>
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3">
        {activeTab?.cursorPosition && (
          <span className="opacity-80">
            Ln {activeTab.cursorPosition.line}, Col {activeTab.cursorPosition.column}
          </span>
        )}
        {wordCount !== undefined && (
          <span className="opacity-80">字数: {wordCount}</span>
        )}
        <span className="opacity-80">UTF-8</span>
        <span className="opacity-80">Markdown</span>
      </div>
    </div>
  )
}

export { StatusBar }
