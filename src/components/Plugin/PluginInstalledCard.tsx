/**
 * PluginInstalledCard — the card used in the Installed view of
 * the Plugin Atlas. Visually a sibling of the marketplace card
 * (`.pa-market-card` chrome) so the two views share the same
 * grid language; semantically distinct because it surfaces
 * per-plugin controls (on / off switch, settings, permissions,
 * uninstall, update).
 *
 * Anatomy (top → bottom):
 *   ┌──────────────────────────────────────┐
 *   │▌ spine 4px (one of 12 hues)         │
 *   ├──────────────────────────────────────┤
 *   │ ● Plugin Name (italic display)   ⤓  │ ← status dot + name + status badge
 *   │ by · author · 2024-01-01 · plugin.id │ ← byline (mono)
 *   │                                      │
 *   │ Description, two lines max.         │
 *   │                                      │
 *   │ [sidebar] [backend] [2 perms] [⤓]   │ ← tag chips
 *   │ ──────────────────────────────      │
 *   │ [⚪ on]   [⛯] [🛡] [⤓] [🗑]         │ ← switch + icon row
 *   └──────────────────────────────────────┘
 *
 * The card is intentionally one of many in a responsive grid
 * (`.pa-market-grid`, `repeat(auto-fill, minmax(280px, 1fr))`)
 * rather than a list row. That keeps the visual language of
 * the two tabs (Installed / Marketplace) consistent and gives
 * the user a comparable scan surface: each card is a 280px
 * unit with a 4px coloured stripe at the top, an italic
 * display name, a 2-line description clamp, and a tag row.
 */
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
import {
  aggregateTelemetryByTimeWindow,
  type TelemetryBucket,
} from '@/lib/plugin-telemetry'
import { PluginSparkline } from './PluginSparkline'

const SPINE_CLASSES = [
  'pa-spine-c1', 'pa-spine-c2', 'pa-spine-c3', 'pa-spine-c4',
  'pa-spine-c5', 'pa-spine-c6', 'pa-spine-c7', 'pa-spine-c8',
  'pa-spine-c9', 'pa-spine-c10', 'pa-spine-c11', 'pa-spine-c12',
] as const

// Stable style objects — pulled out of the render path so a card
// re-render doesn't allocate two new `style` literals per card.
// Inline-style allocation in the byline is intentional, but
// the same literal was being recreated on every render even
// when the relevant icons (User, Calendar) weren't visible.
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
  onPermissions?: () => void
  /**
   * Opens the per-plugin storage inspector (Task 6). Rendered
   * only when the prop is supplied so the card stays usable
   * from contexts that don't need storage affordances (e.g.
   * the marketplace "Installed" preview).
   */
  onStorage?: () => void
}

const PluginInstalledCardInner = memo(function PluginInstalledCard({
  plugin,
  hasUpdate = false,
  error = null,
  onToggle,
  onUninstall,
  onUpdate,
  onSettings,
  onPermissions,
  onStorage,
}: PluginInstalledCardProps) {
  const { t } = useTranslation()
  // Local switch state. The host's `plugin.enabled` is the
  // source of truth, but we mirror it locally for snappy
  // optimistic feedback (the host often round-trips to a
  // tauri command which is ~50–100ms).
  const [switchOn, setSwitchOn] = useState(plugin.enabled)
  // Same pattern as the legacy `PluginBookSpineCard` — when
  // the host's value drifts from our local copy (e.g. another
  // view toggled the same plugin), re-sync. Only fires when
  // the values differ and there's no error to avoid thrash
  // while the host is still surfacing one.
  // Use useEffect to avoid setState during render warning.
  useEffect(() => {
    if (switchOn !== plugin.enabled && !error) {
      setSwitchOn(plugin.enabled)
    }
  }, [plugin.enabled, error, switchOn])

  // Subscribe to the health slice via a shallow selector so
  // the card re-renders only when *this* plugin's health
  // changes (or when the slice reference itself changes).
  // Reading `getPluginHealth` directly via the snapshot would
  // cause every plugin in the grid to re-render whenever the
  // `pluginHealth` record gets a new reference; the selector
  // returns a string (the resolved value) which Zustand
  // compares by value, so unrelated plugins are unaffected.
  const health = usePluginStore(useShallow((s) => s.getPluginHealth(plugin.id)))

  // Task 13 / G13: read the per-plugin conflict slice. The
  // detector runs once per registry refresh (see
  // `stores/plugin.ts::setPlugins`) and the result is cached
  // in `pluginConflicts`; this selector returns a string for
  // `length > 0` so the comparison stays value-based and a
  // sibling plugin's conflict change doesn't re-render this
  // card. The actual conflict list (used for the title
  // tooltip) is read once via `getPluginConflicts(plugin.id)`
  // — both reads happen off the same store snapshot.
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

  // Task 11 / G11: the auto-update opt-in is mirrored from
  // the store onto the runtime definition (see
  // `setPluginAutoUpdate` / `setPlugins`), so the card can
  // render the toggle state synchronously from `plugin.autoUpdate`
  // without re-querying the store. A missing / `false` value
  // reads as "off" — the feature is strictly opt-in.
  const autoUpdateOn = plugin.autoUpdate === true

  // Use plugin id hash for stable spine color instead of filtered index
  // to prevent color jumping when filtering/searching
  const spineClass = useMemo(() => {
    let hash = 0
    for (let i = 0; i < plugin.id.length; i++) {
      hash = ((hash << 5) - hash) + plugin.id.charCodeAt(i)
      hash = hash & hash // Convert to 32bit integer
    }
    const index = Math.abs(hash) % SPINE_CLASSES.length
    return SPINE_CLASSES[index]
  }, [plugin.id])
  const version = plugin.version || '—'
  // Memoize the byline date string. The plugin object's
  // `publishedAt` doesn't change after the plugin is loaded, so
  // the only thing that forces a re-render of the card is a
  // parent update (search query, list filter, etc.) — but the
  // date string itself is a pure function of `publishedAt`, so
  // we cache it and skip the `new Date()` round-trip on every
  // render. With 50+ cards and a fast-typing user, that's a
  // 50× savings on Date construction per keystroke.
  const dateText = useMemo(
    () => (plugin.publishedAt ? formatDate(plugin.publishedAt) : ''),
    [plugin.publishedAt],
  )

  // ── Tag chips ────────────────────────────────────────────
  // Position (where the plugin installs in the editor chrome),
  // backend capability, permission count, pending update, and
  // any surfaced error — all rendered as small mono badges
  // along the bottom of the card body. The array was previously
  // built in the render body of every card on every parent
  // re-render, allocating 5 objects per card per render. For a
  // page with 50 cards and a 60Hz UI, that's 15k allocations
  // per second of typing in the search box. The tag content is
  // a pure function of `(plugin, hasUpdate, error, t)`, so
  // memoize it.
  const tags = useMemo(() => {
    const result: { key: string; cls: string; label: string }[] = [
      {
        key: 'pos',
        cls: 'pa-market-badge',
        label: t(`plugin.iconPosition.${plugin.iconPosition}`, { defaultValue: plugin.iconPosition }),
      },
    ]
    if (plugin.hasBackend) {
      result.push({ key: 'backend', cls: 'pa-market-badge', label: 'backend' })
    }
    if (plugin.permissions.length > 0) {
      result.push({
        key: 'perms',
        cls: 'pa-market-badge',
        label: `${plugin.permissions.length} perms`,
      })
    }
    if (hasUpdate) {
      result.push({
        key: 'update',
        cls: 'pa-market-badge is-update',
        label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }),
      })
    }
    if (error) {
      result.push({
        key: 'err',
        cls: 'pa-market-badge',
        label: t('plugin.error.title', { defaultValue: 'Error' }),
      })
    }
    return result
  }, [t, plugin.iconPosition, plugin.hasBackend, plugin.permissions, hasUpdate, error])

  // Status badge in the card head: green for enabled, muted
  // for disabled. Mirrors the `is-installed` colour family
  // of the marketplace so the two views speak the same
  // language (positive / accent / paper-3).
  const statusBadge = plugin.enabled
    ? { cls: 'pa-market-badge is-installed', label: t('plugin.pa.card.statusOn', { defaultValue: 'On' }) }
    : { cls: 'pa-market-badge', label: t('plugin.pa.card.statusOff', { defaultValue: 'Off' }) }

  // Health badge next to the title. The icon and colour pick
  // up the resolved `health` value:
  //   - healthy   → green check, "Healthy"
  //   - unhealthy → red pulse, "Unhealthy" (with a tooltip
  //                pointing to the lastError in telemetry)
  //   - unknown   → muted help, "Unknown"
  //
  // We use `useMemo` here too — the badge object is
  // re-allocated only when the health value or the i18n
  // function actually changes, so a re-render of the card
  // for some other reason (e.g. parent filter) doesn't churn
  // the icon instance.
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

  // ── Sparkline data (Task 12 / G12) ─────────────────────
  // Aggregate the in-memory metric buffers into 30 one-minute
  // buckets. The aggregator walks four ring buffers (events,
  // storage, hooks, backend) and rolls counts + average
  // durations into the buckets the sparkline consumes. We
  // memoize the result on `plugin.id` so a re-render of the
  // card for some other reason (search filter, parent state
  // change) doesn't re-walk the buffers. Note: the aggregator
  // reads from the in-memory store directly, so the sparkline
  // is *not* live-updated when a new metric is recorded mid-
  // session — it snapshots at card-mount time. That's the
  // same trade-off the existing `getAllPluginMetrics` callers
  // make, and keeps the render path allocation-free.
  const sparklineBuckets: readonly TelemetryBucket[] = useMemo(
    () => aggregateTelemetryByTimeWindow({
      pluginId: plugin.id,
      windowMs: 60_000,
      bucketCount: 30,
    }),
    [plugin.id],
  )

  return (
    <article
      className={`pa-market-card ${spineClass} ${!plugin.enabled ? 'is-disabled' : ''}`}
      data-plugin-id={plugin.id}
    >
      <div className="pa-market-card-spine" />

      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-market-card-name">{plugin.name}</div>
            <div className="pa-market-card-id">{plugin.id}</div>
          </div>
          {/* Health badge sits next to the title (per Task 3 G3).
            The icon + colour pick up the resolved `health` value
            from the store: green check for healthy, red pulse for
            unhealthy, muted help for unknown. The
            `data-plugin-health` attribute is a stable hook for
            CSS / e2e tests that need to assert on a card's
            current health without consulting the i18n label. */}
          <span
            className={healthBadge.cls}
            title={healthBadge.label}
            aria-label={healthBadge.label}
            data-plugin-health={health}
          >
            <healthBadge.Icon size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
            {healthBadge.label}
          </span>
          {/* Task 13 / G13: conflict badge. Sits to the right
            of the health badge so a user scanning the head row
            sees the "health + conflict" pair as a single chip
            cluster. The badge only renders when the plugin is
            part of at least one collision group (iconSlot /
            contentPosition / commandPalette) — see
            `detectPluginConflicts`. The tooltip lists every
            conflict the plugin is currently involved in so a
            dev can read the cause without opening the Logs
            popup. `data-plugin-conflict` is a stable test hook
            mirroring the `data-plugin-health` pattern. */}
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
            aria-label={`${plugin.name} ${switchOn ? 'on' : 'off'}`}
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
