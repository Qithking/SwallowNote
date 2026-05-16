/**
 * HistoryView Component - File history panel
 */
import { History, FileText } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { ScrollArea } from '@/components/ui/scroll-area'

interface HistoryItem {
  id: string
  timestamp: string
  description: string
}

function HistoryView() {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  // TODO: 实现实际的文件历史功能
  const mockHistory: HistoryItem[] = [
    { id: '1', timestamp: '10:30', description: '保存' },
    { id: '2', timestamp: '10:15', description: '修改内容' },
    { id: '3', timestamp: '09:00', description: '打开文件' },
  ]

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <History size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>历史</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-sm">未打开文件</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-10 px-3 shrink-0 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <History size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>历史</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2">
        <ul className="space-y-1">
          {mockHistory.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-hover)]"
            >
              <FileText size={12} className="text-[var(--text-muted)]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                  {item.description}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {item.timestamp}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

export { HistoryView }