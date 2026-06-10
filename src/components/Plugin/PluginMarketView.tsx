/**
 * PluginMarketView — in-app plugin marketplace browser (Phase 9.2).
 *
 * Renders a search/filter bar on top, then a responsive card grid
 * of `PluginMarketCard`. The repo URL is set via a small input in
 * the header; a Refresh button re-fetches the index. Clicking a
 * card opens `PluginMarketDetail` in a dialog.
 *
 * State lives in `usePluginMarketStore` (Zustand) so the install
 * state survives navigation away from the marketplace tab.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, RefreshCw, X, Store, Download, CheckCircle2, AlertCircle, Package, Tag } from 'lucide-react'
import { usePluginMarketStore, usePluginStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PluginMarketDetail } from './PluginMarketDetail'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import type { PluginIndexEntry, PluginPermission, PluginPermissionStatus } from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'

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
      for (const t of p.tags) set.add(t)
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* Repo URL bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Store size={16} style={{ color: 'var(--text-secondary)' }} />
        <Input
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyRepoUrl()
          }}
          placeholder={t('plugin.market.repoPlaceholder', { defaultValue: 'https://…/repo.json' })}
          style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        />
        <Button onClick={applyRepoUrl} disabled={!draftUrl.trim()}>
          {t('plugin.market.apply', { defaultValue: '应用' })}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void refreshIndex()
            void refreshUpdates()
          }}
          disabled={!repoUrl || isFetchingIndex}
        >
          <RefreshCw size={14} className={isFetchingIndex ? 'animate-spin' : ''} />
          {t('plugin.market.refresh', { defaultValue: '刷新' })}
        </Button>
      </div>

      {/* Search + tag filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
            }}
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('plugin.market.searchPlaceholder', { defaultValue: '搜索插件名 / 描述 / 标签' })}
            style={{ paddingLeft: 28 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label="clear"
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allTags.map((tag) => {
              const active = tagFilter.includes(tag)
              return (
                <Badge
                  key={tag}
                  variant={active ? 'default' : 'outline'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleTag(tag)}
                >
                  <Tag size={10} />
                  {tag}
                </Badge>
              )
            })}
          </div>
        )}
      </div>

      {/* Error / status row */}
      {fetchError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--danger, #c0392b)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={14} />
          {fetchError}
        </div>
      )}

      {/* Body */}
      <ScrollArea style={{ flex: 1 }}>
        {!repoUrl ? (
          <EmptyState
            icon={<Store size={32} />}
            title={t('plugin.market.emptyTitle', { defaultValue: '尚未配置仓库' })}
            hint={t('plugin.market.emptyHint', {
              defaultValue: '在顶部粘贴一个 repo.json 的 URL，SwallowNote 会拉取并展示所有可用插件。',
            })}
          />
        ) : isFetchingIndex && !index ? (
          <EmptyState
            icon={<RefreshCw size={32} className="animate-spin" />}
            title={t('plugin.market.loading', { defaultValue: '正在加载仓库…' })}
          />
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={<Package size={32} />}
            title={t('plugin.market.noResults', { defaultValue: '没有匹配的插件' })}
            hint={
              searchQuery
                ? t('plugin.market.noResultsHint', { defaultValue: '尝试调整搜索词或清空标签过滤。' })
                : undefined
            }
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
              padding: '4px 0',
            }}
          >
            {filteredEntries.map((entry) => (
              <PluginMarketCard
                key={entry.id}
                entry={entry}
                localVersion={localVersionFor(entry.id)}
                updateInfo={updates.find((u) => u.id === entry.id)}
                onClick={() => setDetailEntry(entry)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Detail dialog */}
      {detailEntry && index && (
        <PluginMarketDetail
          entry={detailEntry}
          index={index}
          localVersion={localVersionFor(detailEntry.id) ?? null}
          onClose={() => setDetailEntry(null)}
          onInstalled={handleInstalled}
        />
      )}

      {/* Post-install permission dialog. Mirrors the install-time
          flow in `PluginManagerView` so marketplace installs and
          user uploads land in the same place. `pendingPermissionGrant`
          carries the install-time state; the dialog itself handles
          the grant / revoke through `plugin-permissions.ts`. */}
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 200,
        color: 'var(--text-secondary)',
        gap: 8,
        textAlign: 'center',
        padding: 24,
      }}
    >
      {icon}
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, maxWidth: 360 }}>{hint}</div>}
    </div>
  )
}

function PluginMarketCard({
  entry,
  localVersion,
  updateInfo,
  onClick,
}: {
  entry: PluginIndexEntry
  localVersion: string | undefined
  updateInfo?: { localVersion: string; remoteVersion: string; sha256: string }
  onClick: () => void
}) {
  const { t } = useTranslation()
  const isInstalled = !!localVersion
  const isUpdateAvailable = !!updateInfo && updateInfo.localVersion !== updateInfo.remoteVersion
  const isFresh = !localVersion && !updateInfo

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg-elevated, #fafafa)',
        border: '1px solid var(--border, #e5e5e5)',
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {entry.name || t('plugin.market.unknownName', { defaultValue: '未命名插件' })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
            {entry.id}
          </div>
        </div>
        <InstallStatus isInstalled={isInstalled} isUpdateAvailable={isUpdateAvailable} isFresh={isFresh} />
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {entry.description || t('plugin.market.noDescription', { defaultValue: '暂无描述' })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Badge variant="outline" style={{ fontSize: 10 }}>
          v{entry.version}
        </Badge>
        {localVersion && localVersion !== entry.version && (
          <Badge variant="outline" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            {t('plugin.market.local', { defaultValue: '本地' })} v{localVersion}
          </Badge>
        )}
        {entry.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" style={{ fontSize: 10 }}>
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  )
}

function InstallStatus({
  isInstalled,
  isUpdateAvailable,
  isFresh,
}: {
  isInstalled: boolean
  isUpdateAvailable: boolean
  isFresh: boolean
}) {
  const { t } = useTranslation()
  if (isUpdateAvailable) {
    return (
      <Badge style={{ background: 'var(--accent, #4f46e5)', color: 'white' }}>
        <Download size={10} />
        {t('plugin.market.badgeUpdate', { defaultValue: 'Update' })}
      </Badge>
    )
  }
  if (isInstalled) {
    return (
      <Badge variant="secondary">
        <CheckCircle2 size={10} />
        {t('plugin.market.badgeInstalled', { defaultValue: 'Installed' })}
      </Badge>
    )
  }
  if (isFresh) {
    return (
      <Badge variant="outline">
        <Download size={10} />
        {t('plugin.market.badgeInstall', { defaultValue: 'Install' })}
      </Badge>
    )
  }
  return null
}

export { PluginMarketView }
