/**
 * Plugin Store - Manages plugin registration, loading, and state
 */
import { create } from 'zustand'
import type {
  PluginDefinition,
  PluginLoadFailure,
  PluginRegistry,
  IconPosition,
  ContentPosition,
} from '@/types/plugin'
import { emptyRegistry } from '@/types/plugin'
import { useUIStore } from './ui'
import { dropPluginStorage, pluginEventBus, buildPluginContext } from '@/lib/plugin-host'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'
import { clearPluginCommands } from '@/lib/plugin-commands'
import { clearGranted } from '@/lib/plugin-permission-guard'
import {
  detectPluginConflicts,
  type PluginConflict,
} from '@/lib/plugin-conflicts'
import { clearPluginMetrics, recordPluginConflict } from '@/lib/plugin-telemetry'

/**
 * localStorage key prefix for the per-plugin "auto-update"
 * opt-in (Task 11 / G11). Mirrors the permission-store
 * pattern (`plugin_permissions_<id>`) so a future "export all
 * plugin settings" sweep can iterate both namespaces with a
 * single `Object.keys(localStorage)` filter. The flag is
 * strictly opt-in: a missing key reads as `false`, never
 * `true`.
 */
export const PLUGIN_AUTO_UPDATE_KEY_PREFIX = 'plugin_auto_update_'

/**
 * Health status of a plugin, surfaced as a coloured badge in
 * `PluginInstalledCard` and consumed by the health monitor in
 * `plugin-host-takeover.ts`.
 *
 * - `healthy`   Hooks have completed within their timeout window.
 * - `unhealthy` A hook exceeded its timeout; the plugin was
 *               auto-disabled by the host. The diagnostics popup
 *               and the card error bar read this and surface the
 *               cached `lastError` from `plugin-telemetry`.
 * - `unknown`   Plugin is registered but no hook has completed
 *               (yet). Useful for newly-registered plugins that
 *               haven't finished their first onLoad; the UI shows
 *               a neutral badge.
 */
export type PluginHealth = 'healthy' | 'unhealthy' | 'unknown'

export interface PluginState {
  /** All registered plugins, indexed by iconPosition */
  registry: PluginRegistry
  /** Flat list of all plugins (for management page) */
  plugins: PluginDefinition[]
  /**
   * Per-plugin load failures surfaced by `loadAllPlugins`. Keyed by
   * plugin id so the banner UI can render without scanning a list.
   * Empty when the last load was clean. See
   * `.trae/specs/plugin-management-gap-analysis/spec.md` (G2).
   */
  loadFailures: Record<string, PluginLoadFailure>
  /** Whether plugins have been loaded from disk */
  loaded: boolean
  /**
   * Mirror of the active plugin id for each content position. Authoritative
   * truth still lives in useUIStore (`sidebarView` for leftPanel / fullPanel
   * / editorArea, `rightPanelType` for rightPanel). These fields exist as
   * a plugin-scoped view of that state so external consumers (and tests)
   * can subscribe to plugin activation without coupling to the UI store.
   * Keep them in sync with the UI store via `setActivePlugin`.
   */
  activeLeftPanelPluginId: string | null
  activeRightPanelPluginId: string | null
  activeFullPanelPluginId: string | null
  activeEditorAreaPluginId: string | null
  /**
   * Per-plugin health status, keyed by plugin id. The
   * `plugin-host-takeover` health monitor writes here when a
   * lifecycle hook times out, and the UI subscribes via
   * `useShallow` selectors (see `PluginInstalledCard`) so a
   * single plugin's badge change doesn't re-render the whole
   * grid. Missing entries are treated as `unknown` by
   * `getPluginHealth` so the UI never has to special-case
   * "never set".
   */
  pluginHealth: Record<string, PluginHealth>
  /**
   * Per-plugin conflict list (Task 13 / G13). Keyed by plugin id;
   * each value is the subset of `PluginConflict` records that
   * include this id. A plugin with no conflicts has an empty
   * array (the entry may also be absent, in which case
   * `getPluginConflicts` returns `[]` for symmetry with
   * `getPluginHealth`). Cached here so the conflict scan runs
   * once per registry refresh — `setPlugins`,
   * `registerPlugin(s)`, `unregisterPlugin`, and
   * `setPluginEnabled` all call `recomputeConflicts` to keep
   * the map in sync. The card UI uses
   * `getPluginConflicts(id).length > 0` to decide whether to
   * render the conflict badge.
   */
  pluginConflicts: Record<string, PluginConflict[]>
  /**
   * Per-plugin "auto-update" opt-in (Task 11 / G11). The
   * authoritative copy is persisted to `localStorage` under
   * `plugin_auto_update_<id>` and is hydrated back into this
   * record on app start. The map is keyed by plugin id so a
   * single toggle in the installed-card fires an O(1)
   * `getPluginAutoUpdate(id)` lookup.
   *
   * Plugins with no entry in this map are treated as
   * `autoUpdate: false` — the feature is strictly opt-in.
   */
  pluginAutoUpdate: Record<string, boolean>

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Register a single plugin */
  registerPlugin: (plugin: PluginDefinition) => void
  /** Register multiple plugins at once */
  registerPlugins: (plugins: PluginDefinition[]) => void
  /** Set the active plugin for a given content position */
  setActivePlugin: (
    id: string | null,
    position: 'leftPanel' | 'rightPanel' | 'fullPanel' | 'editorArea'
  ) => void
  /** Unregister a plugin by id */
  unregisterPlugin: (id: string) => void
  /** Enable/disable a plugin */
  setPluginEnabled: (id: string, enabled: boolean) => void
  /** Replace the entire plugin list (e.g. after re-scan) */
  setPlugins: (plugins: PluginDefinition[]) => void
  /** Mark plugins as loaded */
  setLoaded: (loaded: boolean) => void
  /** Update a plugin's health status. Called by the health monitor
   *  in `plugin-host-takeover.ts` on hook timeout, and by the
   *  hook's success path via `markPluginHealthy` in telemetry. */
  setPluginHealth: (id: string, health: PluginHealth) => void

  /**
   * Replace the load-failure map wholesale. Called from
   * `loadAllPlugins` callers after a rescan. A plugin that
   * *successfully* loaded in the same scan is automatically
   * removed from the failure map (its key disappears), so the
   * banner stays consistent with the on-disk state without
   * requiring a separate `clearLoadFailure` call from the loader.
   */
  setLoadFailures: (failures: PluginLoadFailure[]) => void
  /**
   * Drop a single plugin from the load-failure map. Used after
   * the user uninstalls a broken plugin (we want the banner to
   * vanish immediately, before the next rescan lands).
   */
  clearLoadFailure: (id: string) => void
  /**
   * Drop *all* entries from the load-failure map. Used when the
   * user dismisses the banner without taking an action, so a
   * later failure is the only thing that re-surfaces it.
   */
  clearLoadFailures: () => void

  /**
   * Toggle (or set) a plugin's "auto-update" opt-in (Task 11 /
   * G11). The value is persisted to `localStorage` under
   * `plugin_auto_update_<id>` so the toggle survives app
   * restarts. The store also mirrors the flag onto the
   * matching `PluginDefinition` (if it exists in `plugins`)
   * so the installed-card toggle can render synchronously
   * from the definition alone.
   */
  setPluginAutoUpdate: (id: string, enabled: boolean) => void
  /**
   * Hydrate the `pluginAutoUpdate` map from `localStorage`.
   * Called once on app start (after the plugin list has
   * been scanned) so a plugin that opted in to auto-update
   * on a previous run is picked up immediately by the
   * background `runAutoUpdateOnStartup` chain.
   */
  hydratePluginAutoUpdate: (record: Record<string, boolean>) => void
  /**
   * Drop a plugin's "auto-update" opt-in. Used by the
   * uninstall path so a reinstalled plugin with the same
   * id doesn't inherit a stale preference.
   */
  clearPluginAutoUpdate: (id: string) => void

  /** Get a plugin by id */
  getPluginById: (id: string) => PluginDefinition | undefined
  /** Get a plugin's health status, defaulting to 'unknown' when
   *  no record exists (plugin registered but no hook has completed
   *  yet). This is the "derived" getter the UI uses so the
   *  selector result is always a string – no need to special-case
   *  `undefined`. */
  getPluginHealth: (id: string) => PluginHealth
  /**
   * Get the list of conflicts a plugin is part of, defaulting to
   * an empty array when the plugin has no conflicts (or isn't
   * registered). The card UI checks `length > 0` to decide
   * whether to render the conflict badge. The returned array is
   * a fresh slice (never the cached reference) so callers can
   * `.map()` / `.filter()` without mutating the cache.
   */
  getPluginConflicts: (id: string) => PluginConflict[]
  /**
   * Get a plugin's "auto-update" opt-in, defaulting to
   * `false` when no record exists. The default is the
   * *opposite* of the "auto-update" feature's "fail-open"
   * semantics: a missing entry must NOT silently enable
   * auto-update; the user has to opt in explicitly.
   */
  getPluginAutoUpdate: (id: string) => boolean
  /** Get plugins by iconPosition */
  getPluginsByIconPosition: (position: IconPosition) => PluginDefinition[]
  /** Get plugins by contentPosition */
  getPluginsByContentPosition: (position: ContentPosition) => PluginDefinition[]
  /** Get all sidebar-positioned plugins (for ActivityBar), sorted by order */
  getSidebarPlugins: () => PluginDefinition[]
  /** Get all editorToolbar-positioned plugins, sorted by order */
  getEditorToolbarPlugins: () => PluginDefinition[]
  /** Get all titleBar-positioned plugins, sorted by order */
  getTitleBarPlugins: () => PluginDefinition[]
}

const sortByOrder = <T extends { order?: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

/**
 * Return a new record with `key` removed. Pure helper – used
 * for the per-plugin `pluginHealth` map to keep unregister paths
 * allocation-light while still creating a fresh object so
 * Zustand's shallow equality detects the change.
 */
function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  if (!(key in record)) return record
  const next: Record<string, V> = {}
  for (const k of Object.keys(record)) {
    if (k !== key) next[k] = record[k]
  }
  return next
}

/**
 * Shallow equality check for `Record<string, PluginLoadFailure>`.
 * Used by `setLoadFailures` to skip `set()` when the new scan
 * produced the exact same failure snapshot (e.g. user just
 * clicked "Refresh" without anything on disk changing), so the
 * banner doesn't re-render on every rescan.
 */
function isLoadFailureMapEqual(
  a: Record<string, PluginLoadFailure>,
  b: Record<string, PluginLoadFailure>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false
  }
  return true
}

/** Rebuild the registry from a flat plugin list */
function buildRegistry(plugins: PluginDefinition[]): PluginRegistry {
  const registry: PluginRegistry = { sidebar: [], editorToolbar: [], titleBar: [] }
  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    const key = plugin.iconPosition
    if (key in registry) {
      registry[key].push(plugin)
    } else {
      console.warn(`[PluginStore] Plugin ${plugin.id} has unknown iconPosition: "${key}"`)
    }
  }
  return registry
}

/**
 * Run the conflict detector (Task 13 / G13) over `plugins` and
 * build a per-plugin `Record<id, PluginConflict[]>` map. The
 * detector is pure and O(3N), so calling it on every mutation
 * stays well under 1ms for the largest install set we expect
 * (~200 plugins). The map is keyed only by plugins that appear
 * in at least one conflict — readers use `getPluginConflicts(id)`
 * which falls back to `[]` for missing keys (matching the
 * `getPluginHealth` pattern).
 *
 * `precomputed` (optional) lets callers that already ran the
 * detector (e.g. `setPlugins` which also feeds the result into
 * `recordPluginConflict`) pass the array through instead of
 * running the scan a second time. The argument is intentionally
 * untyped at the boundary to keep the helper self-contained —
 * a non-array just falls through to the in-line scan.
 */
function buildConflictMap(
  plugins: readonly PluginDefinition[],
  precomputed?: readonly PluginConflict[],
): Record<string, PluginConflict[]> {
  const conflicts = Array.isArray(precomputed)
    ? (precomputed as PluginConflict[])
    : detectPluginConflicts(plugins)
  const map: Record<string, PluginConflict[]> = {}
  for (const c of conflicts) {
    for (const id of c.peerIds) {
      let bucket = map[id]
      if (!bucket) {
        bucket = []
        map[id] = bucket
      }
      bucket.push(c)
    }
  }
  return map
}

export const usePluginStore = create<PluginState>((set, get) => ({
  registry: { ...emptyRegistry },
  plugins: [],
  loadFailures: {},
  loaded: false,
  activeLeftPanelPluginId: null,
  activeRightPanelPluginId: null,
  activeFullPanelPluginId: null,
  activeEditorAreaPluginId: null,
  pluginHealth: {},
  pluginAutoUpdate: {},
  pluginConflicts: {},

  registerPlugin: (plugin) => {
    set((state) => {
      if (state.plugins.some((p) => p.id === plugin.id)) return state
      const plugins = [...state.plugins, plugin]
      // Task 13 / G13: rebuild the conflict map so the new
      // plugin's collisions (if any) surface immediately in the
      // card badge. We re-run the full scan rather than try
      // to splice a single conflict into the existing map —
      // the scan is O(3N) and stays well under 1ms even for
      // 200 plugins, and a "splice" would have to know which
      // of the three conflict kinds the new plugin could
      // trigger (iconSlot? contentPosition? commandPalette?).
      return {
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      }
    })
    // Fire onLoad after the plugin is in the registry so the hook can
    // safely call getPluginById, subscribe to events, or read storage.
    // We invoke it asynchronously (fire-and-forget) so a slow hook
    // never blocks registration.
    //
    // `runPluginLifecycleHook` (vs raw `runLifecycleHook`) installs
    // the SDK host takeover for the hook's duration – every
    // SDK function the hook touches (`getPluginStorage`,
    // `registerContextMenu`, etc.) hits the host's real,
    // permission-checked implementation. See plugin-host-takeover.ts
    // for the concurrency contract.
    void runPluginLifecycleHook(
      plugin,
      plugin.hooks?.onLoad,
      buildPluginContext(plugin),
      'onLoad'
    )
  },

  registerPlugins: (newPlugins) => {
    // Compute the diff *before* the `set()` callback so we can fire
    // onLoad for the same set we actually inserted. The previous
    // implementation re-derived `currentIds` *after* `set()` and
    // asked "is the plugin in the store?" — but that returns true
    // for **every** plugin in the store, including pre-existing
    // ones, so passing `[A, B]` where A is already registered
    // caused A's onLoad to fire a second time. The diff is now
    // captured locally and used as the sole onLoad trigger.
    const state = get()
    const existingIds = new Set(state.plugins.map((p) => p.id))
    const added = newPlugins.filter((p) => !existingIds.has(p.id))
    if (added.length > 0) {
      const plugins = [...state.plugins, ...added]
      // Task 13 / G13: rebuild the conflict map alongside
      // the registry so any collision the new entries cause
      // is reflected in the per-plugin badge immediately.
      set({
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      })
    }
    for (const plugin of added) {
      void runPluginLifecycleHook(
        plugin,
        plugin.hooks?.onLoad,
        buildPluginContext(plugin),
        'onLoad'
      )
    }
  },

  setActivePlugin: (id, position) => {
    set((state) => {
      switch (position) {
        case 'leftPanel':
          if (state.activeLeftPanelPluginId === id) return state
          return { activeLeftPanelPluginId: id }
        case 'rightPanel':
          if (state.activeRightPanelPluginId === id) return state
          return { activeRightPanelPluginId: id }
        case 'fullPanel':
          if (state.activeFullPanelPluginId === id) return state
          return { activeFullPanelPluginId: id }
        case 'editorArea':
          if (state.activeEditorAreaPluginId === id) return state
          return { activeEditorAreaPluginId: id }
        default:
          return state
      }
    })
    // For leftPanel / fullPanel / editorArea, the UI's sidebarView doubles
    // as the "which plugin view is selected" pointer. Keep them in sync
    // so any consumer of either value sees the same plugin. When id is
    // null we reset to the default explorer view, which fixes the
    // "ActivityBar/TitleBar hides sidebar but sidebarView is stale"
    // regression introduced when we added this cross-store coupling.
    if (position === 'leftPanel' || position === 'fullPanel' || position === 'editorArea') {
      const ui = useUIStore.getState()
      const nextView = (id !== null ? `plugin:${id}` : 'explorer') as Parameters<typeof ui.setSidebarView>[0]
      if (ui.sidebarView !== nextView) {
        ui.setSidebarView(nextView)
      }
    }
  },

  unregisterPlugin: (id) => {
    // Capture the plugin reference before the set() call removes it
    // from the list, so we can fire onUnload on the same instance.
    const target = get().plugins.find((p) => p.id === id)
    set((state) => {
      const plugins = state.plugins.filter((p) => p.id !== id)
      const updates: Partial<PluginState> = {
        plugins,
        registry: buildRegistry(plugins),
        // Drop the per-plugin health record so a reinstall of the
        // same id starts from a clean slate (no stale "unhealthy"
        // badge carried over from a previously-removed install).
        pluginHealth: omitKey(state.pluginHealth, id),
        // Also drop the per-plugin load-failure record. If the
        // user uninstalls a broken plugin we want the banner to
        // vanish immediately, not linger until the next rescan.
        loadFailures: omitKey(state.loadFailures, id),
        // Drop the per-plugin auto-update opt-in (Task 11 /
        // G11). The localStorage entry is removed in the
        // post-set side-effect below so a reinstall of the
        // same id never inherits a stale preference.
        pluginAutoUpdate: omitKey(state.pluginAutoUpdate, id),
        // Task 13 / G13: rebuild the conflict map so any
        // collision the removed plugin *resolved* (e.g. two
        // sidebar plugins, the user uninstalled one) clears
        // out of the remaining plugin's badge list. We re-run
        // the full scan — the cost is negligible and a splice
        // would have to walk every peer's `peerIds` list.
        pluginConflicts: buildConflictMap(plugins),
      }
      if (state.activeLeftPanelPluginId === id) updates.activeLeftPanelPluginId = null
      if (state.activeRightPanelPluginId === id) updates.activeRightPanelPluginId = null
      if (state.activeFullPanelPluginId === id) updates.activeFullPanelPluginId = null
      if (state.activeEditorAreaPluginId === id) updates.activeEditorAreaPluginId = null
      return updates
    })
    // Synchronously clean up UI state that referenced the removed plugin
    // so that downstream renders don't briefly show stale views. We only
    // hide the fullPanel surface when the removed plugin was actually the
    // current one – otherwise we'd clobber a different fullPanel plugin
    // the user is currently browsing.
    const ui = useUIStore.getState()
    if (ui.sidebarView === `plugin:${id}`) {
      ui.setSidebarView('explorer')
      if (ui.settingsPanelVisible) {
        ui.setSettingsPanelVisible(false)
      }
    }
    if (ui.rightPanelType === `plugin:${id}`) {
      ui.setRightPanelType(null)
    }
    // Fire onUnload (after the plugin is fully detached) and drop
    // the cached PluginStorage so a future reinstall starts clean.
    if (target) {
      void runPluginLifecycleHook(
        target,
        target.hooks?.onUnload,
        buildPluginContext(target),
        'onUnload'
      )
    }
    dropPluginStorage(id)
    // Remove all event handlers registered by this plugin so stale
    // subscriptions don't fire after the plugin is gone (especially
    // important when the plugin failed to load and its useEffect
    // cleanup never ran).
    pluginEventBus.removeAllListenersForPlugin(id)
    // Drop any context-menu items this plugin contributed so they
    // don't linger after the plugin is gone. Clear before running
    // onUnload so the plugin's own tear-down logic can't see stale
    // items referenced by id.
    clearPluginMenuItems(id)
    // Wave A / C2: drop the plugin's command-palette entries
    // so a freshly-removed plugin can't be triggered via the
    // palette (or via its bound shortcut). Mirrors the
    // `setPlugins` diff path (which also calls
    // `clearPluginCommands(target.id)` after
    // `clearPluginMenuItems`) so both code paths converge to
    // the same "fully detached" contract: storage cache, event
    // bus, menu items, command palette, permissions, metrics,
    // and shortcut bindings are all gone by the time
    // `unregisterPlugin` returns. Ordering matches
    // `setPlugins` (menu items → commands → metrics) so a
    // future "diff" audit can read the two paths side by side.
    clearPluginCommands(id)
    // Drop the plugin's persisted permissions (localStorage key +
    // in-memory guard). We do this last so a revoke UI that is
    // observing the plugin's grants still has a coherent snapshot
    // until the unregister call returns. The synchronous
    // `clearGranted` is the security boundary — it stops the
    // in-memory grant cache from leaking to a reinstall with the
    // same id before the localStorage removeItem lands. The async
    // `dropPluginPermissions` is the on-disk cleanup pass.
    clearGranted(id)
    void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
      void dropPluginPermissions(id)
    })
    // Task 11 / G11: drop the persisted auto-update opt-in
    // so a reinstall of the same id starts with the
    // feature disabled (the user has to re-opt in). Best-
    // effort — a localStorage write failure is silently
    // ignored because the in-memory map has already been
    // pruned above.
    try {
      window.localStorage.removeItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${id}`)
    } catch {
      /* ignore */
    }
    // Fourth-round review / M7: drop the plugin's
    // telemetry ring-buffer entries (events, storage,
    // hooks, ipc), the storage-size map, and the cached
    // "last error" entry. The host's other cleanup paths
    // (storage cache, event bus, menu items, command
    // palette, permissions) all already fire above; the
    // four ring buffers were the only holders of
    // long-lived state that survived an uninstall. A
    // reinstall of the same id therefore starts with a
    // blank telemetry snapshot, matching the
    // `unregisterPlugin` post-set contract of "fully
    // detached".
    clearPluginMetrics(id)
    // Fourth-round review / M8: prune any plugin-command
    // shortcut the user bound to this plugin. Without
    // this, the binding stays in `useUIStore`'s
    // `pluginCommandShortcuts` map (and in the persisted
    // app settings) indefinitely. We pass the
    // post-set valid id set — even though we just removed
    // a single id, we go through the same `prune` path
    // that `setPlugins` does so the persisted payload
    // stays in sync with what's reachable from the
    // current `plugins` list.
    const remainingIds = new Set(get().plugins.map((p) => p.id))
    useUIStore.getState().prunePluginCommandShortcuts(remainingIds)
  },

  setPluginEnabled: (id, enabled) => {
    // Capture pre-state to know which transition we're on (true→false
    // means call onDisable, false→true means call onEnable).
    const target = get().plugins.find((p) => p.id === id)
    const wasEnabled = target?.enabled ?? false
    if (!target) {
      // setPluginEnabled is called from the plugin manager's toggle
      // UI and from Rust-driven health-monitor auto-disable. Both
      // paths assume the plugin still exists; if it doesn't, log
      // loudly so we can trace the orphan call instead of failing
      // silently and leaving the registry out of sync with disk.
      console.warn(`[plugin-store] setPluginEnabled: plugin "${id}" not found in registry`)
      return
    }
    set((state) => {
      const plugins = state.plugins.map((p) =>
        p.id === id ? { ...p, enabled } : p
      )
      // Task 13 / G13: re-run the conflict scan. Disabling a
      // plugin removes it from every conflict group; enabling
      // it can re-attach it to a slot. The scan is O(3N) and
      // cheap enough to run inline here.
      return {
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      }
    })
    if (wasEnabled !== enabled) {
      // When re-enabling a previously disabled plugin, fire onLoad
      // before onEnable. The lifecycle model is onLoad → onEnable,
      // and a plugin that was disabled on cold start skipped onLoad
      // (see `setPlugins`). Without this, the plugin's event
      // subscriptions, storage seeding, and timers never run.
      if (enabled && !wasEnabled) {
        void runPluginLifecycleHook(target, target.hooks?.onLoad, buildPluginContext(target), 'onLoad')
      }
      const hook = enabled ? target.hooks?.onEnable : target.hooks?.onDisable
      const hookName = enabled ? 'onEnable' : 'onDisable'
      void runPluginLifecycleHook(target, hook, buildPluginContext(target), hookName)
    }
  },

  setPlugins: (plugins) => {
    // Diff against the current list BEFORE we replace it. Anything
    // that disappears needs its per-plugin resources cleaned up
    // (storage cache, context-menu contributions, permissions) and
    // its `onUnload` hook fired. Anything that appears needs its
    // `onLoad` hook fired. Skipping both halves would let:
    //
    //   - a plugin removed via the file system (or via the
    //     marketplace uninstall path) leave behind stale storage
    //     cache, menu items, a localStorage permissions entry, and
    //     an `onUnload` that never got called
    //   - a freshly-installed plugin start with its event
    //     subscriptions, storage seeding, and lifecycle timers
    //     never running — the install *succeeded* but the plugin
    //     was never *started*
    //
    // We can't call `unregisterPlugin` / `registerPlugin` here
    // because they each do their own `set()`, which would either
    // race with our atomic replacement (registerPlugin's set
    // happens AFTER ours) or briefly drop the rest of the list
    // (unregisterPlugin's set happens BEFORE ours). Instead we
    // re-implement the lifecycle fire inline so the list is
    // written exactly once and the hooks see the *correct*
    // pre-/post-set plugin references.
    //
    // Dedupe: if the caller accidentally passes a list with the
    // same plugin id twice, the `added` filter below would only
    // catch the *first* occurrence of the duplicate and silently
    // drop the rest. Detect duplicates up front and warn so the
    // call site can be fixed, while still using a deterministic
    // "last wins" merge of the kept entries.
    const seen = new Set<string>()
    const deduped: typeof plugins = []
    for (const p of plugins) {
      if (seen.has(p.id)) {
        console.warn(
          `[plugin-store] setPlugins received duplicate id "${p.id}", keeping the last occurrence`,
        )
        // Replace the prior kept entry with this later one so
        // the "last wins" semantics are well-defined.
        const idx = deduped.findIndex((q) => q.id === p.id)
        if (idx >= 0) deduped[idx] = p
        continue
      }
      seen.add(p.id)
      deduped.push(p)
    }
    const state = get()
    const oldIds = new Set(state.plugins.map((p) => p.id))
    const newIds = new Set(deduped.map((p) => p.id))
    const removed = state.plugins.filter((p) => !newIds.has(p.id))
    const added = deduped.filter((p) => !oldIds.has(p.id))

    // Build active-state updates for removed plugins (same logic as
    // `unregisterPlugin`). Without this, a plugin removed via
    // `setPlugins` (e.g. after a marketplace uninstall + rescan)
    // leaves stale IDs in the active-plugin fields and the UI store's
    // sidebarView / rightPanelType pointing at a non-existent plugin.
    const activeUpdates: Partial<PluginState> = {}
    for (const target of removed) {
      if (state.activeLeftPanelPluginId === target.id) activeUpdates.activeLeftPanelPluginId = null
      if (state.activeRightPanelPluginId === target.id) activeUpdates.activeRightPanelPluginId = null
      if (state.activeFullPanelPluginId === target.id) activeUpdates.activeFullPanelPluginId = null
      if (state.activeEditorAreaPluginId === target.id) activeUpdates.activeEditorAreaPluginId = null
    }
    // Strip the per-plugin health record for each removed plugin.
    // Computing this in a single pass keeps the `set()` below to
    // exactly one update.
    let nextHealth = state.pluginHealth
    for (const target of removed) {
      if (Object.prototype.hasOwnProperty.call(nextHealth, target.id)) {
        nextHealth = omitKey(nextHealth, target.id)
      }
    }
    // Fourth-round review / M6: also strip the per-plugin
    // load-failure record and the per-plugin auto-update
    // opt-in for every removed plugin. Without this, a
    // marketplace-driven uninstall leaves the *preference*
    // behind even though the plugin is gone — a
    // reinstall of the same id would silently inherit a
    // "true" opt-in the user never re-confirmed. The
    // `localStorage` keys for the auto-update opt-in are
    // removed in the post-set side-effect below so the
    // in-memory map and the on-disk store can't drift.
    let nextLoadFailures = state.loadFailures
    let nextAutoUpdate = state.pluginAutoUpdate
    for (const target of removed) {
      if (Object.prototype.hasOwnProperty.call(nextLoadFailures, target.id)) {
        nextLoadFailures = omitKey(nextLoadFailures, target.id)
      }
      if (Object.prototype.hasOwnProperty.call(nextAutoUpdate, target.id)) {
        nextAutoUpdate = omitKey(nextAutoUpdate, target.id)
      }
    }
    // Task 11 / G11: re-mirror the per-plugin auto-update
    // opt-in onto the new plugin definitions. After a
    // rescan the loader's `loadAllPlugins` returns fresh
    // `PluginDefinition` objects that don't carry the
    // `autoUpdate` flag (the flag is a *user preference*
    // and lives in the store, not on the manifest), so
    // we'd lose the toggle state on every rescan unless
    // we copy it back here. We honour the in-memory
    // record (which was hydrated from localStorage on
    // app start) — a plugin the user opted in to keeps
    // its opt-in across a marketplace-driven rescan.
    const withAutoUpdate = deduped.map((p) =>
      state.pluginAutoUpdate[p.id] === true
        ? { ...p, autoUpdate: true }
        : p,
    )
    // Task 13 / G13: re-run the conflict scan on the
    // post-mirror plugin list. `setPlugins` is the canonical
    // "full refresh" entry point (called by
    // `PluginManagerView.handleReload` after a rescan), so
    // this is where the per-plugin badge / Logs popup group
    // is brought in sync with the on-disk state. We also
    // emit one telemetry line per conflict below so the
    // "Logs" popup can render a "⚠️ Conflict" group
    // immediately on first open.
    //
    // Fourth-round review / M9: the previous code path
    // called `detectPluginConflicts` twice — once inside
    // `buildConflictMap` and once again in the
    // `recordPluginConflict` loop. The detector is O(3N)
    // and "well under 1ms" for the largest install set,
    // but calling it twice is just wasted work and
    // duplicates the result. We compute it once here,
    // feed it into `buildConflictMap`, and reuse the
    // same array for the telemetry loop.
    const conflicts = detectPluginConflicts(withAutoUpdate)
    set({
      plugins: withAutoUpdate,
      registry: buildRegistry(withAutoUpdate),
      pluginHealth: nextHealth,
      loadFailures: nextLoadFailures,
      pluginAutoUpdate: nextAutoUpdate,
      pluginConflicts: buildConflictMap(withAutoUpdate, conflicts),
      ...activeUpdates,
    })

    // Task 13 / G13: feed each conflict into the telemetry
    // ring buffer. We do this after the `set()` so the cache
    // mutation is visible to anyone who calls
    // `getRecentLogLines` from this point on. The host's
    // existing `formatLogLine` recognises the synthetic
    // `plugin.conflict` hook name and routes the entry to the
    // dedicated "⚠️ Conflict" group in the Logs popup.
    for (const c of conflicts) {
      recordPluginConflict(c.message)
    }

    // Synchronously clean up UI state for removed plugins
    const ui = useUIStore.getState()
    for (const target of removed) {
      if (ui.sidebarView === `plugin:${target.id}`) {
        ui.setSidebarView('explorer')
        if (ui.settingsPanelVisible) ui.setSettingsPanelVisible(false)
      }
      if (ui.rightPanelType === `plugin:${target.id}`) {
        ui.setRightPanelType(null)
      }
    }

    for (const target of removed) {
      void runPluginLifecycleHook(
        target,
        target.hooks?.onUnload,
        buildPluginContext(target),
        'onUnload'
      )
      dropPluginStorage(target.id)
      pluginEventBus.removeAllListenersForPlugin(target.id)
      clearPluginMenuItems(target.id)
      // Drop the plugin's command-palette entries too. Same
      // rationale as `clearPluginMenuItems` – the plugin is gone,
      // and any in-flight `when()` check on these entries would
      // either throw or fire on a stale closure.
      clearPluginCommands(target.id)
      // Drop the in-memory grant cache synchronously so a freshly
      // installed plugin with the same id cannot inherit the
      // previous install's grants while the async `removeItem` is
      // still in flight. The localStorage delete runs in the
      // background — `clearGranted` is the security boundary,
      // the disk write is just a tidiness pass.
      clearGranted(target.id)
      void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
        void dropPluginPermissions(target.id)
      })
      // Fourth-round review / M6: drop the persisted
      // auto-update opt-in key for this removed plugin so a
      // reinstall of the same id starts with the feature
      // disabled. Mirrors the same `try`/`catch` block in
      // `unregisterPlugin` so a private-mode / quota
      // failure never throws out of the diff loop.
      try {
        window.localStorage.removeItem(
          `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${target.id}`,
        )
      } catch {
        /* ignore */
      }
      // Fourth-round review / M7: also drop the plugin's
      // telemetry ring-buffer entries so a rescan that
      // removes a plugin doesn't leave its
      // `recordHookMetric` / `recordStorageMetric` /
      // `recordEventMetric` / `recordBackendMetric`
      // entries (plus the cached `lastError` snapshot)
      // hanging around. `unregisterPlugin` does the
      // same; we duplicate it here so the diff path
      // (which doesn't go through `unregisterPlugin`)
      // converges to the same on-disk state.
      clearPluginMetrics(target.id)
    }
    // Task 9 / G9: prune the user's plugin-command bindings
    // (Task 9 / G9) so a removed plugin's `<pluginId>:<id>`
    // keys don't accumulate forever. We do this once at the
    // end of the diff using the post-set valid-id set so any
    // *added* plugin keeps its (just-loaded) binding.
    useUIStore.getState().prunePluginCommandShortcuts(newIds)
    for (const target of added) {
      // Fire onLoad on the *new* plugin reference (the one the
      // store just accepted). The host takeover layer (run via
      // `runPluginLifecycleHook`) installs the SDK overrides
      // for the hook's duration so the plugin can call
      // `getPluginStorage`, `registerContextMenu`, etc. against
      // the host's real implementations.
      //
      // Skip onLoad for plugins that are persisted as disabled:
      // the lifecycle model is `onLoad → onEnable`, and a plugin
      // that was last disabled on disk would otherwise initialize
      // its event subscriptions, timers, and storage seeding only
      // to be told it's disabled the moment the user enables it —
      // duplicating the work and (worse) potentially racing the
      // user-triggered onEnable with the post-registration onLoad.
      // `onLoad` will fire the next time the plugin is enabled
      // via `setPluginEnabled(id, true)` after a cold reload.
      if (target.enabled === false) {
        continue
      }
      void runPluginLifecycleHook(
        target,
        target.hooks?.onLoad,
        buildPluginContext(target),
        'onLoad'
      )
    }
  },

  setLoaded: (loaded) => set({ loaded }),

  setPluginHealth: (id, health) => {
    // Look up the plugin once and bail if it's been removed; we
    // don't want to write a stale entry to `pluginHealth` for a
    // plugin that the user just uninstalled.
    const target = get().plugins.find((p) => p.id === id)
    if (!target) {
      console.warn(`[plugin-store] setPluginHealth: plugin "${id}" not found in registry`)
      return
    }
    set((state) => {
      // No-op when the value already matches – this matters
      // because the takeover's `markPluginHealthy` path fires on
      // every successful hook, and a stream of identical writes
      // would force a re-render of every card subscribed via
      // useShallow.
      if (state.pluginHealth[id] === health) return state
      return {
        pluginHealth: { ...state.pluginHealth, [id]: health },
      }
    })
  },

  setLoadFailures: (failures) => {
    // Build the new failure map from the incoming list. We do
    // not preserve stale entries from a previous load: each
    // rescan should produce a fresh snapshot keyed only by
    // plugins that *currently* fail to load. A plugin that
    // successfully loaded in this scan disappears from the map
    // automatically (its key isn't in `next`).
    const next: Record<string, PluginLoadFailure> = {}
    for (const f of failures) {
      next[f.id] = f
    }
    set((state) => {
      if (isLoadFailureMapEqual(state.loadFailures, next)) {
        return state
      }
      return { loadFailures: next }
    })
  },

  clearLoadFailure: (id) => {
    set((state) => {
      if (!(id in state.loadFailures)) return state
      return { loadFailures: omitKey(state.loadFailures, id) }
    })
  },

  clearLoadFailures: () => {
    set((state) => {
      if (Object.keys(state.loadFailures).length === 0) return state
      return { loadFailures: {} }
    })
  },

  setPluginAutoUpdate: (id, enabled) => {
    set((state) => {
      // Wave B / M6: refuse to write for non-existent plugin IDs.
      // The previous implementation always wrote
      // `pluginAutoUpdate['unknown'] = false` and
      // `localStorage['plugin_auto_update_unknown'] = 'false'`
      // whenever a toggle fired for an id that wasn't in
      // `state.plugins`. Two failure modes followed:
      //   1. The in-memory record leaked a `false` key for
      //      an id that may never resolve, which the next
      //      `setPlugins` pass would not prune (the prune
      //      loop only iterates over `prevIds`).
      //   2. The localStorage key survived an uninstall +
      //      reinstall with the same id (e.g. a user typed a
      //      custom shortcut to an uninstalled plugin, then
      //      installed it back), so a "stale false" would
      //      silently disable the freshly installed plugin's
      //      auto-update without the user ever opting out.
      //
      // We early-return when the id is not registered.
      // `setPlugins` will re-mirror the user's intent onto
      // the matching `autoUpdate` flag at install time.
      const target = state.plugins.find((p) => p.id === id)
      if (!target) {
        return state
      }
      // Fourth-round review / M10: short-circuit no-op when
      // neither the in-memory opt-in record nor the plugin
      // definition's mirrored flag is changing. The previous
      // implementation always called `state.plugins.map(...)`,
      // which produced a fresh array reference on every toggle
      // click and forced *every* `s.plugins` subscriber
      // (the `App` shell, `PluginCommandsSection`,
      // `PluginMarketDetail`) to re-render. Most clicks were
      // "turn it on" (or "turn it off") once, but a
      // double-click or a stale re-fire would replace the
      // array and trigger three component re-renders for no
      // observable change.
      const existing = state.pluginAutoUpdate[id]
      const defFlagMatches = (target.autoUpdate === true) === enabled
      if (existing === enabled && defFlagMatches) {
        return state
      }
      // Persist the per-plugin entry. We rewrite the whole
      // record (instead of `...record, [id]: enabled`) to
      // keep the resulting reference deterministic — that
      // lets the `pluginAutoUpdate` selector's shallow
      // equality detect the change. The set is keyed by
      // plugin id only; we don't store plugin metadata
      // (name, version) in the localStorage record, so a
      // user with N enabled opt-ins pays O(N) keys and
      // nothing else.
      const next = { ...state.pluginAutoUpdate, [id]: enabled }
      try {
        // Per-id key matches the permission-store pattern
        // (see plugin-permissions.ts) so a future "export
        // all plugin settings" feature can sweep both
        // namespaces with the same prefix query.
        window.localStorage.setItem(
          `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${id}`,
          enabled ? 'true' : 'false',
        )
      } catch {
        /* private mode / quota — in-memory copy still wins */
      }
      // Mirror the flag onto the runtime definition so
      // the installed-card toggle can render from the
      // definition alone (the user-opt-in flow already
      // reads from the definition via the selector; the
      // background auto-update chain reads from the
      // authoritative store record).
      //
      // We only rebuild the array when the target plugin
      // is in the registry AND its mirrored `autoUpdate`
      // flag is actually changing. When the plugin is not
      // registered (e.g. the user toggled a preference
      // before the next rescan installed it) we skip the
      // `plugins.map` entirely — the record in
      // `pluginAutoUpdate` is still authoritative, and
      // `setPlugins` will re-mirror on the next scan.
      let plugins = state.plugins
      if (target && (target.autoUpdate === true) !== enabled) {
        plugins = state.plugins.map((p) =>
          p.id === id ? { ...p, autoUpdate: enabled } : p,
        )
      }
      return { pluginAutoUpdate: next, plugins }
    })
  },

  hydratePluginAutoUpdate: (record) => {
    // Wholesale replace from the localStorage snapshot.
    // We don't merge with the in-memory copy because the
    // localStorage copy is the source of truth — any
    // in-memory divergence is, by definition, stale.
    set({ pluginAutoUpdate: { ...record } })
    // Re-mirror onto the runtime definitions so the
    // installed-card toggle shows the persisted state
    // immediately on first paint.
    set((state) => {
      const plugins = state.plugins.map((p) =>
        record[p.id] === true ? { ...p, autoUpdate: true } : p,
      )
      return { plugins }
    })
  },

  clearPluginAutoUpdate: (id) => {
    set((state) => {
      if (!(id in state.pluginAutoUpdate)) {
        // Still drop the definition flag in case the
        // plugin is re-installed later with the same id.
        const plugins = state.plugins.map((p) =>
          p.id === id ? { ...p, autoUpdate: false } : p,
        )
        return { plugins }
      }
      try {
        window.localStorage.removeItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${id}`)
      } catch {
        /* ignore */
      }
      const plugins = state.plugins.map((p) =>
        p.id === id ? { ...p, autoUpdate: false } : p,
      )
      return {
        pluginAutoUpdate: omitKey(state.pluginAutoUpdate, id),
        plugins,
      }
    })
  },

  getPluginById: (id) => {
    return get().plugins.find((p) => p.id === id)
  },

  getPluginHealth: (id) => {
    return get().pluginHealth[id] ?? 'unknown'
  },

  getPluginConflicts: (id) => {
    // Task 13 / G13: per-plugin conflict list. We return a
    // *slice* of the cached array (not the cache reference
    // itself) so the consumer can `.map()` / `.filter()`
    // without mutating the store. An absent key reads as an
    // empty array, matching the `getPluginHealth` fallback
    // contract so the card UI never has to special-case
    // `undefined`.
    const cached = get().pluginConflicts[id]
    return cached ? cached.slice() : []
  },

  getPluginAutoUpdate: (id) => {
    // Strict opt-in: an absent key must read as `false`,
    // never as `undefined` (the `||` short-circuit also
    // coerces an accidentally-stored empty string, but
    // `setPluginAutoUpdate` never writes anything other
    // than `'true'` / `'false'`).
    return get().pluginAutoUpdate[id] === true
  },

  getPluginsByIconPosition: (position) => {
    return sortByOrder(get().plugins.filter((p) => p.iconPosition === position && p.enabled))
  },

  getPluginsByContentPosition: (position) => {
    return sortByOrder(get().plugins.filter((p) => p.contentPosition === position && p.enabled))
  },

  getSidebarPlugins: () => sortByOrder(get().registry.sidebar),
  getEditorToolbarPlugins: () => sortByOrder(get().registry.editorToolbar),
  getTitleBarPlugins: () => sortByOrder(get().registry.titleBar),
}))
