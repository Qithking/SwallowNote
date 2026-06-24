/** PluginInstalledCard — Installed-view card with toggle/settings/permissions/uninstall controls. */
import { useMemo, useState, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Calendar,
  User,
  Settings as SettingsIcon,
  Shield,
  Trash2,
  Download,
  AlertCircle,
  HeartPulse,
  CheckCircle2,
  Database,
  RefreshCw,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { PluginDefinition } from '@/types/plugin'
import { usePluginStore, usePluginMarketStore } from '@/stores'
import { OFFICIAL_REPO_URL } from '@/stores/plugin-market'

// Stable style object to avoid per-render allocation.
const ICON_STYLE = { marginRight: 3, verticalAlign: -1 } as const

export interface PluginInstalledCardProps {
  plugin: PluginDefinition
  /** 1-based position, used to pick the spine colour (mod 12). */
  index: number
  /** Whether the card should render the "has update" badge. */
  hasUpdate?: boolean
  /** Remote version string (from market index), used for "更新到 vX.X.X" tooltip. */
  remoteVersion?: string
  /** Optional host error to render in the error bar. */
  error?: string | null
  onToggle?: (enabled: boolean) => void | Promise<void>
  onUninstall?: () => void
  onUpdate?: () => void
  onSettings?: () => void
  /** Opens schema-driven settings dialog. */
  onOpenSchemaSettings?: () => void
  onPermissions?: () => void
  /** Opens per-plugin storage inspector. */
  onStorage?: () => void
  /** Click on card body to view detail. */
  onClick?: () => void
}

const PluginInstalledCardInner = memo(function PluginInstalledCard({
  plugin,
  hasUpdate = false,
  remoteVersion,
  error = null,
  onToggle,
  onUninstall,
  onUpdate,
  onSettings,
  onOpenSchemaSettings,
  onPermissions,
  onStorage,
  onClick,
}: PluginInstalledCardProps) {
  const { t } = useTranslation()
  // Resolve source URL → display name and style variant for the source label.
  const repoSources = usePluginMarketStore(useShallow((s) => s.repoSources))
  const sourceInfo = useMemo(() => {
    if (plugin.source === 'local') return { label: '本地', variant: 'local' as const }
    if (!plugin.source) return { label: '未知来源', variant: 'unknown' as const }
    if (plugin.source === OFFICIAL_REPO_URL) return { label: '官网', variant: 'official' as const }
    const match = repoSources.find((s) => s.url === plugin.source)
    return match ? { label: match.name, variant: 'custom' as const } : { label: '未知来源', variant: 'unknown' as const }
  }, [plugin.source, repoSources])
  // Local switch state. The host's `plugin.enabled` is the
  // source of truth, but we mirror it locally for snappy
  // optimistic feedback (the host often round-trips to a
  // tauri command which is ~50–100ms).
  const [switchOn, setSwitchOn] = useState(plugin.enabled)
  // Re-sync local switch state when host value drifts.
  useEffect(() => {
    if (switchOn !== plugin.enabled && !error) {
      setSwitchOn(plugin.enabled)
    }
  }, [plugin.enabled, error, switchOn])

  // Shallow selector for value-based comparison.
  const health = usePluginStore(useShallow((s) => s.getPluginHealth(plugin.id)))

  // Read conflict slice as boolean for value-based comparison.
  const hasConflicts = usePluginStore(
    useShallow((s) => (s.pluginConflicts[plugin.id]?.length ?? 0) > 0),
  )
  const conflictTooltip = usePluginStore(
    useShallow((s) => {
      const list = s.pluginConflicts[plugin.id]
      if (!list || list.length === 0) return ''
      return list
        .map((c) => `${c.kind} "${c.value}" → [${c.peerIds.join(', ')}]`)
        .join('\n')
    }),
  )

  // autoUpdate mirrored onto plugin definition for synchronous render.
  const autoUpdateOn = plugin.autoUpdate === true

  const version = plugin.version || '—'
  // Memoize date string.
  const dateText = useMemo(
    () => (plugin.publishedAt ? formatDate(plugin.publishedAt) : ''),
    [plugin.publishedAt],
  )

  // Health badge: healthy=green, unhealthy=red, unknown=muted.
  const healthBadge = useMemo(() => {
    if (health === 'unhealthy') {
      return {
        cls: 'pa-market-badge is-unhealthy inline-flex items-center',
        label: t('plugin.pa.card.healthUnhealthy', { defaultValue: 'Unhealthy' }),
        Icon: HeartPulse,
      }
    }
    if (health === 'healthy') {
      return {
        cls: 'pa-market-badge is-healthy inline-flex items-center',
        label: t('plugin.pa.card.healthHealthy', { defaultValue: 'Healthy' }),
        Icon: CheckCircle2,
      }
    }
    return null
  }, [health, t])

  return (
    <article
      className={`pa-market-card ${!plugin.enabled ? 'is-disabled' : ''}`}
      data-plugin-id={plugin.id}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {/* 右上角「待更新」三角标签：仅在 hasUpdate 时显示 */}
      {hasUpdate && (
        <div
          className="pa-installed-corner-flag"
          data-plugin-corner-flag="update"
          title={remoteVersion ? `有新版本 v${remoteVersion}` : t('plugin.market.updateTo', { defaultValue: 'Update' })}
          aria-label={t('plugin.market.updateTo', { defaultValue: 'Update' })}
        />
      )}
      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-market-card-name">{plugin.name}</div>
            <div className="pa-market-card-id">{plugin.id}</div>
          </div>
          {/* Health badge — data-plugin-health is a stable CSS/test hook. */}
          {healthBadge && (
            <span
              className={healthBadge.cls}
              title={healthBadge.label}
              aria-label={healthBadge.label}
              data-plugin-health={health}
            >
              <healthBadge.Icon size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
              {healthBadge.label}
            </span>
          )}
          {/* Conflict badge — renders when plugin has collisions. */}
          {hasConflicts && (
            <span
              className="pa-market-badge is-conflict"
              title={conflictTooltip}
              aria-label={t('plugin.pa.card.conflict', { defaultValue: 'Conflict' })}
              data-plugin-conflict="yes"
            >
              <AlertCircle size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
              {t('plugin.pa.card.conflict', { defaultValue: 'Conflict' })}
            </span>
          )}
          <span className={`pa-source-label is-${sourceInfo.variant}`}>{sourceInfo.label}</span>
        </div>

        {plugin.description && (
          <div className="pa-market-card-desc">{plugin.description}</div>
        )}

        <div className="pa-installed-byline">
          {plugin.author && (
            <span className="inline-flex items-center">
              <User size={9} style={ICON_STYLE} />
              {plugin.author}
            </span>
          )}
          {plugin.author && dateText && <span className="pa-sep">·</span>}
          {dateText && (
            <span className="inline-flex items-center">
              <Calendar size={9} style={ICON_STYLE} />
              {dateText}
            </span>
          )}
          <span className="pa-sep">·</span>
          <span>v{version}</span>
        </div>

        {error && (
          <div className="pa-installed-error">
            <AlertCircle size={11} />
            {error}
          </div>
        )}

        {/* ── Actions row: 开关靠左，其他按钮靠右 ──────── */}
        <div className="pa-installed-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`pa-switch ${switchOn ? 'is-on' : ''}`}
            role="switch"
            aria-checked={switchOn}
            aria-label={`${plugin.name} ${switchOn ? '禁用' : '启用'}`}
            onClick={() => {
              const next = !switchOn
              setSwitchOn(next)
              const result = onToggle?.(next)
              if (result && typeof result === 'object' && 'catch' in result) {
                ;(result as Promise<unknown>).catch(() => {
                  setSwitchOn(!next)
                })
              }
            }}
          >
            <span className="pa-switch-track">
              <span className="pa-switch-thumb" />
            </span>
            <span className="pa-switch-label">{switchOn ? '启用' : '禁用'}</span>
          </button>
          <div className="pa-icon-row" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`pa-icon-btn ${autoUpdateOn ? 'is-on' : ''}`}
              title={t('plugin.pa.autoUpdate.labelTitle', {
                defaultValue: 'Allow SwallowNote to install newer versions on startup',
              })}
              aria-label={t('plugin.pa.autoUpdate.label', { defaultValue: 'Auto-update' })}
              aria-pressed={autoUpdateOn}
              data-plugin-auto-update={autoUpdateOn ? 'on' : 'off'}
              onClick={() => {
                usePluginStore.getState().setPluginAutoUpdate(plugin.id, !autoUpdateOn)
              }}
            >
              <RefreshCw />
            </button>
            {hasUpdate && onUpdate && (
              <button
                type="button"
                className="pa-icon-btn"
                title={remoteVersion ? `更新到 v${remoteVersion}` : t('plugin.market.updateTo', { defaultValue: 'Update' })}
                onClick={onUpdate}
              >
                <Download />
              </button>
            )}
            {plugin.settings && onSettings && (
              <button
                type="button"
                className="pa-icon-btn"
                title={t('plugin.settings')}
                onClick={onSettings}
              >
                <SettingsIcon />
              </button>
            )}
            {plugin.hasSettingsSchema && onOpenSchemaSettings && (
              <button
                type="button"
                className="pa-icon-btn"
                title={t('plugin.schemaSettings', { defaultValue: 'Plugin settings' })}
                onClick={onOpenSchemaSettings}
              >
                <SettingsIcon />
              </button>
            )}
            {onStorage && (
              <button
                type="button"
                className="pa-icon-btn"
                title={t('plugin.pa.btn.storage', { defaultValue: 'Storage' })}
                onClick={onStorage}
              >
                <Database />
              </button>
            )}
            {plugin.permissions.length > 0 && onPermissions && (
              <button
                type="button"
                className="pa-icon-btn"
                title={t('plugin.permissions')}
                onClick={onPermissions}
              >
                <Shield />
              </button>
            )}
            {onUninstall && (
              <button
                type="button"
                className="pa-icon-btn is-danger"
                title={t('plugin.uninstallSuccess', { defaultValue: 'Uninstall' })}
                onClick={onUninstall}
              >
                <Trash2 />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
})

export { PluginInstalledCardInner as PluginInstalledCard }

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return dateStr
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return dateStr
  }
}
