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
} from 'lucide-react'
import type { PluginDefinition } from '@/types/plugin'

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

  return (
    <article
      className={`pa-market-card ${spineClass} ${!plugin.enabled ? 'is-disabled' : ''}`}
      data-plugin-id={plugin.id}
    >
      <div className="pa-market-card-spine" />

      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0 }}>
            <div className="pa-market-card-name">{plugin.name}</div>
            <div className="pa-market-card-id">{plugin.id}</div>
          </div>
          <span className={statusBadge.cls}>{statusBadge.label}</span>
        </div>

        <div className="pa-installed-byline">
          {plugin.author && (
            <span>
              <User size={9} style={ICON_STYLE} />
              <b>{plugin.author}</b>
            </span>
          )}
          {plugin.author && dateText && <span className="pa-sep">·</span>}
          {dateText && (
            <span>
              <Calendar size={9} style={ICON_STYLE} />
              {dateText}
            </span>
          )}
          <span className="pa-sep">·</span>
          <span>v{version}</span>
        </div>

        {plugin.description && (
          <div className="pa-market-card-desc">{plugin.description}</div>
        )}

        <div className="pa-market-card-meta">
          {tags.map((tag) => (
            <span key={tag.key} className={tag.cls}>{tag.label}</span>
          ))}
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
