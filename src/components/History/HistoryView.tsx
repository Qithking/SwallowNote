import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { gitFileLog, GitFileLogEntry } from '@/lib/tauri'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const PAGE_SIZE = 50

function HistoryView({ visible }: { visible: boolean }) {
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const [entries, setEntries] = useState<GitFileLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [notInRepo, setNotInRepo] = useState(false)
  const skipRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async (filePath: string, skip: number = 0) => {
    if (skip === 0) {
      setLoading(true)
      setNotInRepo(false)
    }

    try {
      const result = await gitFileLog(filePath, PAGE_SIZE, skip)
      console.log('gitFileLog result:', result)
      if (result.length < PAGE_SIZE) {
        setHasMore(false)
      } else {
        setHasMore(true)
      }

      if (skip === 0) {
        setEntries(result)
      } else {
        setEntries((prev) => [...prev, ...result])
      }
      skipRef.current = skip + result.length
    } catch (e: any) {
      console.error('gitFileLog error:', e)
      if (e === 'NOT_IN_GIT_REPO' || (e && e.includes && e.includes('NOT_IN_GIT_REPO'))) {
        setNotInRepo(true)
        setEntries([])
      }
      if (skip === 0) {
        setEntries([])
      }
    } finally {
      if (skip === 0) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (visible && activeTab?.path) {
      setEntries([])
      setHasMore(true)
      setNotInRepo(false)
      skipRef.current = 0
      loadHistory(activeTab.path, 0)
    }
  }, [visible, activeTab?.path, loadHistory])

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100

      if (isNearBottom && hasMore && !loading && activeTab?.path) {
        loadHistory(activeTab.path, skipRef.current)
      }
    },
    [hasMore, loading, activeTab?.path, loadHistory]
  )

  const formatDate = (dateStr: string) => {
    try {
      // Handle unix timestamp (milliseconds) from backend
      let date: Date
      if (/^\d+$/.test(dateStr)) {
        date = new Date(parseInt(dateStr, 10))
      } else {
        date = new Date(dateStr)
      }
      
      if (isNaN(date.getTime())) {
        return 'Invalid Date'
      }
      
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      
      return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`
    } catch {
      return 'Invalid Date'
    }
  }

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center h-10 px-3 shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium uppercase tracking-wider">历史</span>
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
      <div className="flex items-center h-10 px-3 shrink-0" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium uppercase tracking-wider">历史</span>
        </div>
      </div>

      {notInRepo ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-xs text-center px-4">请到文件根目录下右键同步初始化</p>
        </div>
      ) : (
        <ScrollArea className="flex-1 p-2" ref={scrollRef} onScroll={handleScroll}>
          {entries.length === 0 && !loading ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              <p className="text-xs">暂无提交历史</p>
            </div>
          ) : (
            <>
              <ul className="space-y-1">
                {entries.map((entry, index) => (
                  <li
                    key={`${entry.hash}-${index}`}
                    className="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-hover)] overflow-hidden"
                  >
                    <FileText size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-sm truncate whitespace-nowrap cursor-default" style={{ color: 'var(--text-secondary)' }}>
                            {entry.message}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">{entry.message}</p>
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(entry.date)}
                        </p>
                        <div className="flex items-center gap-2 text-xs shrink-0">
                          {entry.insertions > 0 && (
                            <span className="text-green-500">+{entry.insertions}</span>
                          )}
                          {entry.deletions > 0 && (
                            <span className="text-red-500">-{entry.deletions}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {loading && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
                </div>
              )}
              {!hasMore && entries.length > 0 && (
                <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                  已加载全部历史记录
                </p>
              )}
            </>
          )}
        </ScrollArea>
      )}
    </div>
  )
}

export { HistoryView }
