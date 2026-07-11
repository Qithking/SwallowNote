/** 右键菜单贡献注册表 */
import type {
  ContextMenuContext,
  ContextMenuItem,
  ContextMenuLocation,
  ContextMenuRegistry,
} from '@/types/plugin'
import { assertPermission } from './plugin-permission-guard'

/** 内部存储：按插件与按位置缓存 */
class ContextMenuRegistryImpl {
  private readonly byPlugin = new Map<string, ContextMenuItem[]>()
  private readonly byLocation: ContextMenuRegistry = {
    fileTree: [],
    fileTreeEmpty: [],
    editor: [],
    tab: [],
    tabBarEmpty: [],
  }

  /** 注册菜单项，无权限抛错 */
  register(pluginId: string, item: ContextMenuItem): void {
    assertPermission(pluginId, 'context-menu', `register context menu item "${item.id}"`)
    // 同 id 重复注册时替换
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
    // 增量移除索引项，避免全量 rebuild
    this.deindexItem(removed)
  }

  /** 清除插件全部贡献 */
  clearPlugin(pluginId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    // 删除插件前先清缓存索引
    for (const item of list) this.deindexItem(item)
    this.byPlugin.delete(pluginId)
  }

  /** 查询指定位置的菜单项 */
  query(location: ContextMenuLocation, ctx: ContextMenuContext): ContextMenuItem[] {
    const items = this.byLocation[location]
    if (!items || items.length === 0) return []
    return items.filter((it) => {
      if (it.locations && !it.locations.includes(location)) return false
      if (it.when && !it.when(ctx)) return false
      return true
    })
  }

  /** 测试/调试直读 */
  getByLocation(location: ContextMenuLocation): readonly ContextMenuItem[] {
    return this.byLocation[location]
  }

  // 内部实现

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

  /** 从位置索引移除项 */
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

/** 单例注册表 */
export const pluginMenuRegistry = new ContextMenuRegistryImpl()

/** 注册单个菜单项 */
export function registerContextMenu(pluginId: string, item: ContextMenuItem): void {
  pluginMenuRegistry.register(pluginId, item)
}

/** 按 id 注销菜单项 */
export function unregisterContextMenu(pluginId: string, itemId: string): void {
  pluginMenuRegistry.unregister(pluginId, itemId)
}

/** 清除插件全部菜单项 */
export function clearPluginMenuItems(pluginId: string): void {
  pluginMenuRegistry.clearPlugin(pluginId)
}

/** 查询菜单项 */
export function getContextMenuItems(
  location: ContextMenuLocation,
  ctx: ContextMenuContext
): ContextMenuItem[] {
  return pluginMenuRegistry.query(location, ctx)
}
