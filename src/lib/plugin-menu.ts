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
   */
  register(pluginId: string, item: ContextMenuItem): void {
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
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.rebuildIndex()
  }

  /** Drop every contribution owned by a given plugin. */
  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.rebuildIndex()
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

  private rebuildIndex(): void {
    for (const loc of Object.keys(this.byLocation) as ContextMenuLocation[]) {
      this.byLocation[loc] = []
    }
    for (const items of this.byPlugin.values()) {
      for (const item of items) this.indexItem(item)
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
