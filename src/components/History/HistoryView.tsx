import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { gitFileLog, GitFileLogEntry } from '@/lib/tauri'
import { ScrollArea } from '@/components/ui/scroll-area'

const PAGE_SIZE = 50

function HistoryView() {
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
    if (activeTab?.path) {
      setEntries([])
      setHasMore(true)
      setNotInRepo(false)
      skipRef.current = 0
      loadHistory(activeTab.path, 0)
    }
  }, [activeTab?.path, loadHistory])

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
      const date = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))

      if (days === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      } else if (days === 1) {
        return '昨天'
      } else if (days < 7) {
        return `${days}天前`
      } else {
        return date.toLocaleDateString('zh-CN')
      }
    } catch {
      return dateStr
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
                    className="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-hover)]"
                  >
                    <FileText size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                        {entry.message}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(entry.date)}
                        </p>
                        <div className="flex items-center gap-1 text-xs">
                          <span style={{ color: 'var(--text-green)' }}>+{entry.insertions}</span>
                          <span style={{ color: 'var(--text-red)' }}>-{entry.deletions}</span>
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
