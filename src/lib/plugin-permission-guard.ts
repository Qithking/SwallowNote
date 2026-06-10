/**
 * Plugin permission enforcement.
 *
 * This module is the runtime sandbox for the permission model. The
 * three "permission-bearing" host services (event bus, storage,
 * backend IPC) all consult `assertPermission(...)` before doing work
 * so a plugin can never reach a feature the user hasn't approved.
 *
 * The store of truth is `window.localStorage` (see
 * `plugin-permissions.ts`) but every check is hot-path code, so we
 * mirror grants into an in-memory `Set` and refresh it eagerly when
 * a grant/revoke lands. The localStorage write is the source of
 * truth – the in-memory cache is rebuilt from it at app start and
 * on every `setGranted(...)` / `clearAll()` call.
 *
 * Synchronous-only contract
 * -------------------------
 * The event bus `on()` and storage constructor are sync, so the
 * permission gate has to be sync too. We therefore forbid the
 * granted cache from doing any I/O on the read path; any pending
 * localStorage write is dropped on app restart, and the next
 * `getPluginPermissions` (called by the UI for display) will
 * re-materialize the cache.
 */
import type { PluginPermission } from '@/types/plugin'

/**
 * Thrown by `assertPermission` when a plugin attempts a protected
 * operation without the corresponding grant.
 *
 * Subclassing `Error` keeps the V8 stack readable. The class name
 * is also exported so plugins can `instanceof` it and degrade
 * gracefully (e.g. show "missing permission" UI) instead of showing
 * a raw stack trace.
 */
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

/**
 * Synchronous, hot-path permission check. Throws
 * `PluginPermissionDeniedError` if the grant is missing. We throw
 * rather than return a boolean so a plugin author can't accidentally
 * drop the error on the floor (`if (check()) ...` is a footgun for
 * security checks).
 */
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
