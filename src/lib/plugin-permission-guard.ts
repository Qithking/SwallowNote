/**
 * Plugin permission enforcement — runtime sandbox for event/storage/IPC.
 * Grants eagerly hydrated from localStorage at module load (sync) to avoid race.
 */
import type { PluginPermission, PluginPermissionStatus } from '@/types/plugin'

/** Thrown by assertPermission; subclass Error for instanceof-check. */
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
    // Preserve the V8 prototype chain across the transpiled class
    // so `instanceof` still works after TS down-leveling.
    Object.setPrototypeOf(this, PluginPermissionDeniedError.prototype)
  }
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

/**
 * Per-plugin grant set. The outer Map is keyed by pluginId so we
 * can answer "is permission X granted to plugin Y" in O(1) and
 * update grants for one plugin without disturbing the others.
 */
const grants = new Map<string, Set<PluginPermission>>()

// Hardcoded prefix to avoid module-load cycle.
const PERMISSIONS_KEY_PREFIX = 'plugin_permissions_'

/** Eagerly hydrate grants cache from localStorage at module load. */
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
      // localStorage can throw in private-browsing / quota
      // edge cases. A missing entry for one plugin must not
      // prevent the rest of the cache from materialising.
      continue
    }
    if (!raw) continue
    let status: PluginPermissionStatus[]
    try {
      const parsed = JSON.parse(raw) as unknown
      // Defensive: skip non-array entries.
      if (!Array.isArray(parsed)) {
        console.warn(
          `[plugin-permission-guard] ignoring non-array permission entry for ${pluginId}`,
        )
        continue
      }
      status = parsed
    } catch {
      // Corrupt entry – log once and skip. The next save
      // through the UI will overwrite it with a clean record.
      console.warn(
        `[plugin-permission-guard] ignoring corrupt permission entry for ${pluginId}`,
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

/** Replace the grant set for one plugin. Used after a UI save. */
export function setGranted(pluginId: string, perms: PluginPermission[]): void {
  grants.set(pluginId, new Set(perms))
}

/** Drop a plugin from the cache (called on uninstall). */
export function clearGranted(pluginId: string): void {
  grants.delete(pluginId)
}

/** Drop every plugin from the cache (tests / dev reset). */
export function clearAll(): void {
  grants.clear()
}

/** Sync hot-path check; throws to prevent silent security bypass. */
export function assertPermission(
  pluginId: string,
  permission: PluginPermission,
  operation: string
): void {
  const set = grants.get(pluginId)
  if (set?.has(permission)) return
  throw new PluginPermissionDeniedError(pluginId, permission, operation)
}

/**
 * Non-throwing variant for UI display (e.g. greying out a menu
 * item when the plugin lacks the permission). Returns `false` for
 * plugins that have never been seen – that's the safe default
 * because we want a "no" answer to be loud, not a "yes".
 */
export function hasPermission(pluginId: string, permission: PluginPermission): boolean {
  return grants.get(pluginId)?.has(permission) ?? false
}
