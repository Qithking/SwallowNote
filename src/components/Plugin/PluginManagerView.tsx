/** 插件管理全屏页面（Plugin Atlas）。颜色绑定到 --pa-* 主题变量。 */
import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import {
  Upload,
  Store,
  List,
  LineChart,
  Search,
  ChevronUp,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { usePluginStore, useUIStore, usePluginMarketStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
import { scanPlugins, installPlugin, uninstallPlugin, togglePluginEnabled } from '@/lib/tauri'
import { loadAllPlugins } from '@/lib/plugin-loader'
import { createPluginPanelProps } from '@/lib/plugin-utils'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { PluginPanelHost } from './PluginPanelHost'
import { PluginStatsRibbon } from './PluginStatsRibbon'
import { PluginInstalledCard } from './PluginInstalledCard'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import { VirtualizedCardGrid } from './VirtualizedCardGrid'
import { memo } from 'react'
import { PluginErrorBoundary } from './PluginErrorBoundary'
import { PluginCardSkeletonGrid } from './PluginCardSkeleton'
import { useDebounce } from './useDebounce'
import { usePluginTelemetryVersion } from '@/hooks'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import { getAllPluginMetrics, getTotalPluginStorageBytes } from '@/lib/plugin-telemetry'
import { getStorageCap } from '@/lib/tauri'
import type { PluginDefinition, PluginPanelProps, PluginPermission } from '@/types/plugin'


// Lazy load dialog components - only loaded when user clicks the corresponding button
const PluginManagerConsoleDialog = lazy(() => import('./PluginManagerConsoleDialog').then(m => ({ default: m.PluginManagerConsoleDialog })))
const PluginPermissionDialog = lazy(() => import('./PluginPermissionDialog'))
// Task 6 (G6): per-plugin storage inspector. Mounted when a card's
// "Storage" icon button fires. Lazy-loaded like the other dialogs so
// the storage-inspector bundle (Tauri bridge + a ~6 KB table) doesn't
// bloat the initial manager render.
const PluginStorageInspector = lazy(() => import('./PluginStorageInspector').then(m => ({ default: m.PluginStorageInspector })))
// Lazy load PluginMarketView - only loaded when user switches to market tab
const PluginMarketView = lazy(() => import('./PluginMarketView').then(m => ({ default: m.PluginMarketView })))
// Task 2 (G2): failure list dialog. Mounted from the top-of-page
// warning banner; lazy-loaded so the dialog's uninstall path
// (which pulls in the plugin-host utilities) doesn't land on disk
// for users who never see a failure.
const PluginLoadFailuresDialog = lazy(() =>
  import('./PluginLoadFailuresDialog').then((m) => ({ default: m.PluginLoadFailuresDialog })),
)

/** Active tab. Kept as a string-literal union so the value can be
 *  serialised (e.g. if we ever decide to persist the active tab
 *  to localStorage). */
type PluginManagerTab = 'manage' | 'market'

/** Sub-filter on the installed list (toolbar segmented control). */
type ListFilter = 'all' | 'active' | 'disabled' | 'updates'

/** Which of the three plugin popups is currently open. */
type DialogKind = 'console'

function PluginManagerView() {
  const { t } = useTranslation()
  // Subscribe to `plugins` via `useShallow` so we don't re-render
  // when an unrelated field on the store changes (e.g. active
  // panel id, registry). The previous `usePluginStore((s) => s.plugins)`
  // returned a new array reference on every store update because
  // Zustand always produces a new state object on `set()`, which
  // made `PluginManagerView` re-render whenever anything in the
  // plugin world changed – even actions that don't touch `plugins`.
  const plugins = usePluginStore(useShallow((s) => s.plugins))
  const setPlugins = usePluginStore((s) => s.setPlugins)
  const setLoaded = usePluginStore((s) => s.setLoaded)
  // Task 2 (G2): subscribe to the per-plugin load-failure map.
  // The store replaces the map atomically after every rescan;
  // useShallow + a stable key keeps the banner's render scope
  // narrow (we only want to re-render the banner, not the whole
  // manager, when an entry is added or removed).
  const loadFailures = usePluginStore(useShallow((s) => s.loadFailures))
  const [isUploading, setIsUploading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [activeTab, setActiveTab] = useState<PluginManagerTab>('manage')
  // 失败列表弹窗状态。
  const [failuresDialogOpen, setFailuresDialogOpen] = useState(false)
  // Settings dialog state. We keep the plugin reference (not just the
  // id) so we don't depend on store re-selection while the dialog is
  // open. Opening a settings dialog for a plugin that was just
  // uninstalled races with the close handler, so the open() guard
  // checks the plugin still exists in the store.
  const [settingsPlugin, setSettingsPlugin] = useState<PluginDefinition | null>(null)
  // Schema-driven settings dialog target (settings.json). Same
  // pattern: we keep the full reference so a concurrent uninstall
  // can't take the plugin out from under the dialog.
  const [schemaSettingsPlugin, setSchemaSettingsPlugin] = useState<PluginDefinition | null>(null)
  // Permission dialog target. Same pattern as settingsPlugin: we keep
  // the full reference so a concurrent uninstall can't take the
  // plugin out from under the dialog.
  const [permissionsPlugin, setPermissionsPlugin] = useState<PluginDefinition | null>(null)
  // Storage inspector target (Task 6 / G6). Same lifecycle
  // guard as the other per-plugin dialogs: we keep the full
  // plugin reference so a concurrent uninstall can't take the
  // plugin out from under an open inspector. The dialog reads
  // `plugin` to render the header and to call into the
  // per-plugin storage on confirm.
  const [storagePlugin, setStoragePlugin] = useState<PluginDefinition | null>(null)
  // Uninstall confirmation target. The card's uninstall button opens
  // this dialog instead of uninstalling immediately, so a stray click
  // doesn't remove a plugin the user meant to keep. Confirmed uninstalls
  // fall through to `handleUninstall`.
  const [uninstallConfirmPlugin, setUninstallConfirmPlugin] = useState<PluginDefinition | null>(null)
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
  const debouncedSearch = useDebounce(search, 150)
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

  // Stable Set of plugin ids that have an update available, so the
  // ManageTab's per-card `hasUpdate(id)` check is O(1) and the
  // callback identity is stable across renders.
  const updateIdSet = useMemo(() => {
    const set = new Set<string>()
    for (const u of marketUpdates) {
      if (u.localVersion !== u.remoteVersion) set.add(u.id)
    }
    return set
  }, [marketUpdates])
  // Stable callback reference — the function body only closes over
  // `updateIdSet`, but the Set reference is stable across renders
  // unless `marketUpdates` actually changes. This prevents every
  // PluginInstalledCard from re-rendering when the parent renders.
  const hasUpdate = useCallback((id: string) => updateIdSet.has(id), [updateIdSet])
  
  // Delay the initial update check to avoid blocking the initial render.
  // Use a longer delay (500ms) to ensure the UI is fully rendered first.
  // Also use background refresh to avoid loading state flicker.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshUpdates({ background: true })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins.length])

  // 通过 usePluginTelemetryVersion 订阅指标版本。
  const metricsVersion = usePluginTelemetryVersion()
  const [metricsSnapshot, setMetricsSnapshot] = useState<ReturnType<typeof getAllPluginMetrics>>([])

  useEffect(() => {
    // 延迟指标计算到下一 tick。
    const calculateMetrics = () => {
      setMetricsSnapshot(getAllPluginMetrics())
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (window as any).requestIdleCallback(calculateMetrics, { timeout: 1000 })
      return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).cancelIdleCallback(id)
      }
    } else {
      const timer = setTimeout(calculateMetrics, 0)
      return () => clearTimeout(timer)
    }
  }, [plugins.length, metricsVersion])
  const stats = useMemo(() => {
    const enabled = plugins.filter((p) => p.enabled).length
    const disabled = plugins.length - enabled
    const updates = marketUpdates.length
    const errors = metricsSnapshot.reduce((sum, m) => sum + m.totalErrors, 0)
    return { total: plugins.length, active: enabled, disabled, updates, errors }
  }, [plugins, marketUpdates, metricsSnapshot])

  // Total bytes used by all plugin storage, against the
  // host-reported free bytes on the volume that hosts the
  // plugin-storage tree. The previous version of this
  // meter used a hardcoded `100 * 1024 * 1024` literal as
  // the denominator — the user-visible cap was a magic
  // number with no relationship to the filesystem. Now
  // `cap` is fetched from the host (`statvfs` on Unix,
  // `GetDiskFreeSpaceExW` on Windows) once on mount. If
  // the host can't query the volume, `cap` is `null` and
  // the meter shows the real used bytes against an
  // "unknown" cap. The "soft cap 100 MB" subtitle is
  // replaced with "available" once a real cap is known.
  const [cap, setCap] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void getStorageCap()
      .then((bytes) => {
        if (!cancelled) setCap(bytes)
      })
      .catch(() => {
        if (!cancelled) setCap(null)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const storageMeter = useMemo(() => {
    const usedBytes = getTotalPluginStorageBytes()
    const maxBytes = cap // real free bytes, or null on host failure
    const pct = maxBytes && maxBytes > 0 ? Math.min(100, (usedBytes / maxBytes) * 100) : 0
    return { usedBytes, maxBytes, pct }
    // metricsVersion 是触发器而非输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsVersion, plugins.length])

  // Total events over the last 24h (drives the `Activity`
  // rail-button meta chip).
  const eventCount = useMemo(() => {
    return metricsSnapshot.reduce((sum, m) => sum + m.totalEvents, 0)
  }, [metricsSnapshot])

  // Resolve the plugin list through the active filter + search.
  // Filtering is cheap (≤ a few hundred plugins) so we don't
  // need memoisation beyond the obvious dep list.
  const visiblePlugins = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
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
  }, [plugins, debouncedSearch, listFilter, marketUpdates])

  // "Select all (visible)" — toggles the membership of every
  // currently-visible plugin in the selection set. The
  // "visible" anchor matches what the user actually sees on
  // screen, so the toolbar checkbox stays in sync with the
  /**
   * Build the props passed to a plugin's settings component. The
   * settings dialog is not an "active panel", so `isActive` is
   * always false. The plugin's own `close` closes the dialog.
   */
  const buildSettingsPanelProps = useCallback((plugin: PluginDefinition): PluginPanelProps => {
    return createPluginPanelProps(
      plugin.id,
      false,
      () => setSettingsPlugin(null),
      '',
      ''
    )
  }, [])

  const openSettings = useCallback((plugin: PluginDefinition) => {
    if (!plugin.settings) return
    setSettingsPlugin(plugin)
  }, [])

  const openSchemaSettings = useCallback((plugin: PluginDefinition) => {
    if (!plugin.hasSettingsSchema) return
    setSchemaSettingsPlugin(plugin)
  }, [])

  const handleReload = useCallback(async () => {
    try {
      setIsScanning(true)
      const rustMetas = await scanPlugins()
      const { plugins: loadedPlugins, failures } = await loadAllPlugins(rustMetas)
      setPlugins(loadedPlugins)
      // G2: forward any per-plugin load failures to the store.
      // The manager subscribes to `loadFailures` to render a
      // top-of-page warning banner; clearing / replacing the
      // map keeps the banner in sync with the on-disk state.
      usePluginStore.getState().setLoadFailures(failures)
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

  /** 打开每插件存储检查器。 */
  const openStorage = useCallback((plugin: PluginDefinition) => {
    setStoragePlugin(plugin)
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

  // Handle plugin update from marketplace
  const handleUpdatePlugin = useCallback(async (plugin: PluginDefinition) => {
    // Find update info from market updates
    const updateInfo = marketUpdates.find((u) => u.id === plugin.id && u.localVersion !== u.remoteVersion)
    if (!updateInfo) {
      toast.error(t('plugin.noUpdateAvailable', { defaultValue: '暂无可用更新' }))
      return
    }
    // Set the pending detail ID so PluginMarketView auto-opens
    // the detail dialog for this plugin, then switch to the market tab.
    usePluginMarketStore.getState().setPendingDetailId(plugin.id)
    setActiveTab('market')
  }, [marketUpdates, t])

  // "Rescan" button in the meta row — refreshes the plugin
  // list (and indirectly the update list via the effect
  // above). Kept as a top-level handler so the button works
  // whether the user is on the Installed or the Marketplace
  // tab.
  const handleRescan = useCallback(() => {
    void handleReload()
  }, [handleReload])

  // Task 2 (G2): count of currently-failed plugin loads. We
  // recompute it on every render of the manager because the
  // `loadFailures` map is cheap to iterate (one shallow-equality
  // check per key) and the banner needs an up-to-date number.
  // We don't bother memoising — `Object.keys` is O(n) and n is
  // usually 0–1.
  const failureCount = Object.keys(loadFailures).length

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

      {/* ── Load-failure banner (Task 2 / G2) ─────────────
            Top-of-page warning strip. Rendered conditionally —
            when `loadFailures` is empty the whole `<div>` is
            unmounted and the rest of the page (tab strip, body
            grid, etc.) shifts up to fill the slot. The banner
            is the *only* entry point the user has for the
            failure list dialog; clicking anywhere on it opens
            the popup. We use a `<div role="button">` rather
            than a `<button>` so the inner arrow icon can be
            positioned absolutely without being part of the
            keyboard tab order, and the parent grid cell can
            grow to the strip's full width. */}
      {failureCount > 0 && (
        <div
          className="pa-loadfailures-banner"
          role="button"
          tabIndex={0}
          aria-label={t('plugin.pa.loadFailures.banner', { count: failureCount })}
          onClick={() => setFailuresDialogOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFailuresDialogOpen(true)
            }
          }}
        >
          <span className="pa-loadfailures-banner-icon" aria-hidden="true">
            <AlertTriangle size={14} />
          </span>
          <span className="pa-loadfailures-banner-text">
            {t('plugin.pa.loadFailures.banner', { count: failureCount })}
          </span>
          <span className="pa-loadfailures-banner-arrow" aria-hidden="true">
            <ChevronRight size={14} />
          </span>
        </div>
      )}

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
            Both panels are always rendered (hidden via
            `display: none`) so their in-memory state — repo URL,
            index, search query, tag filter — survives a tab
            switch. A conditional render would drop that state
            and the user would lose their scroll position /
            search term on every switch.
          */}
          <div style={{ display: activeTab === 'manage' ? 'block' : 'none', height: '100%' }}>
            <ManageTab
              search={search}
              setSearch={setSearch}
              listFilter={listFilter}
              setListFilter={setListFilter}
              visiblePlugins={visiblePlugins}
              isScanning={isScanning}
              isUploading={isUploading}
              onRescan={handleRescan}
              onUpload={handleUpload}
              hasUpdate={hasUpdate}
              onToggle={handleToggleEnabled}
              onUninstall={setUninstallConfirmPlugin}
              onUpdate={handleUpdatePlugin}
              onSettings={openSettings}
              onOpenSchemaSettings={openSchemaSettings}
              onPermissions={openPermissions}
              onStorage={openStorage}
            />
          </div>
          <div style={{ display: activeTab === 'market' ? 'block' : 'none', height: '100%' }}>
            <PluginMarketView />
          </div>
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
                {formatBytes(storageMeter.usedBytes)} / {storageMeter.maxBytes != null ? formatBytes(storageMeter.maxBytes) : '—'}
              </span>
            </div>
            <StorageMeter pct={storageMeter.pct} cap={storageMeter.maxBytes} />

            <div className="pa-rail-title" style={{ marginTop: 18 }}>
              <span>{t('plugin.pa.rail.open')}</span>
            </div>
            <RailButton
              icon={<LineChart size={13} />}
              label={t('plugin.pa.btn.console', { defaultValue: 'Manager console' })}
              meta={t('plugin.pa.btn.consoleMeta', {
                defaultValue: '{{events}} · {{errors}}',
                events: eventCount,
                errors: stats.errors,
              })}
              onClick={() => setOpenDialog('console')}
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

      {/* ── Schema-driven settings dialog (settings.json) ─── */}
      <PluginSettingsDialog
        pluginId={schemaSettingsPlugin?.id ?? ''}
        open={schemaSettingsPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setSchemaSettingsPlugin(null)
        }}
      />

      {/* ── Permission dialog – install-time flow ───────── */}
      <Suspense fallback={null}>
        <PermissionDialogMount
          open={pendingPermissionGrant !== null}
          plugin={pendingPermissionGrant}
          onClose={() => setPendingPermissionGrant(null)}
        />
      </Suspense>

      {/* ── Permission dialog – per-plugin card flow ────── */}
      <Suspense fallback={null}>
        <PermissionDialogMount
          open={permissionsPlugin !== null}
          plugin={permissionsPlugin}
          onClose={() => setPermissionsPlugin(null)}
        />
      </Suspense>

      {/* ── Plugin Manager Console (Activity / Diagnostics / Logs) ── */}
      <Suspense fallback={null}>
        <PluginManagerConsoleDialog
          open={openDialog === 'console'}
          onOpenChange={(o: boolean) => setOpenDialog(o ? 'console' : null)}
        />
      </Suspense>

      {/* ── Storage inspector (Task 6 / G6) ─────────────
            Scoped to a single plugin (passed via `plugin`),
            so we only mount it while a target is selected.
            The dialog resets its internal state on open/close
            transitions so a fresh entry list is loaded every
            time the user re-opens it. */}
      <Suspense fallback={null}>
        <PluginStorageInspector
          open={storagePlugin !== null}
          plugin={storagePlugin}
          onOpenChange={(o: boolean) => {
            if (!o) setStoragePlugin(null)
          }}
        />
      </Suspense>

      {/* 从顶部 banner 打开，懒加载。 */}
      <Suspense fallback={null}>
        <PluginLoadFailuresDialog
          open={failuresDialogOpen}
          onOpenChange={setFailuresDialogOpen}
          onViewLogs={() => setOpenDialog('console')}
        />
      </Suspense>

      {/* ── Uninstall confirmation ─────────────────────
            The installed card's uninstall button opens this
            alert dialog instead of uninstalling immediately,
            so a stray click doesn't remove a plugin the user
            meant to keep. Confirmed uninstalls fall through
            to `handleUninstall`. */}
      <AlertDialog
        open={uninstallConfirmPlugin !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallConfirmPlugin(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('plugin.pa.uninstall.confirmTitle', { defaultValue: '确认卸载' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('plugin.pa.uninstall.confirmDesc', {
                defaultValue: '确定要卸载 {{name}} 吗？此操作不可撤销。',
                name: uninstallConfirmPlugin?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setUninstallConfirmPlugin(null)}>
              {t('plugin.pa.uninstall.cancel', { defaultValue: '取消' })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = uninstallConfirmPlugin
                setUninstallConfirmPlugin(null)
                if (target) void handleUninstall(target)
              }}
            >
              {t('plugin.pa.uninstall.confirm', { defaultValue: '卸载' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

/** Memoized card wrapper to prevent unnecessary re-renders.
 *  The parent ManageTab re-renders on every search keystroke,
 *  but individual cards only need to re-render when their
 *  props actually change (plugin data, update status, etc.).
 */
const MemoizedInstalledCard = memo(PluginInstalledCard)

interface ManageTabProps {
  search: string
  setSearch: (s: string) => void
  listFilter: ListFilter
  setListFilter: (f: ListFilter) => void
  visiblePlugins: PluginDefinition[]
  isScanning: boolean
  isUploading: boolean
  onRescan: () => void
  onUpload: () => void
  hasUpdate: (id: string) => boolean
  onToggle: (plugin: PluginDefinition, enabled: boolean) => void
  onUninstall: (plugin: PluginDefinition) => void
  onUpdate?: (plugin: PluginDefinition) => void
  onSettings: (plugin: PluginDefinition) => void
  /**
   * Open the schema-driven settings dialog (settings.json) for a
   * plugin. The manager view owns the dialog state and passes the
   * resolved `pluginId` down to the dialog.
   */
  onOpenSchemaSettings: (plugin: PluginDefinition) => void
  onPermissions: (plugin: PluginDefinition) => void
  /**
   * Open the per-plugin storage inspector (Task 6 / G6).
   * Required because every installed card now has a "Storage"
   * icon button; the manager view owns the dialog state so a
   * user can still open the inspector while the bulk-select
   * mode is active.
   */
  onStorage: (plugin: PluginDefinition) => void
}

function ManageTab({
  search,
  setSearch,
  listFilter,
  setListFilter,
  visiblePlugins,
  isScanning,
  isUploading,
  onRescan,
  onUpload,
  hasUpdate,
  onToggle,
  onUninstall,
  onUpdate,
  onSettings,
  onOpenSchemaSettings,
  onPermissions,
  onStorage,
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      {isScanning && visiblePlugins.length === 0 ? (
        <div className="pa-market-grid" style={{ padding: '0 28px' }}>
          <PluginCardSkeletonGrid count={6} />
        </div>
      ) : visiblePlugins.length === 0 ? (
        <EmptyListHint />
      ) : (
        <VirtualizedCardGrid
          items={visiblePlugins}
          estimatedRowHeight={200}
          renderItem={(plugin, idx) => (
            <PluginErrorBoundary key={plugin.id} pluginId={plugin.id} pluginName={plugin.name}>
              <MemoizedInstalledCard
                plugin={plugin}
                index={idx + 1}
                hasUpdate={hasUpdate(plugin.id)}
                onToggle={(enabled: boolean) => onToggle(plugin, enabled)}
                onUninstall={() => onUninstall(plugin)}
                onUpdate={onUpdate ? () => onUpdate(plugin) : undefined}
                onSettings={() => onSettings(plugin)}
                onOpenSchemaSettings={() => onOpenSchemaSettings(plugin)}
                onPermissions={() => onPermissions(plugin)}
                onStorage={() => onStorage(plugin)}
              />
            </PluginErrorBoundary>
          )}
        />
      )}
    </div>
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

function StorageMeter({ pct, cap }: { pct: number; cap: number | null }) {
  // We render the bar ourselves (not via `.pa-meter` whose
  // gradient is fixed at 34%) so the bar actually reflects
  // the user's plugin footprint. The denominator is the
  // **host-reported free bytes** on the volume that hosts
  // the plugin-storage tree — see `getStorageCap` /
  // `get_storage_cap` in the Tauri command layer.
  //
  // **CSS gotcha** (was the source of "still shows a 34%
  // green sliver" feedback): `.pa-meter-bar` in
  // `index.css:999` has a `::after` pseudo-element with
  // `width: 34%` and the same gradient as our fill. That
  // pseudo is the **default** for the class (used by the
  // other meters elsewhere in this file — user activity,
  // etc.), so we can't remove the rule. We *do* reuse the
  // `.pa-meter-bar` class for consistent rail styling
  // (height, radius, overflow), but we suppress its `::after`
  // with a local class — otherwise the rail would always
  // show a hardcoded 34% green sliver regardless of our
  // own fill width. This was a regression the previous
  // version missed: my inline `width: 0%` div was correct,
  // but the `::after` was drawn **on top of** (well, next
  // to) it and dominated the visual.
  //
  // Bar width policy:
  // - `cap != null` (real denominator): render the actual
  //   percent. No `Math.max(2, pct)` floor — that floor was
  //   a visual placeholder for the previous hardcoded
  //   "soft cap 100 MB" UI, and it was a lie (it forced a
  //   2% sliver even when usage was 0). With a real
  //   denominator, "0 B used" should literally be 0% wide.
  // - `cap == null` (host query failed): render **no fill
  //   at all** (0% wide, just the rail visible). The footer
  //   renders the "cap unknown" hint so the empty rail is
  //   understood as "data unavailable", not "0% used".
  const { t } = useTranslation()
  const fillWidth = cap != null ? pct : 0
  return (
    <div className="pa-meter">
      <div className="pa-meter-bar pa-meter-bar--storage" style={{ position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${fillWidth}%`,
            background: 'linear-gradient(to right, var(--pa-accent), var(--pa-accent-2))',
            borderRadius: 999,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div className="pa-meter-foot">
        {cap != null ? (
          <>
            <span>{t('plugin.pa.rail.storageMeter.usedPct', { pct: pct.toFixed(2) })}</span>
            <span>{t('plugin.pa.rail.storageMeter.available')}</span>
          </>
        ) : (
          <>
            <span>{t('plugin.pa.rail.storageMeter.capUnknownPct')}</span>
            <span>{t('plugin.pa.rail.storageMeter.capUnknown')}</span>
          </>
        )}
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
  // 归一为统一形状。
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

export { PluginManagerView }
