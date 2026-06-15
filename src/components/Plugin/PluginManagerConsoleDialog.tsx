/**
 * PluginManagerConsoleDialog — single popup merging the three
 * legacy plugin popups (Activity / Diagnostics / Logs) into one
 * tabbed view, modeled on the OS task manager.
 *
 * Layout:
 *   ┌─ pa-popup-head ──────────────────────────┐
 *   │ eyebrow + title  (Plugin Manager Console)│
 *   │ pa-segmented (Activity / Diagnostics /   │ ← tab strip
 *   │              Logs)                       │
 *   ├─ pa-popup-body ──────────────────────────┤
 *   │ (active tab's content)                   │
 *   ├─ pa-popup-foot ──────────────────────────┤
 *   │ (active tab's footer actions)            │
 *   └──────────────────────────────────────────┘
 *
 * The dialog is a strict superset of the three legacy popups:
 * each tab's body / footer is a direct port of the corresponding
 * old dialog (Activity / Diagnostics / Logs), so the behaviour
 * is unchanged for users who used the rail buttons before.
 *
 * State management: tabs are mutually exclusive, so the
 * `activeTab` is a single string. Each tab owns its own
 * snapshot state — switching tabs unmounts the inactive tab's
 * body, which drops its in-memory state. The user is unlikely
 * to miss that: legacy popups were also mounted/unmounted
 * independently, and the underlying ring buffers are
 * unaffected.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import {
  Activity as ActivityIcon,
  Filter,
  Copy,
  ScrollText,
  RefreshCw,
  Download,
} from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
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
  getAllPluginMetrics,
  getEventMetrics,
  clearAllMetrics,
  getMetricsVersion,
  subscribeToMetricsVersion,
  getRecentLogLines,
  exportLogs,
  type PluginMetrics,
  type FormattedLogLine,
} from '@/lib/plugin-telemetry'
import { downloadDiagnosticBundle } from '@/lib/plugin-diagnostics'
import { writeFile } from '@/lib/tauri'
import { usePluginStore } from '@/stores'

export interface PluginManagerConsoleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TabKey = 'activity' | 'diagnostics' | 'logs'

/** Polling interval for the activity / log panels while the
 *  dialog is open. Both old popups used independent timers
 *  with slightly different cadences (2s vs 1.5s); 2s is a
 *  safe middle ground that keeps both views responsive
 *  without doubling the work. */
const POLL_INTERVAL_MS = 2000

/** Maximum number of log lines the dialog keeps in its
 *  in-memory snapshot — same value the legacy logs popup
 *  used. */
const LOG_LIMIT = 100

/** Sentinel "no filter" value for the plugin dropdown in the
 *  Logs tab. Encoded as `'__all__'` so it can never collide
 *  with a real plugin id (the host's id policy requires the
 *  `com.x.y` shape). */
const FILTER_ALL = '__all__'

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

export function PluginManagerConsoleDialog({ open, onOpenChange }: PluginManagerConsoleDialogProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabKey>('activity')

  // Reset to the first tab whenever the dialog re-opens, so a
  // user coming back from a previous session sees the same
  // default view the rail button used to present (Activity).
  useEffect(() => {
    if (open) setActiveTab('activity')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pa-popup is-wide">
        <header className="pa-popup-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-popup-eyebrow">
              {t('plugin.pa.console.eyebrow', { defaultValue: '任务管理器 · 24h 窗口' })}
            </div>
            <DialogTitle asChild>
              <h2 className="pa-popup-title">
                {t('plugin.pa.console.title', { defaultValue: '插件管理控制台' })}
              </h2>
            </DialogTitle>
          </div>
          {/*
            The close button is provided by the underlying
            `DialogContent` (it renders a Radix `DialogPrimitive.Close`
            with its own X icon in the top-right corner) so we
            intentionally do not render a second one here.
          */}
        </header>

        {/*
          Tab strip. Reuses the existing `.pa-segmented` style
          (the same control the installed-list filter uses) so
          the console reads as part of the same design language
          rather than introducing a third tab control. We let
          the body of each tab own its own state — switching
          tabs unmounts the inactive body, dropping its
          in-memory snapshot, which is the same trade-off the
          three legacy popups had between themselves.
        */}
        <div className="pa-popup-tabs">
          <div className="pa-segmented" role="tablist" aria-label="Console tabs">
            <ConsoleTabButton
              active={activeTab === 'activity'}
              onClick={() => setActiveTab('activity')}
              icon={<ActivityIcon size={12} />}
              label={t('plugin.pa.btn.activity')}
            />
            <ConsoleTabButton
              active={activeTab === 'diagnostics'}
              onClick={() => setActiveTab('diagnostics')}
              icon={<ActivityIcon size={12} />}
              label={t('plugin.pa.btn.diagnostics')}
            />
            <ConsoleTabButton
              active={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
              icon={<ScrollText size={12} />}
              label={t('plugin.pa.btn.logs')}
            />
          </div>
        </div>

        {/*
          Each tab body is mounted conditionally so the
          inactive tab's snapshot state doesn't burn CPU
          polling the ring buffers while the user reads
          another tab.
        */}
        {activeTab === 'activity' && <ActivityTab open={open} />}
        {activeTab === 'diagnostics' && <DiagnosticsTab open={open} />}
        {activeTab === 'logs' && <LogsTab open={open} />}
      </DialogContent>
    </Dialog>
  )
}

function ConsoleTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'is-active' : ''}
      onClick={onClick}
    >
      {icon}
      <span style={{ marginLeft: 4 }}>{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Activity tab — last 24h per-plugin summary list. Ported from the
// legacy `PluginActivityDialog` (deleted).
// ─────────────────────────────────────────────────────────────────────────
function ActivityTab({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<PluginMetrics[]>([])

  useEffect(() => {
    if (!open) return
    const refresh = () => setSnapshot(getAllPluginMetrics())
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open])

  const entries = useMemo(() => buildActivityEntries(snapshot), [snapshot])

  return (
    <>
      <div className="pa-popup-body">
        {entries.length === 0 ? (
          <div className="pa-empty">
            <div className="pa-empty-title">—</div>
            <div className="pa-empty-hint">
              {t('plugin.pa.dialog.activity.emptyHint', { defaultValue: '暂无活动' })}
            </div>
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
          {t('plugin.pa.dialog.activity.count', { count: entries.length })}
        </span>
        <div className="pa-right">
          <button className="pa-btn pa-btn-ghost">
            {t('plugin.pa.dialog.activity.clear')}
          </button>
          <button className="pa-btn pa-btn-outline">
            {t('plugin.pa.dialog.activity.export')}
          </button>
        </div>
      </footer>
    </>
  )
}

interface ActivityEntry {
  time: string
  text: React.ReactNode
}

function buildActivityEntries(metrics: PluginMetrics[]): ActivityEntry[] {
  const sorted = [...metrics].sort((a, b) => b.lastActivity - a.lastActivity)
  const result: ActivityEntry[] = []
  for (const m of sorted) {
    const lastDate = m.lastActivity > 0 ? new Date(m.lastActivity) : null
    if (!lastDate || Number.isNaN(lastDate.getTime())) continue
    result.push({
      time: formatTime(lastDate),
      text: (
        <Trans
          i18nKey="plugin.pa.dialog.activity.perPlugin"
          values={{
            name: m.pluginId,
            events: m.totalEvents,
            storage: m.totalStorageOps,
            hooks: m.totalHookInvocations,
            ipc: m.totalBackendCalls,
          }}
          components={{ b: <b /> }}
        />
      ),
    })
  }
  result.unshift({
    time: formatTime(new Date()),
    text: (
      <Trans
        i18nKey="plugin.pa.dialog.activity.rescan"
        values={{ count: metrics.length }}
        components={{ b: <b /> }}
      />
    ),
  })
  return result
}

// ─────────────────────────────────────────────────────────────────────────
// Diagnostics tab — 2×3 cell grid + per-plugin load. Ported from
// the legacy `PluginDiagnosticsDialog` (deleted).
// ─────────────────────────────────────────────────────────────────────────
function DiagnosticsTab({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<PluginMetrics[]>([])
  const [scanTime, setScanTime] = useState<Date>(new Date())
  // Subscribe to the global metrics version so the tab
  // auto-refreshes the moment a new record lands, instead of
  // waking on a timer. See `plugin-telemetry` for details.
  const metricsVersion = useSyncExternalStore(
    subscribeToMetricsVersion,
    getMetricsVersion,
  )

  useEffect(() => {
    if (!open) return
    const refresh = () => {
      setSnapshot(getAllPluginMetrics())
      setScanTime(new Date())
    }
    refresh()
  }, [open, metricsVersion])

  const totals = useMemo(() => {
    const events = getEventMetrics()
    const totalEvents = snapshot.reduce((sum, m) => sum + m.totalEvents, 0)
    const totalHooks = snapshot.reduce((sum, m) => sum + m.totalHookInvocations, 0)
    const totalStorage = snapshot.reduce((sum, m) => sum + m.totalStorageOps, 0)
    const totalBackend = snapshot.reduce((sum, m) => sum + m.totalBackendCalls, 0)
    const totalErrors = snapshot.reduce((sum, m) => sum + m.totalErrors, 0)
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
    <>
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
          <h3
            className="pa-mb-2"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}
          >
            {t('plugin.pa.dialog.diagnostics.perPluginLoad')}
          </h3>
          {perPlugin.length === 0 ? (
            <div className="pa-empty">
              <ActivityIcon size={20} />
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
                    {row.value}{' '}
                    <small>
                      {t('plugin.pa.dialog.diagnostics.eventUnit', { defaultValue: '事件' })}
                    </small>
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
    </>
  )
}

interface DiagCellProps {
  label: string
  value: number | string
  unit?: string
  variant?: 'is-events' | 'is-ok' | 'is-warn'
}

function DiagCell({ label, value, unit, variant }: DiagCellProps) {
  const sparkClass = variant === 'is-events' ? 'pa-spark is-events' : 'pa-spark'
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

// ─────────────────────────────────────────────────────────────────────────
// Logs tab — live tail of the four ring buffers with filter / copy /
// export. Ported from the legacy `PluginLogsDialog` (deleted).
// ─────────────────────────────────────────────────────────────────────────
function LogsTab({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [lines, setLines] = useState<FormattedLogLine[]>([])
  const [filter, setFilter] = useState<string>(FILTER_ALL)

  const filteredLines = useMemo<FormattedLogLine[]>(() => {
    if (filter === FILTER_ALL) return lines
    return lines.filter((l) => l.plugin === filter)
  }, [lines, filter])

  const conflictLines = useMemo(
    () => filteredLines.filter((l) => l.group === 'conflict'),
    [filteredLines],
  )
  const normalLines = useMemo(
    () => filteredLines.filter((l) => l.group !== 'conflict'),
    [filteredLines],
  )

  // Plugin registry for the filter dropdown. We only care
  // about the id + name (and we want to filter out plugins
  // that the user has uninstalled while the dialog was
  // open). Sorting by name keeps the dropdown stable across
  // re-renders.
  const plugins = usePluginStore(useShallow((s) => s.plugins))
  const pluginOptions = useMemo(() => {
    return [...plugins]
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [plugins])

  useEffect(() => {
    if (!open) return
    setFilter(FILTER_ALL)
    const refresh = () => setLines(getRecentLogLines(LOG_LIMIT))
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open])

  const handleCopy = async () => {
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
    if (!target) return
    try {
      await writeFile(target, text)
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
    <>
      <div className="pa-popup-body">
        {lines.length === 0 ? (
          <div className="pa-empty">
            <ScrollText size={20} />
            <div className="pa-empty-title">—</div>
            <div className="pa-empty-hint">
              {t('plugin.pa.dialog.logs.emptyHint', { defaultValue: '暂无日志' })}
            </div>
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="pa-empty">
            <ScrollText size={20} />
            <div className="pa-empty-title">—</div>
            <div className="pa-empty-hint">
              {t('plugin.pa.dialog.logs.emptyFilteredHint', {
                defaultValue: '当前过滤条件下没有日志',
              })}
            </div>
          </div>
        ) : (
          <div className="pa-log-stream">
            {conflictLines.length > 0 && (
              <>
                <div className="pa-log-group" data-log-group="conflict">
                  <span>
                    {t('plugin.pa.dialog.logs.conflictGroup', { defaultValue: '⚠️ 冲突' })}
                  </span>
                  <span className="pa-log-group-count">{conflictLines.length}</span>
                </div>
                {conflictLines.map((line, i) => renderLogLine(line, `c-${i}`))}
              </>
            )}
            {normalLines.length > 0 && (
              <>
                {conflictLines.length > 0 && (
                  <div className="pa-log-group" data-log-group="normal">
                    <span>
                      {t('plugin.pa.dialog.logs.normalGroup', { defaultValue: '活动' })}
                    </span>
                    <span className="pa-log-group-count">{normalLines.length}</span>
                  </div>
                )}
                {normalLines.map((line, i) => renderLogLine(line, `n-${i}`))}
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
                <SelectValue
                  placeholder={t('plugin.pa.dialog.logs.filterAll', {
                    defaultValue: '全部插件',
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>
                  {t('plugin.pa.dialog.logs.filterAll', {
                    defaultValue: '全部插件',
                  })}
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
            title={t('plugin.pa.dialog.logs.exportTitle', {
              defaultValue: '导出为 JSON Lines (.jsonl)',
            })}
          >
            <Download size={12} />
            {t('plugin.pa.dialog.logs.export', { defaultValue: '导出' })}
          </button>
        </div>
      </footer>
    </>
  )
}

function renderLogLine(line: FormattedLogLine, key: string) {
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

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
