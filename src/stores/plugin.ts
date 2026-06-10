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
import { runLifecycleHook, dropPluginStorage } from '@/lib/plugin-host'
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
    if (!plugin.enabled) continue
    const key = plugin.iconPosition
    if (key in registry) {
      registry[key].push(plugin)
    }
  }
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
    void runLifecycleHook(plugin.hooks?.onLoad, buildPluginContext(plugin), 'onLoad')
  },

  registerPlugins: (newPlugins) => {
    set((state) => {
      const existingIds = new Set(state.plugins.map((p) => p.id))
      const added = newPlugins.filter((p) => !existingIds.has(p.id))
      if (added.length === 0) return state
      const plugins = [...state.plugins, ...added]
      return { plugins, registry: buildRegistry(plugins) }
    })
    // Fire onLoad hooks for newly added plugins only (not duplicates).
    // We re-read the set after set() to know which actually got added.
    const currentIds = new Set(get().plugins.map((p) => p.id))
    for (const plugin of newPlugins) {
      if (currentIds.has(plugin.id)) {
        void runLifecycleHook(plugin.hooks?.onLoad, buildPluginContext(plugin), 'onLoad')
      }
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
      void runLifecycleHook(target.hooks?.onUnload, buildPluginContext(target), 'onUnload')
    }
    dropPluginStorage(id)
    // Drop any context-menu items this plugin contributed so they
    // don't linger after the plugin is gone. Clear before running
    // onUnload so the plugin's own tear-down logic can't see stale
    // items referenced by id.
    clearPluginMenuItems(id)
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
      void runLifecycleHook(hook, buildPluginContext(target), hookName)
    }
  },

  setPlugins: (plugins) => {
    set({ plugins, registry: buildRegistry(plugins) })
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
