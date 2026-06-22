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
  HelpCircle,
  Database,
  RefreshCw,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { PluginDefinition } from '@/types/plugin'
import { usePluginStore } from '@/stores'

// Stable style object to avoid per-render allocation.
const ICON_STYLE = { marginRight: 3, verticalAlign: -1 } as const

export interface PluginInstalledCardProps {
  plugin: PluginDefinition
  /** 1-based position, used to pick the spine colour (mod 12). */
  index: number
  /** Whether the card should render the "has update" badge. */
  hasUpdate?: boolean
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

  // Status badge in the card head: green for enabled, muted
  // for disabled. Mirrors the `is-installed` colour family
  // of the marketplace so the two views speak the same
  // language (positive / accent / paper-3).
  const statusBadge = plugin.enabled
    ? { cls: 'pa-market-badge is-installed', label: t('plugin.pa.card.statusOn', { defaultValue: 'On' }) }
    : { cls: 'pa-market-badge', label: t('plugin.pa.card.statusOff', { defaultValue: 'Off' }) }

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
    return {
      cls: 'pa-market-badge is-unknown inline-flex items-center',
      label: t('plugin.pa.card.healthUnknown', { defaultValue: 'Unknown' }),
      Icon: HelpCircle,
    }
  }, [health, t])

  return (
    <article
      className={`pa-market-card ${!plugin.enabled ? 'is-disabled' : ''}`}
      data-plugin-id={plugin.id}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-market-card-name">{plugin.name}</div>
            <div className="pa-market-card-id">{plugin.id}</div>
          </div>
          {/* Health badge — data-plugin-health is a stable CSS/test hook. */}
          <span
            className={healthBadge.cls}
            title={healthBadge.label}
            aria-label={healthBadge.label}
            data-plugin-health={health}
          >
            <healthBadge.Icon size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
            {healthBadge.label}
          </span>
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
          <span className={statusBadge.cls}>{statusBadge.label}</span>
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

        {/* ── Actions row (toggle + icon buttons) ──────── */}
        <div className="pa-installed-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`pa-switch ${switchOn ? 'is-on' : ''}`}
            role="switch"
            aria-checked={switchOn}
            aria-label={`${plugin.name} ${t(switchOn ? 'plugin.pa.card.switchOn' : 'plugin.pa.card.switchOff')}`}
            onClick={() => {
              const next = !switchOn
              setSwitchOn(next)
              // If the host callback rejects, revert the optimistic
              // switch state so the UI stays consistent with the
              // actual enabled state.
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
            <span className="pa-switch-label">{switchOn ? 'on' : 'off'}</span>
          </button>
          <div className="pa-icon-row">
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
                // The store mirrors the new value back onto
                // the plugin definition (see
                // `setPluginAutoUpdate`), so the next render
                // already reflects the change without a
                // separate re-read.
                usePluginStore.getState().setPluginAutoUpdate(plugin.id, !autoUpdateOn)
              }}
            >
              <RefreshCw />
            </button>
            {hasUpdate && onUpdate && (
              <button
                type="button"
                className="pa-icon-btn"
                title={t('plugin.market.updateTo', { defaultValue: 'Update' })}
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
