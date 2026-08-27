/** 插件权限执行：事件/存储/IPC 沙箱 */
import type { PluginPermission, PluginPermissionStatus } from '@/types/plugin'
import { logger } from './logger'

/** assertPermission 抛出 */
export class PluginPermissionDeniedError extends Error {
  public readonly pluginId: string
  public readonly permission: PluginPermission
  public readonly operation: string

  constructor(pluginId: string, permission: PluginPermission, operation: string) {
    super(
      `Plugin "${pluginId}" is not allowed to ${operation} (missing permission: ${permission})`
    )
    this.name = 'PluginPermissionDeniedError'
    this.pluginId = pluginId
    this.permission = permission
    this.operation = operation
    // 保留原型链以支持 instanceof
    Object.setPrototypeOf(this, PluginPermissionDeniedError.prototype)
  }
}

// 内存缓存

/** 按插件 id 缓存授权集 */
const grants = new Map<string, Set<PluginPermission>>()

// 硬编码前缀避免循环依赖
const PERMISSIONS_KEY_PREFIX = 'plugin_permissions_'

/** 模块加载时从 localStorage 填充缓存 */
function eagerHydrateFromLocalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const prefix = PERMISSIONS_KEY_PREFIX
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    const pluginId = key.substring(prefix.length)
    if (!pluginId) continue
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch {
      // localStorage 异常时跳过当前项
      continue
    }
    if (!raw) continue
    let status: PluginPermissionStatus[]
    try {
      const parsed = JSON.parse(raw) as unknown
      // 防御：跳过非数组项
      if (!Array.isArray(parsed)) {
        logger.warn(
          'plugin-permission',
          `ignoring non-array permission entry for ${pluginId}`,
        )
        continue
      }
      status = parsed
    } catch {
      // 损坏项跳过，下次保存覆盖
      logger.warn(
          'plugin-permission',
          `ignoring corrupt permission entry for ${pluginId}`,
        )
      continue
    }
    const granted = status.filter((s) => s.granted).map((s) => s.permission)
    if (granted.length > 0) {
      grants.set(pluginId, new Set(granted))
    }
  }
}

eagerHydrateFromLocalStorage()

/** 替换插件授权集 */
export function setGranted(pluginId: string, perms: PluginPermission[]): void {
  grants.set(pluginId, new Set(perms))
}

/** 卸载时移除插件缓存 */
export function clearGranted(pluginId: string): void {
  grants.delete(pluginId)
}

/** 清空全部缓存（测试用） */
export function clearAll(): void {
  grants.clear()
}

/** 同步热路径检查，拒绝时抛错 */
export function assertPermission(
  pluginId: string,
  permission: PluginPermission,
  operation: string
): void {
  const set = grants.get(pluginId)
  if (set?.has(permission)) return
  throw new PluginPermissionDeniedError(pluginId, permission, operation)
}

/** 非抛错变体，用于 UI 灰显 */
export function hasPermission(pluginId: string, permission: PluginPermission): boolean {
  return grants.get(pluginId)?.has(permission) ?? false
}
