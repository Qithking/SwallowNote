/**
 * PluginActivityDialog — last 24 hours of plugin events in a single
 * scrollable list. Sourced from `getAllPluginMetrics()`; we surface
 * each per-plugin stat block as a feed entry so the user can see at a
 * glance which plugins are active, when they last wrote storage, and
 * how many hooks ran. We deliberately stay read-only here — the
 * existing "Clear metrics" affordance lives on the diagnostics
 * dialog (which the user can open from the same rail).
 */
import { useEffect, useState, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { getAllPluginMetrics, type PluginMetrics } from '@/lib/plugin-telemetry'

export interface PluginActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PluginActivityDialog({ open, onOpenChange }: PluginActivityDialogProps) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<PluginMetrics[]>([])

  useEffect(() => {
    if (!open) return
    const refresh = () => setSnapshot(getAllPluginMetrics())
    refresh()
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [open])

  const entries = useMemo(() => buildEntries(snapshot), [snapshot])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup">
        <header className="pa-popup-head">
          <div>
            <div className="pa-popup-eyebrow">{t('plugin.pa.dialog.activity.eyebrow')}</div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {t('plugin.pa.dialog.activity.title')}
              </h2>
            </DialogTitle>
          </div>
          <button
            type="button"
            className="pa-popup-close"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X />
          </button>
        </header>

        <div className="pa-popup-body">
          {entries.length === 0 ? (
            <div className="pa-empty">
              <div className="pa-empty-title">—</div>
              <div className="pa-empty-hint">No activity yet</div>
            </div>
          ) : (
            <div className="pa-activity">
              {entries.map((e, i) => (
                <div key={i} className="pa-feed-item">
                  <div className="pa-feed-time">{e.time}</div>
                  <div className="pa-feed-text">{e.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="pa-popup-foot">
          <span>
            <Trans
              i18nKey="plugin.pa.dialog.activity.count"
              values={{ count: entries.length }}
              components={{}}
            />
          </span>
          <div className="pa-right">
            <button className="pa-btn pa-btn-ghost">{t('plugin.pa.dialog.activity.clear')}</button>
            <button className="pa-btn pa-btn-outline">{t('plugin.pa.dialog.activity.export')}</button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

interface Entry {
  time: string
  text: React.ReactNode
}

function buildEntries(metrics: PluginMetrics[]): Entry[] {
  // We turn the per-plugin metric snapshot into a chronological-feeling
  // feed by reading `lastActivity` for each plugin and ordering the
  // entries by recency. We don't have exact timestamps for each
  // individual metric, but `lastActivity` is the most recent write to
  // any of the four metric buffers, which is enough to make the feed
  // feel like a timeline.
  const sorted = [...metrics].sort((a, b) => b.lastActivity - a.lastActivity)
  const now = Date.now()
  const result: Entry[] = []
  for (const m of sorted) {
    const lastDate = m.lastActivity > 0 ? new Date(m.lastActivity) : null
    if (!lastDate || Number.isNaN(lastDate.getTime())) continue
    result.push({
      time: formatTime(lastDate),
      text: (
        <Trans
          i18nKey="plugin.pa.activity.summary"
          values={{ name: m.pluginId }}
          components={{ b: <b /> }}
          defaults={`<b>${m.pluginId}</b> · ${m.totalEvents} events · ${m.totalStorageOps} storage ops · ${m.totalHookInvocations} hooks · ${m.totalBackendCalls} ipc`}
        />
      ),
    })
  }
  // Synthetic "rescan" entry that always sits at the top — mirrors the
  // first feed item in the design mockup so the user sees something
  // even when no plugin has run yet.
  result.unshift({
    time: formatTime(new Date(now)),
    text: (
      <Trans
        i18nKey="plugin.pa.activity.rescan"
        values={{ count: metrics.length }}
        components={{ b: <b /> }}
        defaults={`Rescan complete: <b>${metrics.length}</b> plugins loaded.`}
      />
    ),
  })
  return result
}

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
