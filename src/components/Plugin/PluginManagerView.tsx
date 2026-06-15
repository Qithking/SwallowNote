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
import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import {
  Upload,
  Store,
  List,
  Activity,
  LineChart,
  ScrollText,
  Search,
  ChevronUp,
  ChevronRight,
  Power,
  PowerOff,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { usePluginStore, useUIStore, usePluginMarketStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
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
import { PluginStatsRibbon } from './PluginStatsRibbon'
import { PluginInstalledCard } from './PluginInstalledCard'
import { VirtualizedCardGrid } from './VirtualizedCardGrid'
import { memo } from 'react'
import { PluginErrorBoundary } from './PluginErrorBoundary'
import { PluginCardSkeletonGrid } from './PluginCardSkeleton'
import { useDebounce } from './useDebounce'
import { usePluginTelemetryVersion } from '@/hooks'
import { initializePluginPermissions, getPluginPermissions } from '@/lib/plugin-permissions'
import { getAllPluginMetrics } from '@/lib/plugin-telemetry'
import type { PluginDefinition, PluginPanelProps, PluginPermission } from '@/types/plugin'


// Lazy load dialog components - only loaded when user clicks the corresponding button
const PluginActivityDialog = lazy(() => import('./PluginActivityDialog').then(m => ({ default: m.PluginActivityDialog })))
const PluginDiagnosticsDialog = lazy(() => import('./PluginDiagnosticsDialog').then(m => ({ default: m.PluginDiagnosticsDialog })))
const PluginLogsDialog = lazy(() => import('./PluginLogsDialog').then(m => ({ default: m.PluginLogsDialog })))
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
type DialogKind = 'activity' | 'diagnostics' | 'logs'

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
  // Failure list dialog state (Task 2 / G2). The dialog is
  // mounted but hidden until the user clicks the top-of-page
  // banner; reusing the same controlled pattern as the other
  // plugin popups (Activity / Diagnostics / Logs / Storage
  // Inspector) keeps state predictable.
  const [failuresDialogOpen, setFailuresDialogOpen] = useState(false)
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
  // Storage inspector target (Task 6 / G6). Same lifecycle
  // guard as the other per-plugin dialogs: we keep the full
  // plugin reference so a concurrent uninstall can't take the
  // plugin out from under an open inspector. The dialog reads
  // `plugin` to render the header and to call into the
  // per-plugin storage on confirm.
  const [storagePlugin, setStoragePlugin] = useState<PluginDefinition | null>(null)
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
  // ── Multi-select state (G7 batch operations) ──────────────
  // The selection set is intentionally kept as component-local
  // state rather than pushed into the plugin store: selection is
  // a view-only concern (the user is picking which rows to act
  // on in the *current* filter), not a property of the plugin
  // itself. Clearing on tab switch is the right escape hatch
  // because switching to the Marketplace tab and back resets
  // visiblePlugins to the default filter, and stale ids would
  // dangle.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Stable callback — the child card's identity is derived from
  // the (plugin, selection) pair, and a new function reference
  // on every render would defeat the memo wrapper. The handler
  // updates an immutable copy of the set so React's reference
  // equality detects the change.
  const toggleSelected = useCallback((id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const updated = new Set(prev)
      if (next) updated.add(id)
      else updated.delete(id)
      return updated
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  // Whenever the user flips the active tab we drop the
  // selection — the marketplace tab has no concept of
  // "selected installed plugin" and the work would otherwise
  // sit around in memory.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeTab])
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

  // Compute the totals for the 5-cell stats ribbon. Errors come
  // from the telemetry store; the other four are derived from
  // `plugins` and `marketUpdates`. Trends are intentionally
  // left undefined — we'd need a baseline snapshot to compute
  // them, and the host doesn't expose one yet.
  //
  // We use a deferred state to avoid blocking the initial render.
  // Metrics are computed after the UI is visible.
  //
  // **M15 (Wave D review):** the previous `useEffect([plugins.length])`
  // only re-ran the metrics recomputation when the plugin *count*
  // changed. A busy host emitting hundreds of metrics while the
  // user was looking at the stats ribbon would see frozen error
  // counts / event totals / storage size — the snapshot was a
  // one-shot computed at mount. We now subscribe to
  // `usePluginTelemetryVersion()`, a monotonic counter bumped on
  // every recorder call, so the recompute fires whenever the host
  // actually records something. The effect deps become
  // `[plugins.length, metricsVersion]`, and the version itself
  // changes only on real recorder activity, so we don't pay a
  // constant-rate re-render cost.
  const metricsVersion = usePluginTelemetryVersion()
  const [metricsSnapshot, setMetricsSnapshot] = useState<ReturnType<typeof getAllPluginMetrics>>([])

  useEffect(() => {
    // Defer metrics calculation to one tick so the first paint lands
    // before we recompute. The old code used a 300ms setTimeout
    // fallback for environments without `requestIdleCallback`
    // (Tauri WebView, jsdom, etc.), but with evidence showing the
    // actual `getAllPluginMetrics` cost is 0ms on a 1-plugin install
    // and bounded by `O(4M + N)` even on a 200-plugin install, the
    // 300ms was a free 300ms of perceived latency on every page
    // mount. Yielding with `setTimeout(0)` (≈ 4ms in practice) is
    // enough to let React commit the first frame.
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
  // card grid. Mixed state (some visible rows selected, some
  // not) is handled by the toolbar checkbox: if *all* visible
  // rows are in the set we render checked; if *none* are we
  // render unchecked; otherwise we render the indeterminate
  // dash so the user knows the selection is partial.
  const selectAllVisible = useCallback(
    (next: boolean) => {
      setSelectedIds((prev) => {
        const updated = new Set(prev)
        for (const p of visiblePlugins) {
          if (next) updated.add(p.id)
          else updated.delete(p.id)
        }
        return updated
      })
    },
    [visiblePlugins],
  )

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

  /**
   * Open the per-plugin storage inspector (Task 6 / G6). We
   * intentionally don't gate this on the `storage` permission
   * — the inspector is a *browse* tool and a plugin author
   * who hasn't been granted storage should still be able to see
   * the empty state. The per-row `entries()` call inside the
   * dialog runs through the same permission gate, so a revoked
   * plugin surfaces a clear "permission required" error rather
   * than a silent empty list.
   */
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

  // ── G7 batch operations ──────────────────────────────────
  // Each batch handler walks the current selection in
  // declaration order (the order in which the user added rows
  // to the set), awaits each operation, and tallies successes
  // / failures independently. We deliberately do *not* abort
  // on the first failure — the user expects "select 5 plugins,
  // uninstall 4 of them, 1 fails" to report "4 成功 / 1 失败"
  // rather than leave the other 3 untouched. The summary toast
  // is fired once at the end so the user gets a single,
  // easy-to-read status line.
  //
  // For uninstalls we batch the host-side `handleReload` so we
  // don't re-scan the plugin directory N times; toggles don't
  // need a reload (they're store-mutating only), so they get
  // the cheaper path.
  const runBatch = useCallback(
    async (
      label: string,
      actions: Array<{ plugin: PluginDefinition; run: () => Promise<void> }>,
    ): Promise<{ success: number; failure: number }> => {
      let success = 0
      let failure = 0
      // Sequential, not parallel — the underlying tauri command
      // touches a single mutex on the rust side, and stacking N
      // concurrent calls just queues them. Awaiting in order
      // also makes the "正在卸载第 3/N 项…" UX honest.
      for (const { plugin, run } of actions) {
        try {
          await run()
          success += 1
        } catch (err) {
          failure += 1
          // Don't fail-silent on the per-item side: log the
          // pair so the user can copy the id into the dev
          // console if they want to dig in.
          console.error(`[batch:${label}] failed for ${plugin.id}:`, err)
        }
      }
      return { success, failure }
    },
    [],
  )

  // Snapshot of the selected plugins. We resolve ids against
  // the *current* `plugins` array (not `visiblePlugins`) so a
  // user can select across filters and still act on the full
  // set. If a plugin disappears between selection and action
  // (e.g. another flow uninstalled it), the lookup just skips
  // the dangling id and the toast reports N success on a
  // smaller-than-expected N — the user will see the missing
  // card gone from the list anyway.
  const selectedPlugins = useMemo<PluginDefinition[]>(() => {
    if (selectedIds.size === 0) return []
    const out: PluginDefinition[] = []
    for (const p of plugins) {
      if (selectedIds.has(p.id)) out.push(p)
    }
    return out
  }, [plugins, selectedIds])

  const handleBatchEnable = useCallback(async () => {
    if (selectedIds.size === 0) return
    const targets = selectedPlugins
    const actions = targets.map((plugin) => ({
      plugin,
      run: async () => {
        await togglePluginEnabled(plugin.id, true)
        usePluginStore.getState().setPluginEnabled(plugin.id, true)
      },
    }))
    const { success, failure } = await runBatch('enable', actions)
    clearSelection()
    toast.success(
      t('plugin.pa.batch.summary', {
        defaultValue: '成功 {{success}} 项，失败 {{failure}} 项',
        success,
        failure,
      }),
    )
  }, [selectedIds, selectedPlugins, runBatch, clearSelection, t])

  const handleBatchDisable = useCallback(async () => {
    if (selectedIds.size === 0) return
    const targets = selectedPlugins
    const actions = targets.map((plugin) => ({
      plugin,
      run: async () => {
        await togglePluginEnabled(plugin.id, false)
        usePluginStore.getState().setPluginEnabled(plugin.id, false)
      },
    }))
    const { success, failure } = await runBatch('disable', actions)
    clearSelection()
    toast.success(
      t('plugin.pa.batch.summary', {
        defaultValue: '成功 {{success}} 项，失败 {{failure}} 项',
        success,
        failure,
      }),
    )
  }, [selectedIds, selectedPlugins, runBatch, clearSelection, t])

  const handleBatchUninstall = useCallback(async () => {
    if (selectedIds.size === 0) return
    // Pre-flight: build a quick "is this id still in the
    // registry?" map from the live store. We resolve through
    // `plugins` (the source of truth) so a card that vanished
    // mid-batch — say the host crashed and reloaded — is
    // silently skipped instead of throwing.
    const targets = selectedPlugins
    const actions = targets.map((plugin) => ({
      plugin,
      run: async () => {
        await uninstallPlugin(plugin.id)
        // Mirror the per-card handleUninstall side-effects: if
        // the removed plugin owned a sidebar/right-panel slot,
        // yank the view back to the explorer so the user
        // doesn't see a stale chrome after the reload.
        const ui = useUIStore.getState()
        if (ui.sidebarView === `plugin:${plugin.id}`) {
          ui.setSidebarView('explorer')
          if (ui.settingsPanelVisible) ui.setSettingsPanelVisible(false)
        }
        if (ui.rightPanelType === `plugin:${plugin.id}`) {
          ui.setRightPanelType(null)
        }
      },
    }))
    const { success, failure } = await runBatch('uninstall', actions)
    // One reload at the end, not N. The `scanPlugins` call
    // hits the FS and is the slowest part of the uninstall
    // path; the previous (per-item) implementation triggered
    // it inside `handleUninstall`, which worked for a single
    // uninstall but ballooned to N rescans for an N-row
    // batch.
    if (success > 0) {
      try {
        const rustMetas = await scanPlugins()
        // `loadAllPlugins` returns a `PluginLoadResult` whose
        // `plugins` field is the array we want to push into
        // the store. The pre-existing `handleReload` passes
        // the wrapper object directly (a pre-existing type
        // bug); we extract the inner array here to keep the
        // batch path type-clean.
        const loaded = await loadAllPlugins(rustMetas)
        setPlugins(loaded.plugins)
        setLoaded(true)
        setLastSyncAt(new Date())
      } catch (err) {
        console.error('[batch:uninstall] reload failed:', err)
      }
    }
    clearSelection()
    toast.success(
      t('plugin.pa.batch.summary', {
        defaultValue: '成功 {{success}} 项，失败 {{failure}} 项',
        success,
        failure,
      }),
    )
  }, [selectedIds, selectedPlugins, runBatch, clearSelection, t, setPlugins, setLoaded])

  // Handle plugin update from marketplace
  const handleUpdatePlugin = useCallback(async (plugin: PluginDefinition) => {
    // Find update info from market updates
    const updateInfo = marketUpdates.find((u) => u.id === plugin.id && u.localVersion !== u.remoteVersion)
    if (!updateInfo) {
      toast.error(t('plugin.noUpdateAvailable', { defaultValue: 'No update available' }))
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
              onUninstall={handleUninstall}
              onUpdate={handleUpdatePlugin}
              onSettings={openSettings}
              onPermissions={openPermissions}
              onStorage={openStorage}
              // ── G7 batch operations wiring ──
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
              onSelectAll={selectAllVisible}
              onClearSelection={clearSelection}
              onBatchEnable={() => void handleBatchEnable()}
              onBatchDisable={() => void handleBatchDisable()}
              onBatchUninstall={() => void handleBatchUninstall()}
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

      {/* ── Three plugin popups (Activity / Diagnostics / Logs) ── */}
      <Suspense fallback={null}>
        <PluginActivityDialog
          open={openDialog === 'activity'}
          onOpenChange={(o: boolean) => setOpenDialog(o ? 'activity' : null)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <PluginDiagnosticsDialog
          open={openDialog === 'diagnostics'}
          onOpenChange={(o: boolean) => setOpenDialog(o ? 'diagnostics' : null)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <PluginLogsDialog
          open={openDialog === 'logs'}
          onOpenChange={(o: boolean) => setOpenDialog(o ? 'logs' : null)}
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

      {/* ── Load-failures dialog (Task 2 / G2) ────────
            Opened from the top-of-page warning banner. The
            dialog owns its own confirm/uninstall state but
            delegates the "View logs" action to the manager
            so we reuse the same `openDialog === 'logs'`
            slot that the rail button already populates —
            no second logs instance. Lazy chunk so users
            who never see a failure don't pay for the
            dialog's tauri bridge bundle. */}
      <Suspense fallback={null}>
        <PluginLoadFailuresDialog
          open={failuresDialogOpen}
          onOpenChange={setFailuresDialogOpen}
          onViewLogs={() => setOpenDialog('logs')}
        />
      </Suspense>
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
  onPermissions: (plugin: PluginDefinition) => void
  /**
   * Open the per-plugin storage inspector (Task 6 / G6).
   * Required because every installed card now has a "Storage"
   * icon button; the manager view owns the dialog state so a
   * user can still open the inspector while the bulk-select
   * mode is active.
   */
  onStorage: (plugin: PluginDefinition) => void
  // ── G7 batch operations (Task 7.1–7.5) ──
  /** Set of currently selected plugin ids. */
  selectedIds: Set<string>
  /** Toggle one row's membership in the selection set. */
  onToggleSelect: (id: string, next: boolean) => void
  /**
   * Toggle the membership of *all currently visible* rows.
   * Toolbar checkbox drives this; the parent decides whether
   * to add or remove based on the "all visible already
   * selected" check.
   */
  onSelectAll: (next: boolean) => void
  /** Clear the selection (called after a batch finishes or
   *  when the user clicks the X in the batch bar). */
  onClearSelection: () => void
  onBatchEnable: () => void
  onBatchDisable: () => void
  onBatchUninstall: () => void
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
  onPermissions,
  onStorage,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBatchEnable,
  onBatchDisable,
  onBatchUninstall,
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
        {/* ── Select-all checkbox (G7) ─────────────────────
            Sits at the very left of the toolbar so it's the
            first thing the user sees. The three-state logic
            (checked / unchecked / indeterminate) is derived
            purely from `visiblePlugins` and `selectedIds`,
            so the parent doesn't have to track a separate
            "indeterminate" flag. We compute the truthy
            value at render time and pass it to the native
            input's `checked` + `ref`-driven `indeterminate`
            property. */}
        <BatchSelectAll
          visiblePlugins={visiblePlugins}
          selectedIds={selectedIds}
          onSelectAll={onSelectAll}
        />
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

      {/* ── Batch action bar (G7.3) ───────────────────────
           Rendered only when the user has at least one row
           selected. Stays in the document flow (not
           `position: sticky`) so it pushes the grid down
           rather than overlapping it — the grid is its own
           scroll container and a sticky overlay would be
           cropped at the wrong edge. Three buttons:
           enable / disable / uninstall, plus a count
           summary and a clear (×) button. The bar uses the
           existing `.pa-btn` / `.pa-btn-ghost` styles so it
           blends in with the toolbar above. */}
      {selectedIds.size > 0 && (
        <BatchActionBar
          count={selectedIds.size}
          onEnable={onBatchEnable}
          onDisable={onBatchDisable}
          onUninstall={onBatchUninstall}
          onClear={onClearSelection}
        />
      )}

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
                selected={selectedIds.has(plugin.id)}
                onSelectChange={(next) => onToggleSelect(plugin.id, next)}
                onToggle={(enabled: boolean) => onToggle(plugin, enabled)}
                onUninstall={() => onUninstall(plugin)}
                onUpdate={onUpdate ? () => onUpdate(plugin) : undefined}
                onSettings={() => onSettings(plugin)}
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

/**
 * Toolbar select-all checkbox (G7.3). A native `<input
 * type="checkbox">` is good enough here — the visual is a
 * 14×14 checkbox, the only state we need is the
 * indeterminate flag (some-but-not-all visible rows
 * selected), and that's a property on the DOM input that
 * React doesn't track in props. We compute the "indeterminate"
 * flag at render time and write it via a ref to the DOM node.
 *
 * The "all visible" anchor matches the rows the user can see
 * in the grid; clicking the checkbox adds *every* visible
 * row to the set, or removes all of them. Selected rows that
 * are currently hidden by the filter are left untouched.
 */
function BatchSelectAll({
  visiblePlugins,
  selectedIds,
  onSelectAll,
}: {
  visiblePlugins: PluginDefinition[]
  selectedIds: Set<string>
  onSelectAll: (next: boolean) => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  // Derive the three states from the visible rows + the
  // current selection. We compare membership one-by-one
  // instead of using `every` / `some` with the same predicate
  // because we need the "mixed" case (some yes, some no) to
  // render as indeterminate.
  const visibleCount = visiblePlugins.length
  let selectedVisible = 0
  for (const p of visiblePlugins) {
    if (selectedIds.has(p.id)) selectedVisible += 1
  }
  const allSelected = visibleCount > 0 && selectedVisible === visibleCount
  const noneSelected = selectedVisible === 0
  // The DOM `indeterminate` property is not a React prop, so
  // we drive it through a ref. The effect re-fires whenever
  // the derived state changes.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !allSelected && !noneSelected
    }
  }, [allSelected, noneSelected])
  // Clicking the checkbox when fully selected removes the
  // visible rows; otherwise (none or partial) it adds them
  // all. This matches the standard "tri-state checkbox"
  // behaviour in macOS Finder, Gmail, etc.
  const handleClick = () => {
    onSelectAll(!allSelected)
  }
  return (
    <label
      className="pa-select-all"
      title={t('plugin.pa.batch.selectAllTitle', {
        defaultValue: 'Select all visible plugins',
      })}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={allSelected}
        // We don't need `onChange` — `onClick` is enough to
        // capture the user's intent before the browser
        // toggles the checkbox's internal `checked` (which
        // we override via the ref above on the next render).
        onClick={handleClick}
        // Read-only: suppress the warning about a controlled
        // checkbox without an onChange handler.
        readOnly
        aria-label={t('plugin.pa.batch.selectAll', { defaultValue: 'Select all' })}
      />
      <span className="pa-select-all-text">
        {t('plugin.pa.batch.selected', {
          defaultValue: '已选 {{count}}',
          count: selectedIds.size,
        })}
      </span>
    </label>
  )
}

/**
 * Batch action bar (G7.3). Renders below the toolbar when at
 * least one row is selected. Three primary actions
 * (enable / disable / uninstall) plus a count summary on the
 * left and a "×" clear button on the right. The styling
 * reuses the existing `.pa-btn` button family plus a new
 * `.pa-batch-bar` container that gives the bar a soft
 * accent-tinted background so it stands out as a transient
 * mode of interaction.
 */
function BatchActionBar({
  count,
  onEnable,
  onDisable,
  onUninstall,
  onClear,
}: {
  count: number
  onEnable: () => void
  onDisable: () => void
  onUninstall: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="pa-batch-bar" role="toolbar" aria-label={t('plugin.pa.batch.barAria', { defaultValue: 'Batch actions' })}>
      <span className="pa-batch-count">
        {t('plugin.pa.batch.selectedCount', {
          defaultValue: '已选 {{count}} 项',
          count,
        })}
      </span>
      <div className="pa-batch-actions">
        <button
          type="button"
          className="pa-btn"
          onClick={onEnable}
          title={t('plugin.pa.batch.enableTitle', { defaultValue: 'Enable selected plugins' })}
        >
          <Power size={12} />
          {t('plugin.pa.batch.enable', { defaultValue: '启用' })}
        </button>
        <button
          type="button"
          className="pa-btn"
          onClick={onDisable}
          title={t('plugin.pa.batch.disableTitle', { defaultValue: 'Disable selected plugins' })}
        >
          <PowerOff size={12} />
          {t('plugin.pa.batch.disable', { defaultValue: '禁用' })}
        </button>
        <button
          type="button"
          className="pa-btn pa-btn-danger"
          onClick={onUninstall}
          title={t('plugin.pa.batch.uninstallTitle', { defaultValue: 'Uninstall selected plugins' })}
        >
          <Trash2 size={12} />
          {t('plugin.pa.batch.uninstall', { defaultValue: '卸载' })}
        </button>
      </div>
      <button
        type="button"
        className="pa-btn pa-btn-ghost pa-btn-icon"
        onClick={onClear}
        title={t('plugin.pa.batch.clear', { defaultValue: 'Clear selection' })}
        aria-label={t('plugin.pa.batch.clear', { defaultValue: 'Clear selection' })}
      >
        <X size={14} />
      </button>
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

export { PluginManagerView }
