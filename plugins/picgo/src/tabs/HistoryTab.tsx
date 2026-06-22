/**
 * HistoryTab — table of past uploads with search, copy, insert,
 * and delete actions.
 *
 * Source of truth: `store.get('picgo-history')`. The list is
 * reloaded whenever the parent bumps its `refreshTick` (e.g.
 * after a new upload or a settings change).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { toast } from 'sonner'
import type { AllSettings, UploadResult, LinkFormat } from '../types'
import { loadHistory, removeHistoryEntry, clearHistory } from '../lib/history'
import { resolveSettings, isProviderConfigured } from '../lib/settings'
import { getProviderDisplayName } from '../providers'
import { insertIntoNote } from '../lib/editor-insert'

interface HistoryTabProps extends Pick<PluginPanelProps, 'getAllSettings' | 'store' | 'activeNoteContent'> {
  refreshTick: number
  onAfterChange: () => void
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function HistoryTab({
  getAllSettings,
  store,
  activeNoteContent,
  refreshTick,
  onAfterChange,
}: HistoryTabProps): ReactNode {
  const [items, setItems] = useState<UploadResult[]>([])
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<AllSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadHistory(store), getAllSettings()])
      .then(([list, raw]) => {
        if (cancelled) return
        setItems(list)
        setSettings(resolveSettings(raw))
      })
      .catch((err) => {
        console.warn('[picgo] history reload failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [store, getAllSettings, refreshTick])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...items].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
    if (!q) return sorted
    return sorted.filter(
      (r) =>
        r.filename.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        (r.provider || '').toLowerCase().includes(q)
    )
  }, [items, query])

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL 已复制')
    } catch (err) {
      console.warn('[picgo] clipboard write failed:', err)
      toast.error('复制失败')
    }
  }, [])

  const insertOne = useCallback(
    (entry: UploadResult) => {
      if (!settings) return
      const { text } = insertIntoNote(
        entry,
        settings.linkFormat as LinkFormat,
        activeNoteContent
      )
      toast.success('已生成插入文本', { description: text })
    },
    [settings, activeNoteContent]
  )

  const removeOne = useCallback(
    async (url: string) => {
      if (!settings) return
      try {
        await removeHistoryEntry(store, url, settings.historyRetention)
        setItems((cur) => cur.filter((r) => r.url !== url))
        onAfterChange()
      } catch (err) {
        toast.error(`删除失败：${(err as Error).message}`)
      }
    },
    [store, settings, onAfterChange]
  )

  const clearAll = useCallback(async () => {
    try {
      await clearHistory(store)
      setItems([])
      onAfterChange()
      toast.success('历史已清空')
    } catch (err) {
      toast.error(`清空失败：${(err as Error).message}`)
    }
  }, [store, onAfterChange])

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-hidden">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按文件名/URL 过滤"
          className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={clearAll}
          disabled={items.length === 0}
          className="text-xs rounded border border-[var(--border-color)] px-2 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          清空
        </button>
      </div>

      <div className="flex-1 overflow-auto rounded border border-[var(--border-color)]">
        {loading ? (
          <EmptyState text="加载中…" />
        ) : filtered.length === 0 ? (
          <EmptyState text={items.length === 0 ? '暂无上传记录' : '没有匹配的记录'} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-secondary)] text-xs sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left w-12">缩略</th>
                <th className="px-2 py-1 text-left">文件名</th>
                <th className="px-2 py-1 text-left w-20">图床</th>
                <th className="px-2 py-1 text-left w-28">时间</th>
                <th className="px-2 py-1 text-left w-20">大小</th>
                <th className="px-2 py-1 text-left w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.url} className="border-t border-[var(--border-color)]">
                  <td className="px-2 py-1">
                    <img
                      src={r.url}
                      alt={r.filename}
                      className="w-8 h-8 object-cover rounded border border-[var(--border-color)]"
                      loading="lazy"
                      onError={(e) => {
                        // Broken thumbnail — replace with a placeholder.
                        ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                      }}
                    />
                  </td>
                  <td className="px-2 py-1 max-w-[160px]">
                    <div className="truncate" title={r.filename}>{r.filename}</div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--text-secondary)] truncate block hover:underline"
                      title={r.url}
                    >
                      {r.url}
                    </a>
                  </td>
                  <td className="px-2 py-1 text-xs">{getProviderDisplayName(r.provider)}</td>
                  <td className="px-2 py-1 text-xs">{formatDate(r.uploadedAt)}</td>
                  <td className="px-2 py-1 text-xs">{formatBytes(r.size)}</td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => copyUrl(r.url)}
                        className="text-xs rounded border border-[var(--border-color)] px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        title="复制 URL"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => insertOne(r)}
                        className="text-xs rounded border border-[var(--border-color)] px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        title="生成插入文本"
                      >
                        插入
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOne(r.url)}
                        className="text-xs rounded border border-red-300 text-red-500 px-1.5 py-0.5 hover:bg-red-50"
                        title="从历史中移除（仅本地，不删除远端）"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Provider readiness hint, also used by the Settings tab */}
      {settings && !isProviderConfigured(settings.defaultProvider, settings) && (
        <div className="rounded border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1 text-xs">
          当前默认图床（{getProviderDisplayName(settings.defaultProvider)}）尚未配置完整。
        </div>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }): ReactNode {
  return (
    <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
      {text}
    </div>
  )
}
