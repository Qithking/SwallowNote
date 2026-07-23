/**
 * Plugin Store - Manages plugin registration, loading, and state
 */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type {
  PluginDefinition,
  PluginLoadFailure,
  PluginRegistry,
  IconPosition,
  ContentPosition,
} from '@/types/plugin'
import { emptyRegistry } from '@/types/plugin'
import { useUIStore } from './ui'
import { dropPluginStorage, pluginEventBus, buildPluginContext, clearPluginTripped, clearPluginHostState } from '@/lib/plugin-host'
import { runPluginLifecycleHook, installHostTakeover, uninstallHostTakeover, type PluginWithModule } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'
import { clearPluginCommands } from '@/lib/plugin-commands'
import { clearGranted } from '@/lib/plugin-permission-guard'
import {
  detectPluginConflicts,
  type PluginConflict,
} from '@/lib/plugin-conflicts'
import { clearPluginMetrics, recordPluginConflict } from '@/lib/plugin-telemetry'
import { dropSettingsCache } from '@/lib/plugin-settings'
import { resetPluginCrashCount } from '@/lib/plugin-health'
import { dropPluginBlobUrl } from '@/lib/plugin-loader'

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

  // ── Actions ──

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
    // 无 iconPosition 的插件为 headless（如文件格式编辑器），
    // 不渲染但正常加载，故跳过未知位置警告
    if (!plugin.iconPosition) continue
    const key = plugin.iconPosition
    if (key in registry) {
      registry[key].push(plugin)
    } else {
      logger.warn('plugin-store', `Plugin ${plugin.id} has unknown iconPosition: "${key}"`)
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

// ── Getter result caches (P-H3) ──
// Return stable array references across renders when the underlying state
// hasn't changed, so these getters can be used as Zustand selectors without
// triggering infinite re-renders. Invalidation is automatic by reference
// equality: plugins/registry/pluginConflicts get new references on every
// set that modifies them (via buildRegistry/buildConflictMap), so the cache
// misses precisely when the data changes.
const _getterCache = {
  registryRef: null as PluginRegistry | null,
  sidebarPlugins: [] as PluginDefinition[],
  editorToolbarPlugins: [] as PluginDefinition[],
  titleBarPlugins: [] as PluginDefinition[],

  pluginsRef: null as PluginDefinition[] | null,
  byIconPosition: new Map<IconPosition, PluginDefinition[]>(),
  byContentPosition: new Map<ContentPosition, PluginDefinition[]>(),

  conflictsRef: null as Record<string, PluginConflict[]> | null,
  conflictsById: new Map<string, PluginConflict[]>(),
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
    // 注册后：先安装持久化 host takeover，再触发 onLoad。
    // setHost 在 onLoad 前安装，以便 onLoad 中可用 SDK API
    installHostTakeover(plugin)
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
      // 同步重建冲突映射，使新条目的冲突立即反映到 badge
      set({
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      })
    }
    for (const plugin of added) {
      installHostTakeover(plugin)
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
    // set 前捕获插件引用，以便对同一实例触发 onUnload
    const target = get().plugins.find((p) => p.id === id)
    set((state) => {
      const plugins = state.plugins.filter((p) => p.id !== id)
      const updates: Partial<PluginState> = {
        plugins,
        registry: buildRegistry(plugins),
        // 丢弃健康记录，重装时从干净状态开始
        pluginHealth: omitKey(state.pluginHealth, id),
        // 丢弃加载失败记录，卸载后 banner 立即消失
        loadFailures: omitKey(state.loadFailures, id),
        // 丢弃自动更新 opt-in（localStorage 在下方副作用中清除）
        pluginAutoUpdate: omitKey(state.pluginAutoUpdate, id),
        // 重建冲突映射，清除被卸载插件所解决的冲突
        pluginConflicts: buildConflictMap(plugins),
      }
      if (state.activeLeftPanelPluginId === id) updates.activeLeftPanelPluginId = null
      if (state.activeRightPanelPluginId === id) updates.activeRightPanelPluginId = null
      if (state.activeFullPanelPluginId === id) updates.activeFullPanelPluginId = null
      if (state.activeEditorAreaPluginId === id) updates.activeEditorAreaPluginId = null
      return updates
    })
    // 同步清理引用被卸载插件的 UI 状态，避免残留视图
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
    // 触发 onUnload 并丢弃缓存，便于重装
    if (target) {
      void runPluginLifecycleHook(
        target,
        target.hooks?.onUnload,
        buildPluginContext(target),
        'onUnload'
      )
    }
    // 卸载 host takeover（须在 onUnload 后，onUnload 可能仍需 SDK API）
    uninstallHostTakeover(id)
    dropPluginStorage(id)
    // 释放插件加载时缓存的 blob URL，避免 Blob 对象内存泄漏
    if (target) dropPluginBlobUrl(target.pluginPath)
    // 清理 plugin-host 残留状态（熔断标志、事件总线"已拆线"计数器）。
    clearPluginHostState(id)
    // 清理 plugin-settings 内存缓存，避免同 id 重装读到旧设置。
    dropSettingsCache(id)
    // 清理插件崩溃计数，避免同 id 重装继承历史崩溃记录。
    resetPluginCrashCount(id)
    // 移除插件注册的所有事件处理器，避免残留订阅触发
    pluginEventBus.removeAllListenersForPlugin(id)
    // 清理插件贡献的右键菜单项（onUnload 前清理避免残留）
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
    // 捕获前置状态以判断转换方向（调 onEnable/onDisable）
    const target = get().plugins.find((p) => p.id === id)
    const wasEnabled = target?.enabled ?? false
    if (!target) {
      // 插件不存在时警告。
      logger.warn('plugin-store', `setPluginEnabled: plugin "${id}" not found in registry`)
      return
    }
    set((state) => {
      const plugins = state.plugins.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, enabled }
        // 保留不可枚举的 __pluginModule，使 toggle 后仍可 setHost
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
      // 重新运行冲突扫描（禁用移出冲突组，启用可能重新占位）
      return {
        plugins,
        registry: buildRegistry(plugins),
        pluginConflicts: buildConflictMap(plugins),
      }
    })
    if (wasEnabled !== enabled) {
      // 重新启用时先 onLoad 再 onEnable（冷启动禁用的插件跳过了 onLoad）
      if (enabled && !wasEnabled) {
        // 用户手动重新启用插件时清除熔断标志，使之前因超时被熔断的插件恢复工作。
        // 不能在 runPluginLifecycleHook 入口清除：上一轮超时的 hookPromise 仍在后台
        // 运行，入口清除会让旧 promise 的 storage.set / invokeBackend 绕过熔断检查
        // （P0 NEW-4 时序竞态）。
        clearPluginTripped(id)
        // 禁用期间 host takeover 被卸载（见 setPlugins），重新启用时重新安装
        installHostTakeover(target)
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
        logger.warn(
          'plugin-store',
          `setPlugins received duplicate id "${p.id}", keeping the last occurrence`,
        )
        // 用后一条覆盖前一条，保证 last wins 语义
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

    // 为被移除的插件构建 active-state 更新（同 unregisterPlugin）
    const activeUpdates: Partial<PluginState> = {}
    for (const target of removed) {
      if (state.activeLeftPanelPluginId === target.id) activeUpdates.activeLeftPanelPluginId = null
      if (state.activeRightPanelPluginId === target.id) activeUpdates.activeRightPanelPluginId = null
      if (state.activeFullPanelPluginId === target.id) activeUpdates.activeFullPanelPluginId = null
      if (state.activeEditorAreaPluginId === target.id) activeUpdates.activeEditorAreaPluginId = null
    }
    // 单次遍历剥离被移除插件的健康记录，保持 set() 单次更新
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
      // 保留不可枚举的 __pluginModule，使 toggle 后仍可 setHost
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

    // 同步清理被移除插件的 UI 状态
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
      // 卸载持久化 host takeover（onUnload 之后）
      uninstallHostTakeover(target.id)
      dropPluginStorage(target.id)
      // 释放插件加载时缓存的 blob URL，避免 Blob 对象内存泄漏
      dropPluginBlobUrl(target.pluginPath)
      // 清理 plugin-host 残留状态（熔断标志、事件总线"已拆线"计数器）。
      clearPluginHostState(target.id)
      // 清理 plugin-settings 内存缓存，避免同 id 重装读到旧设置。
      dropSettingsCache(target.id)
      // 清理插件崩溃计数，避免同 id 重装继承历史崩溃记录。
      resetPluginCrashCount(target.id)
      pluginEventBus.removeAllListenersForPlugin(target.id)
      clearPluginMenuItems(target.id)
      // 清理命令面板条目（同 clearPluginMenuItems 理由）
      clearPluginCommands(target.id)
      // 同步丢弃内存权限缓存（clearGranted 是安全边界，磁盘删除异步）
      clearGranted(target.id)
      void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
        void dropPluginPermissions(target.id)
      })
      // 丢弃持久化的自动更新 opt-in（重装时默认禁用）
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
    // 清理已移除插件的命令快捷键绑定（用 post-set valid-id 集）
    useUIStore.getState().prunePluginCommandShortcuts(newIds)
    for (const target of added) {
      // 对新增插件触发 onLoad，跳过持久化为禁用的插件。
      if (target.enabled === false) {
        continue
      }
      installHostTakeover(target)
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
    // 插件已移除则跳过，避免写入 stale 健康记录
    const target = get().plugins.find((p) => p.id === id)
    if (!target) {
      logger.warn('plugin-store', `setPluginHealth: plugin "${id}" not found in registry`)
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
    // 整体替换（localStorage 为权威源，不与内存合并）
    set({ pluginAutoUpdate: { ...record } })
    // 重新镜像到运行时定义，首屏即显示持久化状态
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
    const conflicts = get().pluginConflicts
    if (_getterCache.conflictsRef !== conflicts) {
      _getterCache.conflictsRef = conflicts
      _getterCache.conflictsById.clear()
    }
    const hit = _getterCache.conflictsById.get(id)
    if (hit) return hit
    const stored = conflicts[id]
    const result = stored ? stored.slice() : []
    _getterCache.conflictsById.set(id, result)
    return result
  },

  getPluginAutoUpdate: (id) => {
    // 严格 opt-in：缺失键读为 false（非 undefined）
    return get().pluginAutoUpdate[id] === true
  },

  getPluginsByIconPosition: (position) => {
    const plugins = get().plugins
    if (_getterCache.pluginsRef !== plugins) {
      _getterCache.pluginsRef = plugins
      _getterCache.byIconPosition.clear()
      _getterCache.byContentPosition.clear()
    }
    const hit = _getterCache.byIconPosition.get(position)
    if (hit) return hit
    const result = sortByOrder(plugins.filter((p) => p.iconPosition === position && p.enabled))
    _getterCache.byIconPosition.set(position, result)
    return result
  },

  getPluginsByContentPosition: (position) => {
    const plugins = get().plugins
    if (_getterCache.pluginsRef !== plugins) {
      _getterCache.pluginsRef = plugins
      _getterCache.byIconPosition.clear()
      _getterCache.byContentPosition.clear()
    }
    const hit = _getterCache.byContentPosition.get(position)
    if (hit) return hit
    const result = sortByOrder(plugins.filter((p) => p.contentPosition === position && p.enabled))
    _getterCache.byContentPosition.set(position, result)
    return result
  },

  getSidebarPlugins: () => {
    const registry = get().registry
    if (_getterCache.registryRef !== registry) {
      _getterCache.registryRef = registry
      _getterCache.sidebarPlugins = sortByOrder(registry.sidebar)
      _getterCache.editorToolbarPlugins = sortByOrder(registry.editorToolbar)
      _getterCache.titleBarPlugins = sortByOrder(registry.titleBar)
    }
    return _getterCache.sidebarPlugins
  },
  getEditorToolbarPlugins: () => {
    const registry = get().registry
    if (_getterCache.registryRef !== registry) {
      _getterCache.registryRef = registry
      _getterCache.sidebarPlugins = sortByOrder(registry.sidebar)
      _getterCache.editorToolbarPlugins = sortByOrder(registry.editorToolbar)
      _getterCache.titleBarPlugins = sortByOrder(registry.titleBar)
    }
    return _getterCache.editorToolbarPlugins
  },
  getTitleBarPlugins: () => {
    const registry = get().registry
    if (_getterCache.registryRef !== registry) {
      _getterCache.registryRef = registry
      _getterCache.sidebarPlugins = sortByOrder(registry.sidebar)
      _getterCache.editorToolbarPlugins = sortByOrder(registry.editorToolbar)
      _getterCache.titleBarPlugins = sortByOrder(registry.titleBar)
    }
    return _getterCache.titleBarPlugins
  },
}))
