/**
 * PluginLogsDialog — "tail -f" style live log stream for plugin events.
 *
 * Pulls from the four ring buffers the host keeps in `plugin-telemetry`
 * (event / storage / hook / backend) and renders them newest-first as
 * monospace log lines. The dialog polls `getRecentLogLines(100)` every
 * 1.5 seconds while open and clears its interval on close so the host
 * doesn't keep paying for a 4-array merge the user can't see.
 *
 * The shell mirrors the other two plugin popups (`.pa-popup` /
 * `.pa-popup-head` / `.pa-popup-body` / `.pa-popup-foot`) so the three
 * dialogs read as siblings. The body uses the existing
 * `.pa-log-stream` / `.pa-log-line` / `.pa-log-time` / `.pa-log-lvl`
 * / `.pa-log-msg` classes — those tokens inherit the application theme
 * via the `--pa-*` aliases in `index.css`, so light / dark / system all
 * come along for free.
 */
import { useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { X, Filter, Copy, ScrollText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getRecentLogLines,
  type FormattedLogLine,
} from '@/lib/plugin-telemetry'
import { toast } from 'sonner'

export interface PluginLogsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PluginLogsDialog({ open, onOpenChange }: PluginLogsDialogProps) {
  const { t } = useTranslation()
  const [lines, setLines] = useState<FormattedLogLine[]>([])

  useEffect(() => {
    if (!open) return
    const refresh = () => setLines(getRecentLogLines(100))
    refresh()
    const interval = setInterval(refresh, 1500)
    return () => clearInterval(interval)
  }, [open])

  const handleCopy = async () => {
    // We copy the raw log text rather than the diagnostic bundle —
    // the bundle is the full JSON snapshot (events + storage + hooks
    // + IPC + crashes + audit log), and the user asked for the
    // log stream specifically. A plain-text copy is also easier
    // to paste into a bug report.
    if (lines.length === 0) {
      toast.info('No log lines to copy')
      return
    }
    const text = lines
      .map((l) => `${l.time}  ${l.level.toUpperCase().padEnd(4)}  ${l.plugin}  ${l.message}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Logs copied to clipboard')
    } catch (err) {
      console.error('Failed to copy logs:', err)
      toast.error('Failed to copy logs')
    }
  }

  const handleFilter = () => {
    // Placeholder for a future filter popover. We deliberately
    // do not gate the feature on a UI affordance that doesn't
    // exist yet — the i18n key is present so the button label
    // is translated, and a future PR can wire the popover in
    // without touching this component.
    toast.info('Filter coming soon')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup is-wide">
        <header className="pa-popup-head">
          <div>
            <div className="pa-popup-eyebrow">{t('plugin.pa.dialog.logs.eyebrow')}</div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {t('plugin.pa.dialog.logs.title')}
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
          {lines.length === 0 ? (
            <div className="pa-empty">
              <ScrollText size={20} />
              <div className="pa-empty-title">—</div>
              <div className="pa-empty-hint">No log lines yet</div>
            </div>
          ) : (
            <div className="pa-log-stream">
              {lines.map((line, i) => (
                <div className="pa-log-line" key={`${line.timestamp}-${i}`}>
                  <span className="pa-log-time">{line.time}</span>
                  <span className={`pa-log-lvl is-${line.level}`}>
                    {line.level.toUpperCase()}
                  </span>
                  <span className="pa-log-msg">
                    <b>{line.plugin}</b> · {line.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="pa-popup-foot">
          <span>
            <Trans
              i18nKey="plugin.pa.dialog.logs.footer"
              values={{ count: lines.length }}
              components={{ b: <b /> }}
            />
          </span>
          <div className="pa-right">
            <button className="pa-btn pa-btn-ghost" onClick={handleFilter}>
              <Filter size={12} />
              {t('plugin.pa.dialog.logs.filter')}
            </button>
            <button className="pa-btn pa-btn-outline" onClick={handleCopy}>
              <Copy size={12} />
              {t('plugin.pa.dialog.logs.copy')}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
