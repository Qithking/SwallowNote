/**
 * LogViewer — 独立日志查看器
 *
 * Source: spec/unified-logging AC-9
 * 展示前端 + 后端 + 插件三端合并日志，支持级别过滤、来源过滤、搜索、复制、导出 .jsonl
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { logStore, type LogEntry, type LogLevel } from '@/lib/logger'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { Search, Copy, Download, Trash2 } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

export type { LogEntry, LogLevel }

/** 所有日志级别，按严重程度递增 */
const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

/** 级别 → CSS 颜色变量 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'var(--text-muted)',
  debug: 'var(--text-secondary)',
  info: 'var(--text-primary)',
  warn: 'var(--text-warning, #e6a700)',
  error: 'var(--text-error, #dc2626)',
}

/** 过滤条件 */
export interface FilterOptions {
  levels: Set<LogLevel>
  source: string
  search: string
}

/**
 * 过滤日志条目（纯函数，便于测试）
 *
 * 按级别集合 + 来源 + 搜索文本过滤。搜索大小写不敏感，匹配 message 或 source。
 */
export function filterLogEntries(entries: LogEntry[], opts: FilterOptions): LogEntry[] {
  const { levels, source, search } = opts
  const lowerSearch = search.toLowerCase()
  const lowerSource = source.toLowerCase()
  return entries.filter((e) => {
    if (!levels.has(e.level)) return false
    if (lowerSource && !e.source.toLowerCase().includes(lowerSource)) return false
    if (lowerSearch) {
      const inMsg = e.message.toLowerCase().includes(lowerSearch)
      const inSrc = e.source.toLowerCase().includes(lowerSearch)
      if (!inMsg && !inSrc) return false
    }
    return true
  })
}

/** 格式化时间戳为 HH:MM:SS.mmm */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export interface LogViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<LogEntry[]>(() => logStore.getAll())
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(ALL_LEVELS))
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)

  // 订阅 logStore，新日志追加到列表
  useEffect(() => {
    if (!open) return
    setEntries(logStore.getAll())
    const unsub = logStore.subscribe((entry) => {
      setEntries((prev) => [...prev, entry])
    })
    return unsub
  }, [open])

  // 自动滚动到底部（用户未手动滚动时）
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  const filtered = useMemo(
    () => filterLogEntries(entries, { levels, source, search }),
    [entries, levels, source, search],
  )

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  const handleCopy = useCallback(async () => {
    const text = filtered.map((e) => `[${formatTime(e.timestamp)}] [${e.level}] [${e.source}] ${e.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard 不可用时静默降级
    }
  }, [filtered])

  const handleExport = useCallback(async () => {
    const jsonl = filtered.map((e) => JSON.stringify(e)).join('\n')
    // Tauri v2 webview 不支持 <a download>，用 save dialog + 后端 write_file
    const filePath = await save({
      defaultPath: `logs-${Date.now()}.jsonl`,
      filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
    })
    if (!filePath) return // 用户取消
    try {
      await invoke('write_file', { path: filePath, content: jsonl })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[LogViewer] export failed', e)
    }
  }, [filtered])

  const handleClear = useCallback(() => {
    logStore.clear()
    setEntries([])
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('logViewer.title', '日志查看器')}</DialogTitle>
        </DialogHeader>

        {/* 过滤工具栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* 级别过滤 */}
          <div className="flex items-center gap-1">
            {ALL_LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: levels.has(lvl) ? LEVEL_COLORS[lvl] : 'transparent',
                  color: levels.has(lvl) ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* 来源过滤 */}
          <Input
            placeholder={t('logViewer.filterSource', '来源过滤...')}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            style={{ width: '140px', height: '28px', fontSize: '12px' }}
          />

          {/* 搜索 */}
          <div className="relative flex-1 min-w-[160px]">
            <Search size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <Input
              placeholder={t('logViewer.search', '搜索...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', height: '28px', fontSize: '12px', paddingLeft: '24px' }}
            />
          </div>

          {/* 操作按钮 */}
          <Button variant="ghost" size="sm" onClick={handleCopy} title={t('logViewer.copy', '复制')}>
            <Copy size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} title={t('logViewer.export', '导出 JSONL')}>
            <Download size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear} title={t('logViewer.clear', '清空')}>
            <Trash2 size={14} />
          </Button>
        </div>

        {/* 日志条数 */}
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} / {entries.length} {t('logViewer.entries', '条')}
        </div>

        {/* 日志列表 */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: '1.5',
            background: 'var(--bg-secondary)',
            borderRadius: '4px',
            padding: '8px',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              {t('logViewer.empty', '暂无日志')}
            </div>
          ) : (
            filtered.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', padding: '1px 0' }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{formatTime(e.timestamp)}</span>
                <span style={{ color: LEVEL_COLORS[e.level], flexShrink: 0, width: '48px' }}>{e.level}</span>
                <span style={{ color: 'var(--text-secondary)', flexShrink: 0, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.source}</span>
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{e.message}</span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
