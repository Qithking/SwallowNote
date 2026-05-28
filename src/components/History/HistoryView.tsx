import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, Loader2, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { gitFileLog, gitShowFileContent, GitFileLogEntry, writeFile } from '@/lib/tauri'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTranslation } from 'react-i18next'

const PAGE_SIZE = 50

function HistoryView({ visible }: { visible: boolean }) {
  const { tabs, activeTabId, openDiffTab, updateTabContent } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const { t } = useTranslation()

  const [entries, setEntries] = useState<GitFileLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [notInRepo, setNotInRepo] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [restoreEntry, setRestoreEntry] = useState<GitFileLogEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
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
    } catch (e) {
      console.error('gitFileLog error:', e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      if (errorMsg === 'NOT_IN_GIT_REPO' || errorMsg.includes('NOT_IN_GIT_REPO')) {
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

  // Listen for file-saved events to refresh history after save + auto commit
  useEffect(() => {
    const handleFileSaved = (e: Event) => {
      const { path } = (e as CustomEvent).detail
      if (visible && activeTab?.path && path === activeTab.path) {
        setEntries([])
        setHasMore(true)
        setNotInRepo(false)
        skipRef.current = 0
        loadHistory(activeTab.path, 0)
      }
    }
    window.addEventListener('file-saved', handleFileSaved)
    return () => window.removeEventListener('file-saved', handleFileSaved)
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

  const handleRestoreClick = useCallback((e: React.MouseEvent, entry: GitFileLogEntry) => {
    e.stopPropagation()
    setRestoreEntry(entry)
    setShowRestoreDialog(true)
  }, [])

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreEntry || !activeTab?.path) return
    setShowRestoreDialog(false)
    setRestoring(true)

    try {
      const content = await gitShowFileContent(activeTab.path, restoreEntry.hash)
      // Write content to file
      await writeFile(activeTab.path, content)
      // Update the editor tab content
      updateTabContent(activeTab.id, content)
    } catch (e) {
      console.error('Failed to restore file:', e)
    } finally {
      setRestoring(false)
      setRestoreEntry(null)
    }
  }, [restoreEntry, activeTab, updateTabContent])

  const handleRestoreCancel = useCallback(() => {
    setShowRestoreDialog(false)
    setRestoreEntry(null)
  }, [])

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
            <span className="text-xs font-medium uppercase tracking-wider">{t('history.title')}</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-xs">{t('history.noFileOpen')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.restoreConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('history.restoreConfirmDesc', { message: restoreEntry?.message || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRestoreCancel}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreConfirm}>{t('history.restore')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center h-10 px-3 shrink-0" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider">{t('history.title')}</span>
        </div>
      </div>

      {notInRepo ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-xs text-center px-4">{t('history.initGitFirst')}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1 p-2" ref={scrollRef} onScroll={handleScroll}>
          {entries.length === 0 && !loading ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              <p className="text-xs">{t('history.noHistory')}</p>
            </div>
          ) : (
            <>
              <ul className="space-y-1">
                {entries.map((entry, index) => {
                  const isSelected = selectedHash === entry.hash
                  return (
                    <li
                      key={`${entry.hash}-${index}`}
                      className={`flex items-start gap-2 p-2 rounded cursor-pointer overflow-hidden ${isSelected ? 'bg-primary/10 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                      onClick={() => {
                        setSelectedHash(entry.hash)
                        if (activeTab?.path) {
                          openDiffTab(activeTab.path, entry.hash, entry.message)
                        }
                      }}
                    >
                    <FileText size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-xs truncate whitespace-nowrap cursor-default" style={{ color: 'var(--text-secondary)' }}>
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
                        <div className="flex items-center gap-1.5 text-xs shrink-0">
                          {entry.insertions > 0 && (
                            <span className="text-green-500">+{entry.insertions}</span>
                          )}
                          {entry.deletions > 0 && (
                            <span className="text-red-500">-{entry.deletions}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="shrink-0 p-1 rounded hover:bg-[var(--bg-active)] cursor-pointer"
                          style={{ color: 'var(--text-muted)' }}
                          onClick={(e) => handleRestoreClick(e, entry)}
                          disabled={restoring}
                        >
                          {restoring && restoreEntry?.hash === entry.hash ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{t('history.restore')}</TooltipContent>
                    </Tooltip>
                    </li>
                  )
                })}
              </ul>
              {loading && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
                </div>
              )}
              {!hasMore && entries.length > 0 && (
                <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                  {t('history.allLoaded')}
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
