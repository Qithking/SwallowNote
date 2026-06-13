/**
 * PluginMarketView - in-app plugin marketplace browser (Plugin Atlas).
 *
 * The marketplace tab is mounted inside the same `pa-root` shell as
 * the Installed view, so the `--pa-*` tokens it consumes are
 * already bound to the application's theme variables — there is no
 * `data-pa-theme` toggle here, and the panel picks up light / dark
 * / system automatically. The `.pa-market-*` classes in
 * `index.css` mirror the editorial style of the Installed list and
 * stay scoped to `.pa-root`.
 *
 * Layout:
 *   ┌─ pa-market-hero ─────────────────────────────┐
 *   │  pa-repo-input (store icon + URL + Apply)     │
 *   │  pa-pill (key verified)                      │
 *   └──────────────────────────────────────────────┘
 *   ┌─ pa-toolbar ──────────────────────────────────┐
 *   │  pa-search  (full-width)                      │
 *   │  pa-segmented (all / editor / ai / …)         │
 *   └──────────────────────────────────────────────┘
 *   pa-market-grid
 *     pa-market-card × N (4px spine + body + badge)
 *
 * State lives in `usePluginMarketStore` so the install state
 * survives navigation away from the marketplace tab. The detail
 * and post-install permission dialogs are unchanged from the
 * pre-Atlas version.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import {
  Store,
  RefreshCw,
  X,
  Download,
  CheckCircle2,
  AlertCircle,
  Package,
  Search,
  User,
  Calendar,
  Info,
} from 'lucide-react'
import { usePluginMarketStore, usePluginStore } from '@/stores'
import { PluginMarketDetail } from './PluginMarketDetail'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import type {
  PluginIndexEntry,
  PluginPermission,
  PluginPermissionStatus,
} from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'

const SPINE_CLASSES = [
  'pa-spine-c1', 'pa-spine-c2', 'pa-spine-c3', 'pa-spine-c4',
  'pa-spine-c5', 'pa-spine-c6', 'pa-spine-c7', 'pa-spine-c8',
  'pa-spine-c9', 'pa-spine-c10', 'pa-spine-c11', 'pa-spine-c12',
] as const

function PluginMarketView() {
  const { t } = useTranslation()
  const repoUrl = usePluginMarketStore((s) => s.repoUrl)
  const setRepoUrl = usePluginMarketStore((s) => s.setRepoUrl)
  const index = usePluginMarketStore((s) => s.index)
  const isFetchingIndex = usePluginMarketStore((s) => s.isFetchingIndex)
  const fetchError = usePluginMarketStore((s) => s.fetchError)
  const refreshIndex = usePluginMarketStore((s) => s.refreshIndex)
  const searchQuery = usePluginMarketStore((s) => s.searchQuery)
  const setSearchQuery = usePluginMarketStore((s) => s.setSearchQuery)
  const tagFilter = usePluginMarketStore((s) => s.tagFilter)
  const toggleTag = usePluginMarketStore((s) => s.toggleTag)
  // Derive `allTags` and `filteredEntries` in the component via
  // `useMemo`. Calling store methods directly through the selector
  // — `usePluginMarketStore((s) => s.allTags())` — is a classic
  // Zustand footgun: `allTags()` returns a freshly-sorted `Array`
  // on every call, so `Object.is(prev, next)` is always `false`,
  // React re-renders, the selector runs again, the array is a
  // different reference, React re-renders … in a tight loop. The
  // browser keeps redrawing, the click event for the market card
  // never gets a chance to dispatch, and the UI appears to hang
  // on click. Subscribe to the underlying `index` (stable
  // reference between refetches) and `searchQuery` / `tagFilter`
  // (string / string[] — stable references between user edits)
  // and recompute the derived list with `useMemo`, so a click on
  // a card only re-renders the component when the underlying
  // inputs actually change.
  const allTags = useMemo(() => {
    const idx = index
    if (!idx) return []
    const set = new Set<string>()
    for (const p of idx.plugins) {
      for (const tag of p.tags) set.add(tag)
    }
    return Array.from(set).sort()
  }, [index])
  const filteredEntries = useMemo(() => {
    if (!index) return []
    const q = searchQuery.trim().toLowerCase()
    return index.plugins.filter((p) => {
      if (tagFilter.length > 0 && !tagFilter.every((t) => p.tags.includes(t))) {
        return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [index, searchQuery, tagFilter])
  const updates = usePluginMarketStore((s) => s.updates)
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)
  const localVersionFor = usePluginMarketStore((s) => s.localVersionFor)

  const [draftUrl, setDraftUrl] = useState(repoUrl)
  const [detailEntry, setDetailEntry] = useState<PluginIndexEntry | null>(null)
  // Post-install permission grant queue. The marketplace install path
  // runs the same flow as the user-upload path in `PluginManagerView`:
  // the host writes the plugin, we re-scan / re-load so the entry
  // appears in the registry, and *then* we open the permission dialog
  // pre-seeded with the plugin's declared permission list. Without
  // this step a marketplace-installed plugin with declared
  // permissions would auto-activate with no grants and a user
  // revoke would be impossible until the user discovered the
  // per-card "Permissions" button by trial and error.
  //
  // The dialog mounting follows the same async-host wrapper pattern
  // as `PluginManagerView.PermissionDialogMount`: the dialog needs
  // the current `PluginPermissionStatus[]` from localStorage, so we
  // fetch it before opening the modal.
  const [pendingPermissionGrant, setPendingPermissionGrant] = useState<{
    pluginId: string
    pluginName: string
    requested: PluginPermission[]
  } | null>(null)

  // Permission dialog async-host. Mirrors the same wrapper in
  // `PluginManagerView` so we can stay declarative about when the
  // dialog mounts.
  const [permissionStatus, setPermissionStatus] = useState<PluginPermissionStatus[]>([])
  useEffect(() => {
    if (!pendingPermissionGrant) {
      setPermissionStatus([])
      return
    }
    let cancelled = false
    void getPluginPermissions(pendingPermissionGrant.pluginId).then((s) => {
      if (cancelled) return
      setPermissionStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [pendingPermissionGrant])

  /**
   * Invoked by `PluginMarketDetail` after a successful install or
   * update. The detail dialog closes before the permission dialog
   * opens so the two don't stack and the user always lands on the
   * permission question. If the installed plugin declares no
   * permissions, the toast is the only post-install affordance —
   * mirroring the upload flow's no-permissions short-circuit.
   */
  const handleInstalled = (meta: PluginMetadataRust) => {
    setDetailEntry(null)
    // Defer the dialog open one tick so React can finish unmounting
    // the detail dialog (focus traps / portals) before the new
    // dialog mounts. Without the defer, the new dialog inherits the
    // previous one as its trigger element and Radix logs a warning.
    queueMicrotask(() => {
      void (async () => {
        const installed = usePluginStore
          .getState()
          .plugins.find((p) => p.id === meta.id)
        const requested =
          installed?.permissions ?? []
        if (requested.length === 0) return
        await initializePluginPermissions(meta.id, requested)
        setPendingPermissionGrant({
          pluginId: meta.id,
          pluginName: meta.name || meta.id,
          requested,
        })
      })()
    })
  }

  // Keep `draftUrl` in sync if the store URL changes elsewhere
  // (e.g. via `setRepoUrl` from a future "reset to default" action,
  // or hot-reload of the persisted value). Without this the input
  // could show a stale value while the actual fetch targets the
  // updated URL — leading to UI state and fetch state disagreeing.
  useEffect(() => {
    setDraftUrl(repoUrl)
  }, [repoUrl])

  // On first mount and whenever the repo URL changes, kick off a
  // fetch + an update check. The update check depends on the host
  // being able to resolve app_data_dir, which is always available
  // when the marketplace tab is rendered inside the Tauri shell.
  useEffect(() => {
    if (repoUrl) {
      void refreshIndex()
      void refreshUpdates()
    }
    // We intentionally don't depend on the function identities —
    // Zustand returns stable function refs, but listing them would
    // re-run this on every store update. The deps we care about are
    // the URL itself and the *trigger* of mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl])

  const applyRepoUrl = () => {
    if (draftUrl !== repoUrl) {
      setRepoUrl(draftUrl.trim())
    }
  }

  return (
    <div className="pa-flex-col pa-market" style={{ height: '100%', gap: 0 }}>
      {/*
        The marketplace gets its own visual chrome so it doesn't
        blur into the Installed list. The `pa-market-hero` is a
        paper-2 card with a bold heading, the repo URL input, and
        the key-verified pill — a clearly different surface from
        the Installed list's book-spine cards. Below it: a search
        bar + tag chips, then the card grid.
      */}
      <section className="pa-market-hero">
        <div className="pa-market-hero-head">
          <h3 className="pa-market-hero-title">
            {t('plugin.pa.market.heroTitle')}
          </h3>
          <p className="pa-market-hero-hint">
            {t('plugin.pa.market.heroHint')}
          </p>
        </div>
        <div className="pa-market-hero-cta">
          <div className="pa-repo-input">
            <Store />
            <input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyRepoUrl()
              }}
              placeholder={t('plugin.market.repoPlaceholder', { defaultValue: 'https://…/repo.json' })}
              aria-label="Repository URL"
            />
            <button type="button" onClick={applyRepoUrl} disabled={!draftUrl.trim()}>
              {t('plugin.market.apply', { defaultValue: '应用' })}
            </button>
          </div>
          <div className="pa-market-hero-meta">
            <button
              type="button"
              className="pa-btn pa-btn-ghost"
              onClick={() => {
                void refreshIndex()
                void refreshUpdates()
              }}
              disabled={!repoUrl || isFetchingIndex}
              title={t('plugin.market.refresh', { defaultValue: '刷新' })}
            >
              <RefreshCw size={12} className={isFetchingIndex ? 'animate-spin' : ''} />
              {t('plugin.market.refresh', { defaultValue: '刷新' })}
            </button>
            <span className="pa-pill" title={t('plugin.pa.market.keyVerified')}>
              <CheckCircle2 size={10} />
              {t('plugin.pa.market.keyVerified')}
            </span>
          </div>
        </div>
      </section>

      {/* ── Search + tag filter (toolbar) ─────────────── */}
      <div className="pa-market-toolbar">        
        {allTags.length > 0 && (
          <div className="pa-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tagFilter.length === 0}
              className={tagFilter.length === 0 ? 'is-active' : ''}
              onClick={() => usePluginMarketStore.getState().setTagFilter([])}
            >
              all
            </button>
            {allTags.slice(0, 5).map((tag) => {
              const active = tagFilter.length === 1 && tagFilter[0] === tag
              return (
                <button
                  key={tag}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        )}        
        <div className="pa-search" style={{ maxWidth: 'none' }}>
          <Search />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('plugin.market.searchPlaceholder', { defaultValue: '搜索插件名 / 描述 / 标签' })}
            aria-label="Search marketplace"
          />
          {searchQuery && (
            <button
              type="button"
              className="pa-btn pa-btn-ghost pa-btn is-icon"
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              onClick={() => setSearchQuery('')}
              aria-label="clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="pa-market-meta">
          {/*
            Use Trans so the count is rendered as a <b> child
            component, not as the raw `<b>` HTML string. The
            translation key is just `{{count}} 项 · 已验证密钥`
            with no embedded markup; the wrapping <b> lives in
            this component, not in the i18n string.
          */}
          <Trans
            i18nKey="plugin.pa.viewMeta.marketplace"
            values={{ count: index ? index.plugins.length : 0 }}
            components={{ b: <b /> }}
          />
        </div>
      </div>

      {/* ── Error / status row ────────────────────────── */}
      {fetchError && (
        <div className="pa-error" style={{ marginTop: 6, marginBottom: 6 }}>
          <AlertCircle size={13} />
          {fetchError}
        </div>
      )}

      {/* ── Body ──────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!repoUrl ? (
          <EmptyState
            icon={<Store size={28} />}
            title={t('plugin.market.emptyTitle', { defaultValue: '尚未配置仓库' })}
            hint={t('plugin.market.emptyHint', {
              defaultValue: '在顶部粘贴一个 repo.json 的 URL，SwallowNote 会拉取并展示所有可用插件。',
            })}
          />
        ) : isFetchingIndex && !index ? (
          <EmptyState
            icon={<RefreshCw size={28} className="animate-spin" />}
            title={t('plugin.market.loading', { defaultValue: '正在加载仓库…' })}
          />
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={<Package size={28} />}
            title={t('plugin.market.noResults', { defaultValue: '没有匹配的插件' })}
            hint={
              searchQuery
                ? t('plugin.market.noResultsHint', { defaultValue: '尝试调整搜索词或清空标签过滤。' })
                : undefined
            }
          />
        ) : (
          <div className="pa-market-grid">
            {filteredEntries.map((entry, idx) => (
              <PluginMarketCard
                key={entry.id}
                entry={entry}
                spineClass={SPINE_CLASSES[idx % SPINE_CLASSES.length]}
                localVersion={localVersionFor(entry.id)}
                updateInfo={updates.find((u) => u.id === entry.id)}
                onClick={() => setDetailEntry(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail dialog ─────────────────────────────── */}
      {detailEntry && index && (
        <PluginMarketDetail
          entry={detailEntry}
          index={index}
          localVersion={localVersionFor(detailEntry.id) ?? null}
          onClose={() => setDetailEntry(null)}
          onInstalled={handleInstalled}
        />
      )}

      {/* ── Post-install permission dialog ────────────── */}
      {pendingPermissionGrant && (
        <PluginPermissionDialog
          pluginId={pendingPermissionGrant.pluginId}
          pluginName={pendingPermissionGrant.pluginName}
          permissions={pendingPermissionGrant.requested}
          currentStatus={permissionStatus}
          onClose={() => setPendingPermissionGrant(null)}
        />
      )}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="pa-empty">
      {icon}
      <div className="pa-empty-title">{title}</div>
      {hint && <div className="pa-empty-hint">{hint}</div>}
    </div>
  )
}

/**
 * PluginMarketCard — a single plugin tile in the marketplace grid.
 *
 * This card is a *sibling* of `PluginInstalledCard` rather than a
 * different style: both use the same `.pa-market-card` chrome
 * (4px coloured spine + body), the same head layout (italic
 * display name + mono id + status badge), the same byline row
 * (author · date · version, mono, with leading icons), and the
 * same tag chip row. They differ only in the actions row at the
 * bottom — Installed exposes a switch + per-plugin icon buttons
 * (settings/permissions/update/uninstall), while Marketplace
 * exposes a primary CTA (Install / Update / Installed) + a
 * details icon, because the marketplace view cannot toggle a
 * plugin that's only listed remotely.
 *
 * Anatomy (top → bottom):
 *   ┌──────────────────────────────────────────┐
 *   │▌ spine 4px (one of 12 hues)             │
 *   ├──────────────────────────────────────────┤
 *   │ ● Plugin Name (italic display)       ⤓  │ ← status dot + name + badge
 *   │ by · author · 2024-01-01 · v0.1.0        │ ← byline (mono)
 *   │                                          │
 *   │ Description, two lines max.             │
 *   │                                          │
 *   │ [tag] [tag] [2 deps] [Update]            │ ← tag chips
 *   │ ─────────────────────────────────────    │
 *   │ [Install]            [⤓]  [ℹ]            │ ← CTA + icon row
 *   └──────────────────────────────────────────┘
 *
 * The card itself is clickable (opens the detail dialog); the
 * actions row's `e.stopPropagation()` lets the buttons fire
 * without bubbling up to the card click. The CTA and the info
 * icon are *both* shortcuts to the same detail dialog — the CTA
 * is the primary action because it shows the install / update
 * state at a glance, and the info icon is a fallback for users
 * who want to read the changelog before installing.
 */
function PluginMarketCard({
  entry,
  spineClass,
  localVersion,
  updateInfo,
  onClick,
}: {
  entry: PluginIndexEntry
  spineClass: string
  localVersion: string | undefined
  updateInfo?: { localVersion: string; remoteVersion: string; sha256: string }
  onClick: () => void
}) {
  const { t } = useTranslation()
  const isInstalled = !!localVersion
  const isUpdateAvailable = !!updateInfo && updateInfo.localVersion !== updateInfo.remoteVersion

  // Most-recent version is the first entry in the `versions` list
  // (the protocol documents it as "newest first"). Fall back to the
  // entry's own `version` field for older indexes that don't ship
  // a `versions` array.
  const publishedAt = entry.versions?.[0]?.publishedAt ?? ''
  const dateText = publishedAt ? formatDate(publishedAt) : ''
  const version = entry.version || '—'

  // ── Tag chips ────────────────────────────────────────────
  // The Installed card surfaces runtime status (position, backend,
  // permissions, update, error). The Marketplace card doesn't have
  // any of that data — it has tags, dependencies, and update
  // availability. Same `.pa-market-badge` chrome, different
  // content. We show up to 3 tags (matching the segmented filter
  // row above) plus a deps counter when the plugin ships with
  // peer dependencies.
  const tags: { key: string; cls: string; label: string }[] = []
  if (entry.tags) {
    for (const tag of entry.tags.slice(0, 3)) {
      tags.push({ key: `tag-${tag}`, cls: 'pa-market-badge', label: tag })
    }
  }
  if (entry.dependencies && entry.dependencies.length > 0) {
    tags.push({
      key: 'deps',
      cls: 'pa-market-badge',
      label: `${entry.dependencies.length} deps`,
    })
  }
  if (isUpdateAvailable) {
    tags.push({
      key: 'update',
      cls: 'pa-market-badge is-update',
      label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }),
    })
  }

  // Status badge in the card head. Mirrors the `is-installed`
  // colour family of the Installed card, plus an accent colour
  // for "Update available" and a paper-3 muted colour for the
  // fresh-install case.
  const statusBadge = isUpdateAvailable
    ? { cls: 'pa-market-badge is-update', label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }) }
    : isInstalled
    ? { cls: 'pa-market-badge is-installed', label: t('plugin.market.badgeInstalled', { defaultValue: 'Installed' }) }
    : { cls: 'pa-market-badge is-install', label: t('plugin.market.badgeInstall', { defaultValue: 'Install' }) }

  // CTA button (left half of the actions row). The label is the
  // human-friendly action verb; the class swaps the colour theme
  // for install / update / installed states. The button is
  // *always* enabled and *always* opens the detail dialog — the
  // detail dialog owns the actual install / update flow so we
  // can show the changelog + permissions before committing.
  const cta = isUpdateAvailable
    ? { cls: 'pa-market-cta is-update', label: t('plugin.market.badgeUpdate', { defaultValue: 'Update' }) }
    : isInstalled
    ? { cls: 'pa-market-cta is-installed', label: t('plugin.market.upToDate', { defaultValue: 'Up to date' }) }
    : { cls: 'pa-market-cta is-install', label: t('plugin.market.badgeInstall', { defaultValue: 'Install' }) }

  return (
    <article
      className={`pa-market-card ${spineClass}`}
      data-plugin-id={entry.id}
      onClick={onClick}
    >
      <div className="pa-market-card-spine" />

      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0 }}>
            <div className="pa-market-card-name">
              {entry.name || t('plugin.market.unknownName', { defaultValue: '未命名插件' })}
            </div>
            <div className="pa-market-card-id">{entry.id}</div>
          </div>
          <span className={statusBadge.cls}>{statusBadge.label}</span>
        </div>

        <div className="pa-installed-byline">
          {entry.author && (
            <span>
              <User size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
              <b>{entry.author}</b>
            </span>
          )}
          {entry.author && dateText && <span className="pa-sep">·</span>}
          {dateText && (
            <span>
              <Calendar size={9} style={{ marginRight: 3, verticalAlign: -1 }} />
              {dateText}
            </span>
          )}
          <span className="pa-sep">·</span>
          <span>v{version}</span>
          {localVersion && localVersion !== version && (
            <>
              <span className="pa-sep">·</span>
              <span>
                {t('plugin.market.local', { defaultValue: '本地' })} v{localVersion}
              </span>
            </>
          )}
        </div>

        {entry.description && (
          <div className="pa-market-card-desc">{entry.description}</div>
        )}

        <div className="pa-market-card-meta">
          {tags.map((tag) => (
            <span key={tag.key} className={tag.cls}>{tag.label}</span>
          ))}
        </div>

        {/*
          Actions row. Stops propagation so the buttons fire
          without bubbling up to the card's own click handler
          (which would also open the detail dialog). Visually
          identical to the Installed card's actions row — same
          dashed divider, same icon row, same horizontal
          layout. The left half is a primary CTA instead of a
          switch (marketplace plugins can't be toggled), and
          the right half is `Download` (shortcut to the detail
          dialog — same destination as the card body click)
          and `Info` (alias for the same shortcut, labelled
          for users who don't recognise the download icon as
          a "view details" action).
        */}
        <div className="pa-installed-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={cta.cls}
            onClick={onClick}
            title={
              isUpdateAvailable
                ? t('plugin.market.updateTo', { defaultValue: 'Update', version })
                : isInstalled
                ? t('plugin.market.upToDate', { defaultValue: 'Up to date' })
                : t('plugin.market.badgeInstall', { defaultValue: 'Install' })
            }
          >
            {cta.label}
          </button>
          <div className="pa-icon-row">
            <button
              type="button"
              className="pa-icon-btn"
              title={t('plugin.market.viewDetails', { defaultValue: '查看详情' })}
              onClick={onClick}
            >
              <Info />
            </button>
            <button
              type="button"
              className="pa-icon-btn"
              title={
                isUpdateAvailable
                  ? t('plugin.market.updateTo', { defaultValue: '更新到 v{{version}}', version })
                  : t('plugin.market.installNow', { defaultValue: '立即安装' })
              }
              onClick={onClick}
            >
              <Download />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * `YYYY-MM-DD` for a date string (ISO 8601 expected). Falls back
 * to the input string if parsing fails so a malformed `publishedAt`
 * never crashes the card.
 */
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

export { PluginMarketView }
