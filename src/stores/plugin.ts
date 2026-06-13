/**
 * Plugin Store - Manages plugin registration, loading, and state
 */
import { create } from 'zustand'
import type {
  PluginDefinition,
  PluginRegistry,
  IconPosition,
  ContentPosition,
  PluginContext,
} from '@/types/plugin'
import { emptyRegistry } from '@/types/plugin'
import { useUIStore } from './ui'
import { dropPluginStorage, pluginEventBus } from '@/lib/plugin-host'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'

/**
 * Build a PluginContext for invoking a plugin's lifecycle hooks.
 * `invokeBackend` is intentionally a no-op here: lifecycle hooks
 * are JS-side only and run on the same side as the plugin module.
 * Backend IPC is for the panel itself and is exposed via
 * `PluginPanelProps.invokeBackend`.
 */
function buildPluginContext(plugin: PluginDefinition): PluginContext {
  return {
    pluginId: plugin.id,
    pluginPath: plugin.pluginPath,
    invokeBackend: async () => {
      throw new Error(
        `Backend IPC not available to lifecycle hooks (plugin_id=${plugin.id})`
      )
    },
  }
}

export interface PluginState {
  /** All registered plugins, indexed by iconPosition */
  registry: PluginRegistry
  /** Flat list of all plugins (for management page) */
  plugins: PluginDefinition[]
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

  /** Get a plugin by id */
  getPluginById: (id: string) => PluginDefinition | undefined
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

/** Rebuild the registry from a flat plugin list */
function buildRegistry(plugins: PluginDefinition[]): PluginRegistry {
  const registry: PluginRegistry = { sidebar: [], editorToolbar: [], titleBar: [] }
  for (const plugin of plugins) {
    if (!plugin.enabled) { console.log(`[PluginStore] Skipping disabled plugin: ${plugin.id}`); continue }
    const key = plugin.iconPosition
    if (key in registry) {
      registry[key].push(plugin)
      console.log(`[PluginStore] Registered plugin ${plugin.id} in registry.${key}`)
    } else {
      console.warn(`[PluginStore] Plugin ${plugin.id} has unknown iconPosition: "${key}"`)
    }
  }
  console.log(`[PluginStore] buildRegistry result:`, { sidebar: registry.sidebar.length, editorToolbar: registry.editorToolbar.length, titleBar: registry.titleBar.length })
  return registry
}

export const usePluginStore = create<PluginState>((set, get) => ({
  registry: { ...emptyRegistry },
  plugins: [],
  loaded: false,
  activeLeftPanelPluginId: null,
  activeRightPanelPluginId: null,
  activeFullPanelPluginId: null,
  activeEditorAreaPluginId: null,

  registerPlugin: (plugin) => {
    set((state) => {
      if (state.plugins.some((p) => p.id === plugin.id)) return state
      const plugins = [...state.plugins, plugin]
      return { plugins, registry: buildRegistry(plugins) }
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
      set({ plugins, registry: buildRegistry(plugins) })
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
    // Drop the plugin's persisted permissions (localStorage key +
    // in-memory guard). We do this last so a revoke UI that is
    // observing the plugin's grants still has a coherent snapshot
    // until the unregister call returns.
    void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
      void dropPluginPermissions(id)
    })
  },

  setPluginEnabled: (id, enabled) => {
    // Capture pre-state to know which transition we're on (true→false
    // means call onDisable, false→true means call onEnable).
    const target = get().plugins.find((p) => p.id === id)
    const wasEnabled = target?.enabled ?? false
    set((state) => {
      const plugins = state.plugins.map((p) =>
        p.id === id ? { ...p, enabled } : p
      )
      return { plugins, registry: buildRegistry(plugins) }
    })
    if (target && wasEnabled !== enabled) {
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
    set({ plugins: deduped, registry: buildRegistry(deduped) })
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
      void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
        void dropPluginPermissions(target.id)
      })
    }
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

  getPluginById: (id) => {
    return get().plugins.find((p) => p.id === id)
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
