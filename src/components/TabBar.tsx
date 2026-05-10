/**
 * TabBar Component - Editor tabs management
 * Shows file tabs with dirty/saved status indicators
 */
import { X, FileText } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { cn } from '@/lib/utils'

function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useEditorStore()

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    removeTab(tabId)
  }

  if (tabs.length === 0) {
    return (
      <div className="h-9 flex items-center border-b border-[var(--border-color)] bg-[var(--tab-bg)]">
        <span className="px-4 text-sm text-[var(--text-muted)]">No file open</span>
      </div>
    )
  }

  return (
    <div className="h-9 flex items-center border-b border-border bg-[var(--tab-bg)] overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center h-full px-3 cursor-pointer select-none",
              "text-sm border-r border-[var(--tab-border)] min-w-0 shrink-0",
              "transition-colors duration-75",
              isActive
                ? "bg-[var(--tab-active-bg)] text-[var(--text-primary)] shadow-[inset_0_-1px_0_var(--tab-activeBorderTop)]"
                : "bg-transparent text-[var(--text-muted)] hover:bg-[var(--tab-hover-bg)] hover:text-[var(--text-secondary)]"
            )}
          >
            {/* Status dot */}
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full mr-1.5 shrink-0",
                tab.isDirty
                  ? "bg-[#f97316]"
                  : "bg-[#22c55e]"
              )}
            />

            {/* File icon + name */}
            <FileText size={14} className="shrink-0 mr-1" />
            <span className="truncate max-w-[120px]">{tab.name}</span>

            {/* Close button */}
            <button
              onClick={(e) => handleTabClose(e, tab.id)}
              className={cn(
                "ml-2 h-4 w-4 flex items-center justify-center rounded-sm shrink-0",
                "opacity-0 group-hover:opacity-100",
                "hover:bg-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export { TabBar }
