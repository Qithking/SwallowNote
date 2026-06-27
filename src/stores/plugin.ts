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
import { dropPluginStorage, pluginEventBus, buildPluginContext, clearPluginTripped } from '@/lib/plugin-host'
import { runPluginLifecycleHook, type PluginWithModule } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'
import { clearPluginCommands } from '@/lib/plugin-commands'
import { clearGranted } from '@/lib/plugin-permission-guard'
import {
  detectPluginConflicts,
  type PluginConflict,
} from '@/lib/plugin-conflicts'
import { clearPluginMetrics, recordPluginConflict } from '@/lib/plugin-telemetry'

/** localStorage 键前缀，严格 opt-in。 */
export const PLUGIN_AUTO_UPDATE_KEY_PREFIX = 'plugin_auto_update_'

/** 插件健康状态：healthy/unhealthy/unknown。 */
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
  /** 每个内容位置的活跃插件 id 镜像，权威值在 useUIStore。 */
  activeLeftPanelPluginId: string | null
  activeRightPanelPluginId: string | null
  activeFullPanelPluginId: string | null
  activeEditorAreaPluginId: string | null
  /** 每插件健康状态映射，缺失项视为 'unknown'。 */
  pluginHealth: Record<string, PluginHealth>
  /** 每插件冲突列表，注册/启用/卸载时同步。 */
  pluginConflicts: Record<string, PluginConflict[]>
  /** 每插件自动更新 opt-in 映射，持久化到 localStorage。 */
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

  /** 整体替换加载失败映射。 */
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

  /** 切换自动更新 opt-in，持久化并镜像到 PluginDefinition。 */
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
  /** 返回插件冲突列表（切片副本）。 */
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

/** 纯函数：返回移除指定键的新记录。 */
function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  if (!(key in record)) return record
  const next: Record<string, V> = {}
  for (const k of Object.keys(record)) {
    if (k !== key) next[k] = record[k]
  }
  return next
}

/** 浅比较两个失败映射。 */
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
    // Plugins without a `iconPosition` are headless — they
    // don't render anywhere in the title bar / activity bar /
    // editor toolbar. Typical example: a file-format editor
    // (e.g. the `com.swallownote.mindmap` plugin for `.smm`
    // files) that only contributes `editorFileExtensions`.
    // The plugin is still loaded, its lifecycle hooks still
    // fire, and its `editorFileExtensions` claim is still
    // honoured — it just doesn't appear in any chrome
    // surface. We intentionally skip the unknown-position
    // warning here because a missing position is a valid
    // choice, not a typo.
    if (!plugin.iconPosition) continue
    const key = plugin.iconPosition
    if (key in registry) {
      registry[key].push(plugin)
    } else {
      console.warn(`[PluginStore] Plugin ${plugin.id} has unknown iconPosition: "${key}"`)
    }
  }
  return registry
}

/** 运行冲突检测器并构建 per-plugin 映射。 */
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
      // 重建冲突映射以显示新插件冲突徽章。
      return {
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      }
    })
    // 注册后异步触发 onLoad，安装 SDK host 接管。
    void runPluginLifecycleHook(
      plugin,
      plugin.hooks?.onLoad,
      buildPluginContext(plugin),
      'onLoad'
    )
  },

  registerPlugins: (newPlugins) => {
    // set() 前计算 diff，避免重复触发 onLoad。
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
    // 同步 useUIStore.sidebarView。
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
    // 清理命令面板条目。
    clearPluginCommands(id)
    // 清除权限授予缓存。
    clearGranted(id)
    void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
      void dropPluginPermissions(id)
    })
    // 清除持久化的自动更新 opt-in。
    try {
      window.localStorage.removeItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${id}`)
    } catch {
      /* ignore */
    }
    // 清理遥测缓冲、存储尺寸映射和 lastError。
    clearPluginMetrics(id)
    // 修剪已卸载插件的快捷键绑定。
    const remainingIds = new Set(get().plugins.map((p) => p.id))
    useUIStore.getState().prunePluginCommandShortcuts(remainingIds)
  },

  setPluginEnabled: (id, enabled) => {
    // Capture pre-state to know which transition we're on (true→false
    // means call onDisable, false→true means call onEnable).
    const target = get().plugins.find((p) => p.id === id)
    const wasEnabled = target?.enabled ?? false
    if (!target) {
      // 插件不存在时警告。
      console.warn(`[plugin-store] setPluginEnabled: plugin "${id}" not found in registry`)
      return
    }
    set((state) => {
      const plugins = state.plugins.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, enabled }
        // Preserve the non-enumerable __pluginModule field so
        // lifecycle hooks can still call setHost after a toggle.
        const mod = (p as PluginWithModule).__pluginModule
        if (mod) {
          Object.defineProperty(next, '__pluginModule', {
            value: mod,
            enumerable: false,
            writable: false,
            configurable: false,
          })
        }
        return next
      })
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
        // 用户手动重新启用插件时清除熔断标志，使之前因超时被熔断的插件恢复工作。
        // 不能在 runPluginLifecycleHook 入口清除：上一轮超时的 hookPromise 仍在后台
        // 运行，入口清除会让旧 promise 的 storage.set / invokeBackend 绕过熔断检查
        // （P0 NEW-4 时序竞态）。
        clearPluginTripped(id)
        void runPluginLifecycleHook(target, target.hooks?.onLoad, buildPluginContext(target), 'onLoad')
      }
      const hook = enabled ? target.hooks?.onEnable : target.hooks?.onDisable
      const hookName = enabled ? 'onEnable' : 'onDisable'
      void runPluginLifecycleHook(target, hook, buildPluginContext(target), hookName)
    }
  },

  setPlugins: (plugins) => {
    // 替换前计算 diff：移除的清理资源并触发 onUnload，新增的触发 onLoad。
    // 不能调用 unregisterPlugin/registerPlugin（各自 set() 会与原子替换竞争）。
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
    // 清理移除插件的 load-failure 和 auto-update。
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
    // 重新镜像 auto-update 偏好到新 PluginDefinition。
    const withAutoUpdate = deduped.map((p) => {
      if (state.pluginAutoUpdate[p.id] !== true) return p
      const next = { ...p, autoUpdate: true }
      // Preserve the non-enumerable __pluginModule field so
      // lifecycle hooks can still call setHost after a toggle.
      const mod = (p as PluginWithModule).__pluginModule
      if (mod) {
        Object.defineProperty(next, '__pluginModule', {
          value: mod,
          enumerable: false,
          writable: false,
          configurable: false,
        })
      }
      return next
    })
    // 在镜像后的列表上运行冲突扫描。
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

    // 将每条冲突写入遥测缓冲。
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
      // 清理移除插件的遥测缓冲。
      clearPluginMetrics(target.id)
    }
    // Task 9 / G9: prune the user's plugin-command bindings
    // (Task 9 / G9) so a removed plugin's `<pluginId>:<id>`
    // keys don't accumulate forever. We do this once at the
    // end of the diff using the post-set valid-id set so any
    // *added* plugin keeps its (just-loaded) binding.
    useUIStore.getState().prunePluginCommandShortcuts(newIds)
    for (const target of added) {
      // 对新增插件触发 onLoad，跳过持久化为禁用的插件。
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
      // 值未变时跳过 set()。
      if (state.pluginHealth[id] === health) return state
      return {
        pluginHealth: { ...state.pluginHealth, [id]: health },
      }
    })
  },

  setLoadFailures: (failures) => {
    // 每次重扫描生成全新快照。
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
      // 拒绝为未注册插件写入。
      const target = state.plugins.find((p) => p.id === id)
      if (!target) {
        return state
      }
      // 无变化时短路。
      const existing = state.pluginAutoUpdate[id]
      const defFlagMatches = (target.autoUpdate === true) === enabled
      if (existing === enabled && defFlagMatches) {
        return state
      }
      // 持久化到 localStorage。
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
      // 仅当镜像标志变化时重建 plugins 数组。
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
    // 返回切片副本，缺失键返回空数组。
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
