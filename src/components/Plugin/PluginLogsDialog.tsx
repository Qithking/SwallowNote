/**
 * PluginLogsDialog — "tail -f" style live log stream for plugin events.
 *
 * Pulls from the four ring buffers the host keeps in `plugin-telemetry`
 * (event / storage / hook / backend) and renders them newest-first as
 * monospace log lines. The dialog polls `getRecentLogLines(100)` every
 * 1.5 seconds while open and clears its interval on close so the host
 * doesn't keep paying for a 4-array merge the user can't see.
 *
 * Task 8 (G8) extends the original dialog with three actions in the
 * footer:
 *
 *   - **Plugin filter** — a `<select>` that narrows the visible
 *     stream to a single plugin id, or "all". The filter is honoured
 *     by the *Copy* and *Export* actions, so a user can scope the
 *     output to one plugin's activity without the rest of the host's
 *     noise.
 *   - **Copy** — copies the (filtered, currently visible) lines to
 *     the clipboard as plain text. The text format is unchanged from
 *     before; the only difference is that the lines we copy are now
 *     the post-filter set, not the raw snapshot.
 *   - **Export** — saves the same lines to a `.jsonl` file via
 *     Tauri `save` dialog + `writeFile`. The jsonl payload is
 *     produced by `exportLogs(pluginId)` in `plugin-telemetry`,
 *     which returns a `LogExportResult` with both the text and the
 *     record count we echo in the success toast.
 *
 * The shell mirrors the other two plugin popups (`.pa-popup` /
 * `.pa-popup-head` / `.pa-popup-body` / `.pa-popup-foot`) so the three
 * dialogs read as siblings. The body uses the existing
 * `.pa-log-stream` / `.pa-log-line` / `.pa-log-time` / `.pa-log-lvl`
 * / `.pa-log-msg` classes — those tokens inherit the application theme
 * via the `--pa-*` aliases in `index.css`, so light / dark / system all
 * come along for free.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { X, Filter, Copy, ScrollText, Download } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getRecentLogLines,
  exportLogs,
  type FormattedLogLine,
} from '@/lib/plugin-telemetry'
import { writeFile } from '@/lib/tauri'
import { usePluginStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'

export interface PluginLogsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Sentinel "no filter" value for the plugin dropdown. The string
 *  is encoded as `'__all__'` so it can never collide with a real
 *  plugin id (the host's id policy requires the `com.x.y` shape). */
const FILTER_ALL = '__all__'

/** Maximum number of log lines the dialog keeps in its in-memory
 *  snapshot, polled every 1.5s by the `useEffect` below. This is
 *  the same value passed to `getRecentLogLines()` and to
 *  `exportLogs({ limit, order: 'desc' })`, so Copy and Export
 *  always operate on a single, well-defined line set — the user
 *  can take the success toast's "N lines" at face value. */
const LOG_LIMIT = 100

/** Build a sensible default filename for the save dialog. We
 *  stamp the current local time so consecutive exports don't
 *  overwrite each other. The chosen extension is `.jsonl` to
 *  match the `exportLogs` payload format. */
function buildDefaultFilename(pluginId: string | null): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const scope = pluginId ? pluginId.replace(/[^a-zA-Z0-9._-]/g, '_') : 'all'
  return `plugin-logs-${scope}-${stamp}.jsonl`
}

/** Render a single `FormattedLogLine` as the four-column row
 *  the popup has always shown (time / level / plugin / message).
 *  Pulled out of the JSX so the conflict and "normal" groups
 *  share the same layout — divergence here would mean a
 *  conflict line reads visually different from an info line,
 *  which would defeat the "side-by-side" grouping. */
function renderLine(line: FormattedLogLine, key: string) {
  return (
    <div className="pa-log-line" key={key} data-log-group={line.group ?? 'normal'}>
      <span className="pa-log-time">{line.time}</span>
      <span className={`pa-log-lvl is-${line.level}`}>
        {line.level.toUpperCase()}
      </span>
      <span className="pa-log-msg">
        <b>{line.plugin}</b> · {line.message}
      </span>
    </div>
  )
}

export function PluginLogsDialog({ open, onOpenChange }: PluginLogsDialogProps) {
  const { t } = useTranslation()
  const [lines, setLines] = useState<FormattedLogLine[]>([])
  // Filter selection. We keep the filter as a string id (or
  // `FILTER_ALL` for the unfiltered view) rather than a `string |
  // null` so it serialises cleanly through the Radix `<Select>`
  // value prop. The `useEffect` below resets the filter to
  // `FILTER_ALL` whenever the dialog re-opens so a user coming
  // back from a previous session doesn't see a stale "X only"
  // chip from a plugin that's been uninstalled.
  const [filter, setFilter] = useState<string>(FILTER_ALL)
  // Subset of `lines` that pass the active filter. The filter
  // is applied here (and not inside `getRecentLogLines`) because
  // the popup pulls a 100-line snapshot every 1.5s, and we want
  // the filter to react instantly to a selection change without
  // waiting for the next poll. `useMemo` keeps the cost
  // negligible: 100-line slice, O(N) filter.
  const filteredLines = useMemo<FormattedLogLine[]>(() => {
    if (filter === FILTER_ALL) return lines
    return lines.filter((l) => l.plugin === filter)
  }, [lines, filter])

  // Task 13 / G13: split the filtered stream into "conflict"
  // and "normal" sub-lists so the popup can render a dedicated
  // "⚠️ Conflict" header above the collision lines. We keep
  // the original timestamp ordering on each side (the conflict
  // scan re-emits a synthetic `plugin.conflict` hook metric
  // per collision, so the conflict set is itself a small,
  // chronologically-sorted tail). `conflictLines` excludes
  // anything that doesn't pass the active filter, so when a
  // user picks a specific plugin in the dropdown, both groups
  // narrow to that plugin's slice.
  const conflictLines = useMemo(
    () => filteredLines.filter((l) => l.group === 'conflict'),
    [filteredLines],
  )
  const normalLines = useMemo(
    () => filteredLines.filter((l) => l.group !== 'conflict'),
    [filteredLines],
  )

  // Plugin registry for the filter dropdown. We only care about
  // the id + name (and we want to filter out plugins that the
  // user has uninstalled while the dialog was open). Sorting by
  // name keeps the dropdown stable across re-renders.
  const plugins = usePluginStore(useShallow((s) => s.plugins))
  const pluginOptions = useMemo(() => {
    return [...plugins]
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [plugins])

  useEffect(() => {
    if (!open) return
    // Reset the filter to "all" on open so the user starts from
    // a known state. The cost is a single render of the
    // dropdown; the underlying ring buffers are unaffected.
    setFilter(FILTER_ALL)
    const refresh = () => setLines(getRecentLogLines(LOG_LIMIT))
    refresh()
    const interval = setInterval(refresh, 1500)
    return () => clearInterval(interval)
  }, [open])

  const handleCopy = async () => {
    // We copy the (filtered) log text rather than the diagnostic
    // bundle — the bundle is the full JSON snapshot (events +
    // storage + hooks + IPC + crashes + audit log), and the user
    // asked for the log stream specifically. A plain-text copy is
    // also easier to paste into a bug report.
    //
    // The set of lines is the most recent `LOG_LIMIT` records
    // (from `getRecentLogLines(LOG_LIMIT)` above) intersected
    // with the active plugin filter — the same slice that
    // `handleExport` will persist to disk. Keeping the two
    // paths in lockstep is the whole point of the
    // `ExportLogsOptions` knobs we added to `exportLogs`.
    if (filteredLines.length === 0) {
      toast.info(t('plugin.pa.dialog.logs.toast.copyEmpty'))
      return
    }
    const text = filteredLines
      .map((l) => `${l.time}  ${l.level.toUpperCase().padEnd(4)}  ${l.plugin}  ${l.message}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('plugin.pa.dialog.logs.toast.copySuccess'))
    } catch (err) {
      console.error('Failed to copy logs:', err)
      toast.error(t('plugin.pa.dialog.logs.toast.copyFailed'))
    }
  }

  const handleExport = async () => {
    // The export honours the active filter so a user can save
    // *just* the events for one plugin, and it caps the output
    // at the same `LOG_LIMIT` lines the dialog is currently
    // displaying (newest first). This is the fix for the C3
    // critical bug from review round 4: the previous code passed
    // the full ring buffer to `exportLogs`, so a user copying
    // 8 visible lines could be told "Exported 200 log lines",
    // which doesn't line up with the dialog at all. The new
    // `{ limit, order: 'desc' }` options bring Export's output
    // back into a 1:1 correspondence with the visible stream.
    const pluginId = filter === FILTER_ALL ? undefined : filter
    const { text, recordCount } = exportLogs(pluginId, 'jsonl', {
      limit: LOG_LIMIT,
      order: 'desc',
    })
    if (recordCount === 0) {
      toast.info(t('plugin.pa.dialog.logs.toast.exportEmpty'))
      return
    }
    let target: string | null = null
    try {
      // Tauri's `save` dialog returns the absolute file path the
      // user picked, or `null` if they cancelled. We pass
      // `.jsonl` as the default extension so the OS filter list
      // shows "JSON Lines (*.jsonl)" and the suggested filename
      // already carries the suffix.
      target = await save({
        defaultPath: buildDefaultFilename(pluginId ?? null),
        filters: [
          { name: 'JSON Lines', extensions: ['jsonl'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
    } catch (err) {
      console.error('Failed to open save dialog:', err)
      toast.error(t('plugin.pa.dialog.logs.toast.exportOpenFailed'), { description: String(err) })
      return
    }
    if (!target) return // user cancelled
    try {
      // `writeFile` is the host's wrapper around the Rust
      // `write_file` command; it writes UTF-8 text. jsonl is
      // UTF-8 by spec, and `JSON.stringify` never emits
      // non-UTF-8 bytes, so this is a 1:1 drop-in.
      await writeFile(target, text)
      // The count mirrors what the user just saw in the
      // dialog (and what `handleCopy` would have placed on
      // the clipboard). The `newest first` suffix makes the
      // ordering explicit so anyone opening the file in a
      // text editor isn't surprised that line 1 is the most
      // recent event.
      toast.success(
        t('plugin.pa.dialog.logs.toast.exportSuccess', { count: recordCount }),
        { description: target },
      )
    } catch (err) {
      console.error('Failed to write log file:', err)
      toast.error(t('plugin.pa.dialog.logs.toast.exportWriteFailed'), { description: String(err) })
    }
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
          ) : filteredLines.length === 0 ? (
            <div className="pa-empty">
              <ScrollText size={20} />
              <div className="pa-empty-title">—</div>
              <div className="pa-empty-hint">No log lines match the active filter</div>
            </div>
          ) : (
            <div className="pa-log-stream">
              {/* Task 13 / G13: render the "⚠️ Conflict" group
                first so the user sees the most actionable
                findings at the top of the stream. The header
                collapses out when the active filter is in
                effect and the filter excludes every conflict
                line (e.g. the user picked a plugin that has
                no conflict of its own). */}
              {conflictLines.length > 0 && (
                <>
                  <div className="pa-log-group" data-log-group="conflict">
                    <span>{t('plugin.pa.dialog.logs.conflictGroup', { defaultValue: '⚠️ Conflict' })}</span>
                    <span className="pa-log-group-count">{conflictLines.length}</span>
                  </div>
                  {conflictLines.map((line, i) => renderLine(line, `c-${i}`))}
                </>
              )}
              {normalLines.length > 0 && (
                <>
                  {conflictLines.length > 0 && (
                    <div className="pa-log-group" data-log-group="normal">
                      <span>{t('plugin.pa.dialog.logs.normalGroup', { defaultValue: 'Activity' })}</span>
                      <span className="pa-log-group-count">{normalLines.length}</span>
                    </div>
                  )}
                  {normalLines.map((line, i) => renderLine(line, `n-${i}`))}
                </>
              )}
            </div>
          )}
        </div>

        <footer className="pa-popup-foot">
          <span>
            <Trans
              i18nKey="plugin.pa.dialog.logs.footer"
              values={{ count: filteredLines.length }}
              components={{ b: <b /> }}
            />
          </span>
          <div className="pa-logs-actions">
            {/* Plugin filter (Task 8 / G8). A native-feeling
                Radix `<select>` rather than a custom popover so
                the keyboard interaction (arrow keys, type-to-
                search) matches the rest of the app. The
                `FILTER_ALL` sentinel round-trips through Radix
                cleanly because we never serialise the value to
                disk. We disable the trigger when there are no
                plugins — the empty dropdown would be
                misleading. */}
            <div className="pa-logs-filter">
              <Filter size={12} aria-hidden="true" />
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v)}
                disabled={pluginOptions.length === 0}
              >
                <SelectTrigger
                  className="pa-logs-filter-trigger"
                  aria-label={t('plugin.pa.dialog.logs.filter')}
                >
                  <SelectValue placeholder={t('plugin.pa.dialog.logs.filterAll', { defaultValue: 'All plugins' })} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>
                    {t('plugin.pa.dialog.logs.filterAll', { defaultValue: 'All plugins' })}
                  </SelectItem>
                  {pluginOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              className="pa-btn pa-btn-outline"
              onClick={handleCopy}
              disabled={filteredLines.length === 0}
            >
              <Copy size={12} />
              {t('plugin.pa.dialog.logs.copy')}
            </button>
            <button
              className="pa-btn pa-btn-outline"
              onClick={() => void handleExport()}
              disabled={filteredLines.length === 0}
              title={t('plugin.pa.dialog.logs.exportTitle', { defaultValue: 'Export as JSON Lines (.jsonl)' })}
            >
              <Download size={12} />
              {t('plugin.pa.dialog.logs.export', { defaultValue: 'Export' })}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
