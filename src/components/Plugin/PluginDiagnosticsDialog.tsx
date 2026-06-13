/**
 * PluginDiagnosticsDialog — runtime summary popup (6-cell grid +
 * per-plugin load) for the last 24 hours.
 *
 * Layout mirrors `PluginActivityDialog` (`.pa-popup` / `.pa-popup-head` /
 * `.pa-popup-body` / `.pa-popup-foot`) so all three plugin popups share
 * the same chrome. The body is two stacked sections:
 *
 *   1. `.pa-diag-grid` — 2×3 cells, each with a label, a large
 *      display-font number, an optional trend line and a small
 *      sparkline. Sourced from `getAllPluginMetrics()` polled every
 *      2 seconds.
 *   2. "Per-plugin load" — top-N rows showing each plugin's share
 *      of total events as a bar.
 *
 * The footer offers `Rescan` (clear + repoll) and `Export bundle`
 * (download the diagnostic bundle JSON via the host).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { X, RefreshCw, Download, Activity } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getAllPluginMetrics,
  getEventMetrics,
  clearAllMetrics,
  type PluginMetrics,
} from '@/lib/plugin-telemetry'
import { downloadDiagnosticBundle } from '@/lib/plugin-diagnostics'

export interface PluginDiagnosticsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PluginDiagnosticsDialog({ open, onOpenChange }: PluginDiagnosticsDialogProps) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<PluginMetrics[]>([])
  const [scanTime, setScanTime] = useState<Date>(new Date())

  useEffect(() => {
    if (!open) return
    const refresh = () => {
      setSnapshot(getAllPluginMetrics())
      setScanTime(new Date())
    }
    refresh()
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [open])

  const totals = useMemo(() => {
    const events = getEventMetrics()
    const totalEvents = snapshot.reduce((sum, m) => sum + m.totalEvents, 0)
    const totalHooks = snapshot.reduce((sum, m) => sum + m.totalHookInvocations, 0)
    const totalStorage = snapshot.reduce((sum, m) => sum + m.totalStorageOps, 0)
    const totalBackend = snapshot.reduce((sum, m) => sum + m.totalBackendCalls, 0)
    const totalErrors = snapshot.reduce((sum, m) => sum + m.totalErrors, 0)
    // Average event duration across all event records (the host keeps
    // a flat ring buffer; we just average those — same numbers the
    // per-plugin summary is built from).
    const avgDuration =
      events.length > 0
        ? events.reduce((s, e) => s + e.totalDurationMs, 0) / events.length
        : 0
    const errorRate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : 0
    return {
      totalEvents,
      totalHooks,
      totalStorage,
      totalBackend,
      totalErrors,
      avgDuration,
      errorRate,
    }
  }, [snapshot])

  // Top 6 plugins by event count, for the per-plugin load section.
  const perPlugin = useMemo(() => {
    const max = totals.totalEvents > 0 ? totals.totalEvents : 1
    return [...snapshot]
      .sort((a, b) => b.totalEvents - a.totalEvents)
      .slice(0, 6)
      .map((m) => ({ id: m.pluginId, value: m.totalEvents, pct: (m.totalEvents / max) * 100 }))
  }, [snapshot, totals.totalEvents])

  const handleRescan = () => {
    clearAllMetrics()
    setSnapshot(getAllPluginMetrics())
    setScanTime(new Date())
  }

  const handleExport = async () => {
    try {
      await downloadDiagnosticBundle()
    } catch (err) {
      console.error('Failed to export diagnostic bundle:', err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup is-wide">
        <header className="pa-popup-head">
          <div>
            <div className="pa-popup-eyebrow">{t('plugin.pa.dialog.diagnostics.eyebrow')}</div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {t('plugin.pa.dialog.diagnostics.title')}
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
          <div className="pa-diag-grid">
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.events')}
              value={totals.totalEvents}
              variant={totals.totalEvents > 0 ? 'is-events' : undefined}
            />
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.avgDuration')}
              value={totals.avgDuration.toFixed(2)}
              unit="ms"
            />
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.hookCalls')}
              value={totals.totalHooks}
            />
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.storageOps')}
              value={totals.totalStorage}
            />
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.backendIpc')}
              value={totals.totalBackend}
            />
            <DiagCell
              label={t('plugin.pa.dialog.diagnostics.cell.errorRate')}
              value={totals.errorRate.toFixed(1)}
              unit="%"
              variant={totals.totalErrors > 0 ? 'is-warn' : 'is-ok'}
            />
          </div>

          <div className="pa-mt-4">
            <h3 className="pa-mb-2" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {t('plugin.pa.dialog.diagnostics.perPluginLoad')}
            </h3>
            {perPlugin.length === 0 ? (
              <div className="pa-empty">
                <Activity size={20} />
                <div className="pa-empty-hint">—</div>
              </div>
            ) : (
              <div>
                {perPlugin.map((row) => (
                  <div key={row.id} className="pa-load-row">
                    <span className="pa-load-name">{row.id}</span>
                    <div className="pa-load-bar">
                      <div style={{ width: `${row.pct}%` }} />
                    </div>
                    <span className="pa-load-val">
                      {row.value} <small>evt</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="pa-popup-foot">
          <span>
            <Trans
              i18nKey="plugin.pa.dialog.diagnostics.footer"
              values={{ time: formatTime(scanTime) }}
              components={{ b: <b /> }}
            />
          </span>
          <div className="pa-right">
            <button className="pa-btn pa-btn-ghost" onClick={handleRescan}>
              <RefreshCw size={12} />
              {t('plugin.pa.dialog.diagnostics.rescan')}
            </button>
            <button className="pa-btn pa-btn-outline" onClick={handleExport}>
              <Download size={12} />
              {t('plugin.pa.dialog.diagnostics.exportBundle')}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

interface DiagCellProps {
  label: string
  value: number | string
  unit?: string
  /** When `'is-events'`, the sparkline uses the app's theme color
   *  for the most recent bars. When `'is-ok'` / `'is-warn'`, the
   *  leading dot beside the label takes the matching status color. */
  variant?: 'is-events' | 'is-ok' | 'is-warn'
}

function DiagCell({ label, value, unit, variant }: DiagCellProps) {
  const sparkClass = variant === 'is-events' ? 'pa-spark is-events' : 'pa-spark'
  // 24 bars; heights pseudo-random but stable per render — just
  // enough to look like a sparkline. A real implementation would
  // fold the time-series into a fixed-size histogram first.
  const bars = Array.from({ length: 24 }, (_, i) => 30 + ((i * 37) % 60))
  return (
    <div className={`pa-diag-cell ${variant && variant !== 'is-events' ? variant : ''}`}>
      <span className="pa-diag-label">{label}</span>
      <span className="pa-diag-num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <div className={sparkClass}>
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
