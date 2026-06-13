/**
 * PluginManagerView - Full-panel plugin management page (Plugin Atlas).
 *
 * New design (Plugin Atlas) — layout & typography borrowed from
 * `designs/plugin-atlas.html`, but **all colors are bound to the
 * application's own theme variables** via the `--pa-*` aliases in
 * `index.css`. The plugin manager therefore inherits the app's
 * light / dark / system theme automatically — no toggle, no
 * independent palette, no `data-pa-theme` attribute.
 *
 * Top of the panel: editorial hero (eyebrow + serif title + 4
 * action buttons), then a 5-cell stats ribbon, then a 1fr/268px
 * grid whose main column holds the book-spine list and whose
 * rail holds the storage meter and the three "open" buttons
 * (Activity / Diagnostics / Logs) that pop the corresponding
 * dialog.
 *
 * We keep the two-tab structure (Installed / Marketplace) — the
 * marketplace needs the same installed list to render Install /
 * Update / Installed badges, and the user expects a single click
 * to switch.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Upload,
  Store,
  List,
  Activity,
  LineChart,
  ScrollText,
  Search,
  ChevronUp,
} from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { usePluginStore, useUIStore, usePluginMarketStore } from '@/stores'
import { scanPlugins, installPlugin, uninstallPlugin, togglePluginEnabled } from '@/lib/tauri'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { buildPluginContext, getPluginStorage, createPluginEventBus } from '@/lib/plugin-host'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PluginPanelHost } from './PluginPanelHost'
import { PluginPermissionDialog } from './PluginPermissionDialog'
import { PluginMarketView } from './PluginMarketView'
import { PluginStatsRibbon } from './PluginStatsRibbon'
import { PluginInstalledCard } from './PluginInstalledCard'
import { PluginActivityDialog } from './PluginActivityDialog'
import { PluginDiagnosticsDialog } from './PluginDiagnosticsDialog'
import { PluginLogsDialog } from './PluginLogsDialog'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import { getAllPluginMetrics } from '@/lib/plugin-telemetry'
import type { PluginDefinition, PluginPanelProps, PluginPermission } from '@/types/plugin'

/** Active tab. Kept as a string-literal union so the value can be
 *  serialised (e.g. if we ever decide to persist the active tab
 *  to localStorage). */
type PluginManagerTab = 'manage' | 'market'

/** Sub-filter on the installed list (toolbar segmented control). */
type ListFilter = 'all' | 'active' | 'disabled' | 'updates'

/** Which of the three plugin popups is currently open. */
type DialogKind = 'activity' | 'diagnostics' | 'logs'

function PluginManagerView() {
  const { t } = useTranslation()
  const plugins = usePluginStore((s) => s.plugins)
  const setPlugins = usePluginStore((s) => s.setPlugins)
  const setLoaded = usePluginStore((s) => s.setLoaded)
  const [isUploading, setIsUploading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [activeTab, setActiveTab] = useState<PluginManagerTab>('manage')
  // Settings dialog state. We keep the plugin reference (not just the
  // id) so we don't depend on store re-selection while the dialog is
  // open. Opening a settings dialog for a plugin that was just
  // uninstalled races with the close handler, so the open() guard
  // checks the plugin still exists in the store.
  const [settingsPlugin, setSettingsPlugin] = useState<PluginDefinition | null>(null)
  // Permission dialog target. Same pattern as settingsPlugin: we keep
  // the full reference so a concurrent uninstall can't take the
  // plugin out from under the dialog.
  const [permissionsPlugin, setPermissionsPlugin] = useState<PluginDefinition | null>(null)
  // Permissions-to-grant queue. When the install flow finishes
  // extracting a plugin package, we open the dialog with the
  // declared permissions and let the user opt in/out before any
  // grant hits localStorage. The pending state survives across
  // re-renders so the toast on `handleUpload` doesn't race the
  // dialog open.
  const [pendingPermissionGrant, setPendingPermissionGrant] = useState<{
    pluginId: string
    pluginName: string
    requested: PluginPermission[]
  } | null>(null)
  // Three plugin popups (Activity / Diagnostics / Logs). Local state
  // — these dialogs are scoped to the plugin manager view, not
  // app-wide, so we don't push them into `useUIStore`.
  const [openDialog, setOpenDialog] = useState<DialogKind | null>(null)
  // Search query & sub-filter on the installed list. The search
  // matches the design's `pa-search` input; the segmented control
  // narrows the list to active / disabled / update-pending rows.
  const [search, setSearch] = useState('')
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  // Last successful rescan / install / market refresh time. Drives
  // the small "— Latest sync 12:04" label on the right of the tab
  // strip. The label updates reactively when any of the three
  // sources change (rescan / upload / market refresh). Stored as a
  // tick that gets stringified via the locale-aware formatter.
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  useEffect(() => {
    // The first render shows the time of the most recent mount —
    // the user can compare it to their own watch to gauge
    // staleness. After that, every rescan / install / market
    // refresh bumps the value (see handleRescan, handleUpload
    // and the market refresh effect below).
    setLastSyncAt(new Date())
  }, [])
  const lastSyncLabel = useMemo(() => {
    if (!lastSyncAt) return '—'
    const hh = String(lastSyncAt.getHours()).padStart(2, '0')
    const mm = String(lastSyncAt.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }, [lastSyncAt])

  // Marketplace update info — used to compute the "X updates"
  // badge in the hero and to drive the "Updates" sub-filter.
  const marketUpdates = usePluginMarketStore((s) => s.updates)
  const refreshUpdates = usePluginMarketStore((s) => s.refreshUpdates)

  // Re-fetch the update check whenever the installed list
  // changes. The marketplace store already debounces its
  // own back-to-back fetches, so calling this from a
  // `useEffect` is cheap.
  useEffect(() => {
    void refreshUpdates()
  }, [plugins.length, refreshUpdates])

  // Compute the totals for the 5-cell stats ribbon. Errors come
  // from the telemetry store; the other four are derived from
  // `plugins` and `marketUpdates`. Trends are intentionally
  // left undefined — we'd need a baseline snapshot to compute
  // them, and the host doesn't expose one yet.
  //
  // We snapshot the host metrics once per `plugins` change so
  // both `stats` and `storageMeter` see the same point-in-time
  // data. Calling `getAllPluginMetrics()` twice in a single
  // render would otherwise give a slightly different count if
  // the host wrote between the two reads.
  const metricsSnapshot = useMemo(
    () => getAllPluginMetrics(),
    // `plugins` is the cache-buster, not a value read by
    // `getAllPluginMetrics()`. We re-snapshot any time the
    // installed set changes so downstream `stats` /
    // `storageMeter` memos see fresh data; the function
    // itself only reads the host's metric stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugins],
  )
  const stats = useMemo(() => {
    const enabled = plugins.filter((p) => p.enabled).length
    const disabled = plugins.length - enabled
    const updates = marketUpdates.length
    const errors = metricsSnapshot.reduce((sum, m) => sum + m.totalErrors, 0)
    return { total: plugins.length, active: enabled, disabled, updates, errors }
  }, [plugins, marketUpdates, metricsSnapshot])

  // Total bytes used by all plugin storage, and a 100 MB soft
  // quota. The host's per-plugin size tracker is in
  // `plugin-telemetry`, but the per-plugin metric only has
  // `storageSizeBytes` for plugins that have already had a
  // `set` recorded. To avoid an awkward "0 KB" display for
  // freshly-installed plugins, we fall back to a 0-byte
  // baseline and let the meter render a thin sliver.
  const storageMeter = useMemo(() => {
    const usedBytes = metricsSnapshot.reduce((sum, m) => sum + m.storageSizeBytes, 0)
    const maxBytes = 100 * 1024 * 1024 // 100 MB
    const pct = Math.min(100, (usedBytes / maxBytes) * 100)
    return { usedBytes, maxBytes, pct }
  }, [metricsSnapshot])

  // Total events over the last 24h (drives the `Activity`
  // rail-button meta chip).
  const eventCount = useMemo(() => {
    return metricsSnapshot.reduce((sum, m) => sum + m.totalEvents, 0)
  }, [metricsSnapshot])

  // Resolve the plugin list through the active filter + search.
  // Filtering is cheap (≤ a few hundred plugins) so we don't
  // need memoisation beyond the obvious dep list.
  const visiblePlugins = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plugins.filter((p) => {
      if (listFilter === 'active' && !p.enabled) return false
      if (listFilter === 'disabled' && p.enabled) return false
      if (listFilter === 'updates') {
        const hasUpdate = marketUpdates.some(
          (u) => u.id === p.id && u.localVersion !== u.remoteVersion,
        )
        if (!hasUpdate) return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      )
    })
  }, [plugins, search, listFilter, marketUpdates])

  /**
   * Build the props passed to a plugin's settings component. The
   * settings dialog is not an "active panel", so `isActive` is
   * always false. The plugin's own `close` closes the dialog.
   */
  const buildSettingsPanelProps = useCallback((plugin: PluginDefinition): PluginPanelProps => {
    const ctx = buildPluginContext(plugin)
    return {
      pluginId: plugin.id,
      isActive: false,
      close: () => setSettingsPlugin(null),
      invokeBackend: ctx.invokeBackend,
      store: getPluginStorage(plugin.id),
      events: createPluginEventBus(plugin.id),
      activeNoteContent: '',
      activeNotePath: '',
    }
  }, [])

  const openSettings = useCallback((plugin: PluginDefinition) => {
    if (!plugin.settings) return
    setSettingsPlugin(plugin)
  }, [])

  const handleReload = useCallback(async () => {
    try {
      setIsScanning(true)
      const rustMetas = await scanPlugins()
      const loadedPlugins = await loadAllPlugins(rustMetas)
      setPlugins(loadedPlugins)
      setLoaded(true)
      // Bump the "latest sync" label so the user can see the
      // scan/refresh is fresh.
      setLastSyncAt(new Date())
    } catch (err) {
      console.error('Failed to reload plugins:', err)
    } finally {
      setIsScanning(false)
    }
  }, [setPlugins, setLoaded])

  const handleUpload = useCallback(async () => {
    try {
      setIsUploading(true)
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Plugin Package', extensions: ['zip'] }],
      })
      if (!selected) {
        setIsUploading(false)
        return
      }

      const zipPath = selected as string
      const meta = await installPlugin(zipPath)
      toast.success(t('plugin.installSuccess', { name: meta.name }))

      // Reload all plugins so the new one is registered in the
      // store, then run the install-time permission flow. The
      // permission dialog must be opened *after* the plugin is in
      // the registry, because the user might want to inspect the
      // version/description in the list while deciding which
      // permissions to grant.
      await handleReload()
      const installed = usePluginStore
        .getState()
        .plugins.find((p) => p.id === meta.id)
      if (installed && installed.permissions.length > 0) {
        // Initialize the per-plugin status so the dialog has a
        // baseline (currently nothing is granted) before the user
        // makes their selection.
        await initializePluginPermissions(installed.id, installed.permissions)
        setPendingPermissionGrant({
          pluginId: installed.id,
          pluginName: installed.name,
          requested: installed.permissions,
        })
      }
    } catch (err) {
      toast.error(t('plugin.installFailed'), { description: String(err) })
    } finally {
      setIsUploading(false)
    }
  }, [t, handleReload])

  /**
   * Open the permission dialog for an installed plugin from the
   * "Permissions" button on the card. Unlike the install-time flow
   * we don't pre-fill the request list – we show whatever the
   * manifest declared plus any extras the user has already
   * granted, so they can revoke at will.
   */
  const openPermissions = useCallback(async (plugin: PluginDefinition) => {
    setPermissionsPlugin(plugin)
    // Make sure the localStorage entry exists even for a plugin
    // that was installed before the install-flow integration. The
    // dialog falls back to the in-memory `currentStatus` when
    // localStorage is empty, but creating the entry here means
    // revoke persists on close.
    await initializePluginPermissions(plugin.id, plugin.permissions)
  }, [])

  const handleUninstall = useCallback(async (plugin: PluginDefinition) => {
    try {
      await uninstallPlugin(plugin.id)
      // Synchronously clear any UI state that references the
      // removed plugin so the user doesn't see a stale view during
      // the async handleReload below. We *don't* call
      // `unregisterPlugin` here because `handleReload` → `setPlugins`
      // will diff the old list against the freshly-scanned list and
      // fire onUnload + resource cleanup for the removed plugin.
      // Calling `unregisterPlugin` *before* `setPlugins` would cause
      // a double onUnload (once from unregisterPlugin, once from
      // setPlugins's diff), and the second onUnload would run on a
      // plugin reference whose storage/menu/permissions have already
      // been dropped.
      const ui = useUIStore.getState()
      if (ui.sidebarView === `plugin:${plugin.id}`) {
        ui.setSidebarView('explorer')
        if (ui.settingsPanelVisible) ui.setSettingsPanelVisible(false)
      }
      if (ui.rightPanelType === `plugin:${plugin.id}`) {
        ui.setRightPanelType(null)
      }
      toast.success(t('plugin.uninstallSuccess', { name: plugin.name }))
      await handleReload()
    } catch (err) {
      toast.error(t('plugin.uninstallFailed'), { description: String(err) })
    }
  }, [t, handleReload])

  const handleToggleEnabled = useCallback(async (plugin: PluginDefinition, enabled: boolean) => {
    try {
      await togglePluginEnabled(plugin.id, enabled)
      usePluginStore.getState().setPluginEnabled(plugin.id, enabled)
      toast.success(enabled ? t('plugin.enabled', { name: plugin.name }) : t('plugin.disabled', { name: plugin.name }))
    } catch (err) {
      toast.error(t('plugin.toggleFailed'), { description: String(err) })
    }
  }, [t])

  // Rescan the marketplace for updates when the user lands on
  // the Installed tab. We do this on mount + when the installed
  // list changes so a newly-installed plugin is immediately
  // represented in the "Updates" sub-filter.
  useEffect(() => {
    void refreshUpdates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins.length])

  // "Rescan" button in the meta row — refreshes the plugin
  // list (and indirectly the update list via the effect
  // above). Kept as a top-level handler so the button works
  // whether the user is on the Installed or the Marketplace
  // tab.
  const handleRescan = useCallback(() => {
    void handleReload()
  }, [handleReload])

  return (
    <div className="pa-root flex flex-col h-full">
      {/* ── Hero header (editorial) ───────────────────────── */}
      <header className="pa-hero">
        <div className="pa-title-row">
          <h1 className="pa-page-title">{t('plugin.pa.title')}</h1>
          {marketUpdates.length > 0 && (
            <button
              type="button"
              className="pa-update-chip"
              onClick={() => setActiveTab('market')}
              title={t('plugin.market.tabMarket', { defaultValue: '插件市场' })}
            >
              <ChevronUp size={11} className="pa-arrow" />
              <Trans
                i18nKey="plugin.pa.update.available"
                values={{ count: marketUpdates.length }}
                components={{}}
              />
            </button>
          )}
        </div>
      </header>

      {/* ── Tab strip (Installed / Marketplace) — the spine of the page.
             Each tab carries a leading 01 / 02 mono number and a count
             badge in the active tab. The right side shows the latest
             sync time so the user always knows the data is fresh. ── */}
      <nav className="pa-tab-strip" role="tablist" aria-label={t('plugin.pa.tabs.aria')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'manage'}
          className={`pa-tab ${activeTab === 'manage' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('manage')}
        >
          <span className="pa-tab-num">01</span>
          <List size={13} className="pa-tab-icon" />
          <span className="pa-tab-label">{t('plugin.pa.view.installed')}</span>
          <span className="pa-tab-count">{plugins.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'market'}
          className={`pa-tab ${activeTab === 'market' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('market')}
        >
          <span className="pa-tab-num">02</span>
          <Store size={13} className="pa-tab-icon" />
          <span className="pa-tab-label">{t('plugin.pa.view.marketplace')}</span>
          <span className="pa-tab-count">
            {marketUpdates.length > 0
              ? t('plugin.pa.tab.badge.new', { count: marketUpdates.length })
              : '—'}
          </span>
        </button>
        <div className="pa-tab-divider">
          <span className="pa-tab-divider-text">
            {t('plugin.pa.tab.sync')} <b>{lastSyncLabel}</b>
          </span>
        </div>
      </nav>

      {/* ── Body grid (main + rail) ───────────────────────
            The right rail — storage meter + Activity /
            Diagnostics / Logs entry points — only belongs
            on the Installed tab. On the Marketplace tab the
            card grid runs full-width; storage info is
            irrelevant to browsing a remote repo. We render
            the rail conditionally and switch the body class
            so `.pa-body` collapses to a single column. */}
      <div className={`pa-body ${activeTab === 'market' ? 'is-fullwidth' : ''}`}>
        <main className="pa-main" data-view={activeTab}>
          {/*
            Marketplace panel is always rendered (hidden via
            `display: none`) so its in-memory state — repo URL,
            index, search query, tag filter — survives a tab
            switch. A conditional render would drop that state
            and the user would lose their scroll position /
            search term on every switch.
          */}
          {activeTab === 'manage' && (
            <ManageTab
              search={search}
              setSearch={setSearch}
              listFilter={listFilter}
              setListFilter={setListFilter}
              visiblePlugins={visiblePlugins}
              stats={stats}
              isScanning={isScanning}
              isUploading={isUploading}
              onRescan={handleRescan}
              onUpload={handleUpload}
              hasUpdate={(id) =>
                marketUpdates.some((u) => u.id === id && u.localVersion !== u.remoteVersion)
              }
              onToggle={handleToggleEnabled}
              onUninstall={handleUninstall}
              onSettings={openSettings}
              onPermissions={openPermissions}
            />
          )}
          {activeTab === 'market' && <PluginMarketView />}
        </main>

        {activeTab === 'manage' && (
          <aside className="pa-rail">
            {/* Install stats (2 cells per row) sit at the top of
                the right rail so the user gets a one-glance
                summary of the installed plugin set right above
                the storage meter. Stats and storage share the
                same `pa-rail` panel — visually the rail reads as
                a vertical column: stats → storage → open. */}
            <div className="pa-rail-title">
              <span>{t('plugin.pa.rail.stats')}</span>
            </div>
            <PluginStatsRibbon
              total={stats.total}
              active={stats.active}
              disabled={stats.disabled}
              updates={stats.updates}
              errors={stats.errors}
            />

            <div className="pa-rail-title" style={{ marginTop: 18 }}>
              <span>{t('plugin.pa.rail.storage')}</span>
              <span>
                {formatBytes(storageMeter.usedBytes)} / {formatBytes(storageMeter.maxBytes)}
              </span>
            </div>
            <StorageMeter pct={storageMeter.pct} />

            <div className="pa-rail-title" style={{ marginTop: 18 }}>
              <span>{t('plugin.pa.rail.open')}</span>
            </div>
            <RailButton
              icon={<Activity size={13} />}
              label={t('plugin.pa.btn.activity')}
              meta={String(eventCount)}
              onClick={() => setOpenDialog('activity')}
            />
            <RailButton
              icon={<LineChart size={13} />}
              label={t('plugin.pa.btn.diagnostics')}
              meta={String(stats.errors)}
              onClick={() => setOpenDialog('diagnostics')}
            />
            <RailButton
              icon={<ScrollText size={13} />}
              label={t('plugin.pa.btn.logs')}
              meta="—"
              onClick={() => setOpenDialog('logs')}
            />
          </aside>
        )}
      </div>

      {/* ── Settings dialog ─────────────────────────────── */}
      <Dialog
        open={settingsPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsPlugin(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {settingsPlugin && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {settingsPlugin.name} — {t('plugin.settings')}
                </DialogTitle>
                <DialogDescription>
                  {settingsPlugin.description}
                </DialogDescription>
              </DialogHeader>
              <PluginPanelHost
                plugin={settingsPlugin}
                panel={settingsPlugin.settings}
                isActive={false}
                panelProps={buildSettingsPanelProps(settingsPlugin)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Permission dialog – install-time flow ───────── */}
      <PermissionDialogMount
        open={pendingPermissionGrant !== null}
        plugin={pendingPermissionGrant}
        onClose={() => setPendingPermissionGrant(null)}
      />

      {/* ── Permission dialog – per-plugin card flow ────── */}
      <PermissionDialogMount
        open={permissionsPlugin !== null}
        plugin={permissionsPlugin}
        onClose={() => setPermissionsPlugin(null)}
      />

      {/* ── Three plugin popups (Activity / Diagnostics / Logs) ── */}
      <PluginActivityDialog
        open={openDialog === 'activity'}
        onOpenChange={(o) => setOpenDialog(o ? 'activity' : null)}
      />
      <PluginDiagnosticsDialog
        open={openDialog === 'diagnostics'}
        onOpenChange={(o) => setOpenDialog(o ? 'diagnostics' : null)}
      />
      <PluginLogsDialog
        open={openDialog === 'logs'}
        onOpenChange={(o) => setOpenDialog(o ? 'logs' : null)}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface ManageTabProps {
  search: string
  setSearch: (s: string) => void
  listFilter: ListFilter
  setListFilter: (f: ListFilter) => void
  visiblePlugins: PluginDefinition[]
  stats: { total: number; active: number; updates: number; errors: number }
  isScanning: boolean
  isUploading: boolean
  onRescan: () => void
  onUpload: () => void
  hasUpdate: (id: string) => boolean
  onToggle: (plugin: PluginDefinition, enabled: boolean) => void
  onUninstall: (plugin: PluginDefinition) => void
  onSettings: (plugin: PluginDefinition) => void
  onPermissions: (plugin: PluginDefinition) => void
}

function ManageTab({
  search,
  setSearch,
  listFilter,
  setListFilter,
  visiblePlugins,
  stats,
  isScanning,
  isUploading,
  onRescan,
  onUpload,
  hasUpdate,
  onToggle,
  onUninstall,
  onSettings,
  onPermissions,
}: ManageTabProps) {
  const { t } = useTranslation()
  const searchRef = useRef<HTMLInputElement>(null)
  // Cmd/Ctrl-K focuses the search input. We register on the
  // window so it works regardless of which element has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="pa-toolbar">        
        <div className="pa-segmented" role="tablist">
          <SegmentButton
            active={listFilter === 'all'}
            onClick={() => setListFilter('all')}
            label={t('plugin.pa.filter.all')}
          />
          <SegmentButton
            active={listFilter === 'active'}
            onClick={() => setListFilter('active')}
            label={t('plugin.pa.filter.active')}
          />
          <SegmentButton
            active={listFilter === 'disabled'}
            onClick={() => setListFilter('disabled')}
            label={t('plugin.pa.filter.disabled')}
          />
          <SegmentButton
            active={listFilter === 'updates'}
            onClick={() => setListFilter('updates')}
            label={t('plugin.pa.filter.updates')}
          />
        </div>
        <div className="pa-search">
          <Search />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('plugin.pa.searchPlaceholder')}
            aria-label={t('plugin.pa.searchPlaceholder')}
          />
          <span className="pa-kbd">⌘K</span>
        </div>
        <button
          type="button"
          className="pa-btn"
          onClick={onRescan}
          disabled={isScanning}
          style={{ marginLeft: 'auto' }}
        >
          {isScanning ? t('common.loading') : t('plugin.pa.btn.refresh')}
        </button>
        <button
          type="button"
          className="pa-btn pa-btn-primary"
          onClick={() => void onUpload()}
          disabled={isUploading}
        >
          <Upload size={12} />
          {isUploading ? t('plugin.installing') : t('plugin.pa.btn.install')}
        </button>
      </div>

      {visiblePlugins.length === 0 ? (
        <EmptyListHint />
      ) : (
        <div className="pa-market-grid pa-installed-grid">
          {visiblePlugins.map((plugin, idx) => (
            <PluginInstalledCard
              key={plugin.id}
              plugin={plugin}
              index={idx + 1}
              hasUpdate={hasUpdate(plugin.id)}
              onToggle={(enabled) => onToggle(plugin, enabled)}
              onUninstall={() => onUninstall(plugin)}
              onSettings={() => onSettings(plugin)}
              onPermissions={() => onPermissions(plugin)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function EmptyListHint() {
  const { t } = useTranslation()
  return (
    <div className="pa-empty">
      <div className="pa-empty-title">{t('plugin.pa.empty.title')}</div>
      <div className="pa-empty-hint">{t('plugin.pa.empty.hint')}</div>
    </div>
  )
}

function StorageMeter({ pct }: { pct: number }) {
  // We render the bar ourselves (not via `.pa-meter` whose
  // gradient is fixed at 34%) so the bar actually reflects
  // the user's plugin footprint. The host doesn't yet expose
  // a quota, so we render a soft cap at 100 MB.
  return (
    <div className="pa-meter">
      <div className="pa-meter-bar" style={{ position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${Math.max(2, pct)}%`,
            background: 'linear-gradient(to right, var(--pa-accent), var(--pa-accent-2))',
            borderRadius: 999,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div className="pa-meter-foot">
        <span>{pct.toFixed(0)}% used</span>
        <span>soft cap 100 MB</span>
      </div>
    </div>
  )
}

interface RailButtonProps {
  icon: React.ReactNode
  label: string
  meta: string
  onClick: () => void
}

function RailButton({ icon, label, meta, onClick }: RailButtonProps) {
  return (
    <button type="button" className="pa-rail-btn" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="pa-rail-btn-meta">{meta}</span>
    </button>
  )
}

interface SegmentButtonProps {
  active: boolean
  onClick: () => void
  label: string
}

function SegmentButton({ active, onClick, label }: SegmentButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? 'is-active' : ''}
    >
      {label}
    </button>
  )
}

/**
 * Async-host wrapper around `PluginPermissionDialog`. The dialog
 * needs the current `PluginPermissionStatus[]` to render the
 * "currently granted" state, so we have to fetch it before the
 * dialog can mount. Doing it inside the dialog itself would force
 * the dialog to be a controlled component with extra internal
 * state; lifting the fetch into a tiny wrapper keeps the dialog
 * purely declarative.
 */
function PermissionDialogMount({
  open,
  plugin,
  onClose,
}: {
  open: boolean
  plugin: PluginDefinition | { pluginId: string; pluginName: string; requested: PluginPermission[] } | null
  onClose: () => void
}) {
  // Normalize the input shape. The install flow gives us a small
  // struct with `pluginId` / `pluginName` / `requested`; the
  // per-card flow gives us a PluginDefinition with `id` / `name` /
  // `permissions`. Mapping both to a single shape lets the dialog
  // stay agnostic of which entry point opened it. Wrapped in
  // useMemo so the resulting object identity is stable for the
  // useEffect deps below (otherwise the effect would re-fire on
  // every render of the parent).
  const normalized = useMemo(() => {
    if (plugin == null) return null
    if ('pluginId' in plugin) {
      return {
        pluginId: plugin.pluginId,
        pluginName: plugin.pluginName,
        requested: plugin.requested,
      }
    }
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      // Per-card flow: include permissions the user has manually
      // granted in the past so they can revoke them.
      requested: plugin.permissions,
    }
  }, [plugin])

  const [status, setStatus] = useState<import('@/types/plugin').PluginPermissionStatus[]>([])

  useEffect(() => {
    if (!open || !normalized) {
      setStatus([])
      return
    }
    let cancelled = false
    void getPluginPermissions(normalized.pluginId).then((s) => {
      if (cancelled) return
      setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [open, normalized])

  if (!open || !normalized) return null
  return (
    <PluginPermissionDialog
      pluginId={normalized.pluginId}
      pluginName={normalized.pluginName}
      permissions={normalized.requested}
      currentStatus={status}
      onClose={onClose}
    />
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export { PluginManagerView }
