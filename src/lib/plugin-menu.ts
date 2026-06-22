/**
 * Context menu contribution registry.
 *
 * Plugins can add entries to specific context-menu surfaces
 * (file tree, editor, tab) via the `pluginMenuRegistry` singleton or
 * the convenience helpers `registerContextMenu` / `unregisterContextMenu`.
 *
 * Hosts query the registry with `getContextMenuItems(location, ctx)`
 * when they render a menu. The registry handles:
 *  - filtering by `locations`
 *  - predicate evaluation via `when`
 *  - automatic cleanup on plugin unload
 *
 * The store calls `clearPluginMenuItems(pluginId)` when a plugin is
 * unregistered, so a plugin author never has to remember to clean up
 * their contributions manually.
 */
import type {
  ContextMenuContext,
  ContextMenuItem,
  ContextMenuLocation,
  ContextMenuRegistry,
} from '@/types/plugin'
import { assertPermission } from './plugin-permission-guard'

/** Internal storage: per-plugin array of items, plus a flat by-location cache. */
class ContextMenuRegistryImpl {
  private readonly byPlugin = new Map<string, ContextMenuItem[]>()
  private readonly byLocation: ContextMenuRegistry = {
    fileTree: [],
    fileTreeEmpty: [],
    editor: [],
    tab: [],
    tabBarEmpty: [],
  }

  /**
   * Add a menu item. The owning plugin id is stamped onto the item so
   * we can clean up later without the caller having to track it.
   *
   * Throws `PluginPermissionDeniedError` if the plugin doesn't have
   * the `context-menu` grant. We re-check on every call (rather than
   * trusting the `onLoad` snapshot) so a user revoking the permission
   * mid-session immediately stops the plugin from adding new items.
   */
  register(pluginId: string, item: ContextMenuItem): void {
    assertPermission(pluginId, 'context-menu', `register context menu item "${item.id}"`)
    // Replace any previous item with the same id (same plugin) so a
    // re-register (e.g. after manifest reload) doesn't duplicate.
    this.unregister(pluginId, item.id)
    const owned: ContextMenuItem = { ...item }
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(owned)
    this.indexItem(owned)
  }

  unregister(pluginId: string, itemId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((it) => it.id === itemId)
    if (idx < 0) return
    const [removed] = list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    // Incrementally drop the item from each location's index instead
    // of rebuilding the whole `byLocation` map. The previous
    // `rebuildIndex` was O(n_total) per call; in steady state a
    // plugin re-registering its handful of menu items on every
    // manifest reload would trigger n_total work each time.
    this.deindexItem(removed)
  }

  /** Drop every contribution owned by a given plugin. */
  clearPlugin(pluginId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    // De-index every owned item before dropping the plugin entry so
    // the `byLocation` cache stays in sync without a full rebuild.
    for (const item of list) this.deindexItem(item)
    this.byPlugin.delete(pluginId)
  }

  /**
   * Query the items that apply to a specific location and pass the
   * `when` predicate. Items without `locations` are returned for
   * every location.
   */
  query(location: ContextMenuLocation, ctx: ContextMenuContext): ContextMenuItem[] {
    const items = this.byLocation[location]
    if (!items || items.length === 0) return []
    return items.filter((it) => {
      if (it.locations && !it.locations.includes(location)) return false
      if (it.when && !it.when(ctx)) return false
      return true
    })
  }

  /** Direct read for tests / debugging. */
  getByLocation(location: ContextMenuLocation): readonly ContextMenuItem[] {
    return this.byLocation[location]
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private indexItem(item: ContextMenuItem): void {
    const locations: ContextMenuLocation[] = item.locations ?? [
      'fileTree',
      'fileTreeEmpty',
      'editor',
      'tab',
      'tabBarEmpty',
    ]
    for (const loc of locations) {
      this.byLocation[loc].push(item)
    }
  }

  /**
   * Mirror of `indexItem`: remove `item` from every location's
   * index. Because `indexItem` only appends and we use object
   * identity to locate the exact entry, an O(k) `indexOf` per
   * location is enough — and `k` is bounded by the number of items
   * the owning plugin registered, which is normally tiny.
   */
  private deindexItem(item: ContextMenuItem): void {
    const locations: ContextMenuLocation[] = item.locations ?? [
      'fileTree',
      'fileTreeEmpty',
      'editor',
      'tab',
      'tabBarEmpty',
    ]
    for (const loc of locations) {
      const list = this.byLocation[loc]
      const idx = list.indexOf(item)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
}

/** Singleton registry. */
export const pluginMenuRegistry = new ContextMenuRegistryImpl()

/** Convenience: register one item. */
export function registerContextMenu(pluginId: string, item: ContextMenuItem): void {
  pluginMenuRegistry.register(pluginId, item)
}

/** Convenience: unregister a specific item. */
export function unregisterContextMenu(pluginId: string, itemId: string): void {
  pluginMenuRegistry.unregister(pluginId, itemId)
}

/** Convenience: clear all of a plugin's contributions. */
export function clearPluginMenuItems(pluginId: string): void {
  pluginMenuRegistry.clearPlugin(pluginId)
}

/** Convenience: query. */
export function getContextMenuItems(
  location: ContextMenuLocation,
  ctx: ContextMenuContext
): ContextMenuItem[] {
  return pluginMenuRegistry.query(location, ctx)
}
