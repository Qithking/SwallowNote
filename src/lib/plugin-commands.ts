/** 插件命令面板注册表 */
import type {
  PluginCommand,
  PluginCommandRegistry,
  PluginCommandsListener,
} from '@/types/plugin'
import { assertPermission } from './plugin-permission-guard'
import { logger } from './logger'

/** 注册时标记插件 id 的命令条目 */
export interface RegisteredPluginCommand extends PluginCommand {
  /** 所属插件 id */
  __pluginId: string
}

class PluginCommandRegistryImpl implements PluginCommandRegistry {
  /** 内部存储：按插件数组，保持注册序 */
  private readonly byPlugin = new Map<string, RegisteredPluginCommand[]>()
  private readonly listeners = new Set<PluginCommandsListener>()

  register(pluginId: string, command: PluginCommand): void {
    assertPermission(pluginId, 'events', `register command "${command.id}"`)
    // 同插件同 id 重复注册时替换
    this.unregister(pluginId, command.id)
    const owned: RegisteredPluginCommand = { ...command, __pluginId: pluginId }
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(owned)
    this.notifyListeners()
  }

  unregister(pluginId: string, commandId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((c) => c.id === commandId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.notifyListeners()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.notifyListeners()
  }

  list(): PluginCommand[] {
    // 按注册序展平
    const out: PluginCommand[] = []
    for (const list of this.byPlugin.values()) {
      for (const entry of list) {
        out.push(entry)
      }
    }
    return out
  }

  subscribe(listener: PluginCommandsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        // 监听器异常不阻断变更
        logger.error('plugin-commands', 'listener threw:', err)
      }
    }
  }
}

/** 宿主单例 */
export const pluginCommandRegistry = new PluginCommandRegistryImpl()

/** 注册单个命令 */
export function registerCommand(pluginId: string, command: PluginCommand): void {
  pluginCommandRegistry.register(pluginId, command)
}

/** 按 id 注销命令 */
export function unregisterCommand(pluginId: string, commandId: string): void {
  pluginCommandRegistry.unregister(pluginId, commandId)
}

/** 清除插件全部命令 */
export function clearPluginCommands(pluginId: string): void {
  pluginCommandRegistry.clearPlugin(pluginId)
}

/** 已注册命令只读快照 */
export function listPluginCommands(): PluginCommand[] {
  return pluginCommandRegistry.list()
}

/** 订阅注册表变更 */
export function subscribePluginCommands(listener: PluginCommandsListener): () => void {
  return pluginCommandRegistry.subscribe(listener)
}
