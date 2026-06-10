/**
 * PluginDiagnosticsPanel
 *
 * Displays plugin metrics, performance stats, and export diagnostics.
 * It is host-internal (not a plugin panel), so it refreshes its own
 * data on a 2s interval and never touches the plugin lifecycle.
 */

import { useState, useEffect } from 'react'
import { Activity, Download, Trash2, AlertCircle, BarChart3, HardDrive, Zap, Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getAllPluginMetrics,
  getEventMetrics,
  getStorageMetrics,
  getHookMetrics,
  getBackendMetrics,
  clearAllMetrics,
  type PluginMetrics,
} from '@/lib/plugin-telemetry'
import { downloadDiagnosticBundle, copyDiagnosticBundleToClipboard } from '@/lib/plugin-diagnostics'

export function PluginDiagnosticsPanel() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<PluginMetrics[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'events' | 'storage' | 'hooks' | 'backend'>('overview')
  const [copied, setCopied] = useState(false)

  // Refresh metrics periodically. We poll the in-memory store because
  // the host's lifecycle calls (emit, storage, hooks) all push into it
  // asynchronously. Polling on a short interval keeps the UI from
  // having to subscribe to every metric source.
  useEffect(() => {
    const refresh = () => setMetrics(getAllPluginMetrics())
    refresh()
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleExport = async () => {
    await downloadDiagnosticBundle()
  }

  const handleCopy = async () => {
    await copyDiagnosticBundleToClipboard()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClear = () => {
    if (window.confirm(t('plugin.diagnostics.clearConfirm'))) {
      clearAllMetrics()
      setMetrics([])
    }
  }

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={20} />
          {t('plugin.diagnostics.title')}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('plugin.diagnostics.description')}
        </p>
      </header>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleExport}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <Download size={14} />
          {t('plugin.diagnostics.exportBundle')}
        </button>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {copied ? t('plugin.diagnostics.copied') : t('plugin.diagnostics.copyBundle')}
        </button>
        <button
          onClick={handleClear}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            border: '1px solid var(--danger-color)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--danger-color)',
            fontSize: 12,
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          <Trash2 size={14} />
          {t('plugin.diagnostics.clearMetrics')}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
        {(['overview', 'events', 'storage', 'hooks', 'backend'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
              textTransform: 'capitalize',
            }}
          >
            {t(`plugin.diagnostics.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {activeTab === 'overview' && <OverviewTab metrics={metrics} />}
        {activeTab === 'events' && <MetricsTable records={getEventMetrics()} tabKey="Events" />}
        {activeTab === 'storage' && <MetricsTable records={getStorageMetrics()} tabKey="Storage" />}
        {activeTab === 'hooks' && <MetricsTable records={getHookMetrics()} tabKey="Hooks" />}
        {activeTab === 'backend' && <MetricsTable records={getBackendMetrics()} tabKey="Backend" />}
      </div>
    </div>
  )
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ metrics }: { metrics: PluginMetrics[] }) {
  const { t } = useTranslation()

  if (metrics.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Activity size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <p>{t('plugin.diagnostics.empty')}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>{t('plugin.diagnostics.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div>
      {metrics.map((m) => (
        <div
          key={m.pluginId}
          style={{
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{m.pluginId}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 12 }}>
            <Stat
              icon={<Zap size={12} />}
              label={t('plugin.diagnostics.statEvents')}
              value={m.totalEvents}
            />
            <Stat
              icon={<HardDrive size={12} />}
              label={t('plugin.diagnostics.statStorageOps')}
              value={m.totalStorageOps}
            />
            <Stat
              icon={<Bug size={12} />}
              label={t('plugin.diagnostics.statHookCalls')}
              value={m.totalHookInvocations}
            />
            <Stat
              icon={<BarChart3 size={12} />}
              label={t('plugin.diagnostics.statBackendCalls')}
              value={m.totalBackendCalls}
            />
            <Stat
              icon={<AlertCircle size={12} />}
              label={t('plugin.diagnostics.statErrors')}
              value={m.totalErrors}
              danger={m.totalErrors > 0}
            />
            <Stat
              icon={<HardDrive size={12} />}
              label={t('plugin.diagnostics.statStorageSize')}
              value={`${(m.storageSizeBytes / 1024).toFixed(1)} KB`}
            />
            <Stat
              icon={<Activity size={12} />}
              label={t('plugin.diagnostics.statAvgEventDuration')}
              value={`${m.averageEventDurationMs.toFixed(2)}ms`}
            />
            <Stat
              icon={<Activity size={12} />}
              label={t('plugin.diagnostics.statAvgStorageDuration')}
              value={`${m.averageStorageDurationMs.toFixed(2)}ms`}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function Stat({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string | number; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ fontWeight: 600, color: danger ? 'var(--danger-color)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

// ─── Generic Metrics Table ─────────────────────────────────────────────────────

type MetricRecord =
  | ReturnType<typeof getEventMetrics>[number]
  | ReturnType<typeof getStorageMetrics>[number]
  | ReturnType<typeof getHookMetrics>[number]
  | ReturnType<typeof getBackendMetrics>[number]

/**
 * `tabKey` matches the suffix of the `plugin.diagnostics.tab*`
 * translation key (Events / Storage / Hooks / Backend) so the empty
 * state can reuse the **localized** tab name instead of the raw
 * English type. The "名称" column still shows the plugin-defined
 * data value (event name, operation, hook name, command) unchanged.
 */
type MetricsTabKey = 'Events' | 'Storage' | 'Hooks' | 'Backend'

function MetricsTable({ records, tabKey }: { records: readonly MetricRecord[]; tabKey: MetricsTabKey }) {
  const { t } = useTranslation()
  if (records.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>{t('plugin.diagnostics.tableEmpty', { type: t(`plugin.diagnostics.tab${tabKey}`) })}</p>
      </div>
    )
  }

  // Show last 50 records
  const recent = records.slice(-50).reverse()

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
          <th style={th}>{t('plugin.diagnostics.colTime')}</th>
          <th style={th}>{t('plugin.diagnostics.colPlugin')}</th>
          <th style={th}>{t('plugin.diagnostics.colName')}</th>
          <th style={th}>{t('plugin.diagnostics.colDuration')}</th>
          <th style={th}>{t('plugin.diagnostics.colStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {recent.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={td}>{new Date(r.timestamp).toLocaleTimeString()}</td>
            <td style={td}>{r.pluginId}</td>
            <td style={td}>
              {'event' in r ? r.event :
               'operation' in r ? r.operation :
               'hook' in r ? r.hook :
               'command' in r ? r.command : '?'}
            </td>
            <td style={td}>
              {'durationMs' in r ? `${r.durationMs.toFixed(2)}ms` :
               'totalDurationMs' in r ? `${r.totalDurationMs.toFixed(2)}ms` : '—'}
            </td>
            <td style={td}>
              {'success' in r ? (r.success ? '✅' : '❌') :
               'errors' in r ? (r.errors > 0 ? `⚠ ${r.errors}` : '✅') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: 'var(--text-secondary)',
  fontWeight: 500,
}

const td: React.CSSProperties = {
  padding: '6px 8px',
  color: 'var(--text-primary)',
}

export default PluginDiagnosticsPanel
