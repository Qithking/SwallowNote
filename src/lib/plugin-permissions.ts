/**
 * Plugin Permission Manager
 *
 * Handles permission checking, granting, and audit logging.
 *
 * Persistence layout in `window.localStorage`:
 *   - `plugin_permissions_<pluginId>`: JSON of `PluginPermissionStatus[]`
 *   - `plugin_audit_log`:               JSON of `PermissionAuditLogEntry[]`
 *
 * The in-memory permission guard (`./plugin-permission-guard.ts`) is
 * what the event bus, storage, and backend IPC consult on the hot
 * path. We mirror every grant/revoke there so the UI and the host
 * can never disagree about whether a permission is granted.
 */

import type { PluginPermission, PluginPermissionStatus } from '@/types/plugin'
import { setGranted, clearGranted } from './plugin-permission-guard'

// Storage keys
const PERMISSIONS_KEY = 'plugin_permissions'
const AUDIT_LOG_KEY = 'plugin_audit_log'

/**
 * Get permission status for a plugin
 */
export async function getPluginPermissions(pluginId: string): Promise<PluginPermissionStatus[]> {
  try {
    const stored = await window.localStorage.getItem(`${PERMISSIONS_KEY}_${pluginId}`)
    if (!stored) return []
    
    return JSON.parse(stored)
  } catch {
    return []
  }
}

/**
 * Grant permissions to a plugin
 */
export async function grantPluginPermissions(
  pluginId: string,
  permissions: PluginPermission[]
): Promise<void> {
  const current = await getPluginPermissions(pluginId)

  const updated = permissions.map((p) => {
    const existing = current.find((s) => s.permission === p)
    return {
      permission: p,
      granted: true,
      requested: existing?.requested ?? true,
    }
  })

  await window.localStorage.setItem(`${PERMISSIONS_KEY}_${pluginId}`, JSON.stringify(updated))

  // Log the grant action
  await logPermissionAction(pluginId, 'grant', permissions)

  // Mirror to the in-memory guard. We compute the full granted set
  // (existing grants ∪ new grants) so we never accidentally revoke
  // a previously-granted permission that wasn't part of this call.
  const merged = new Set<PluginPermission>(updated.map((s) => s.permission))
  for (const s of current) {
    if (s.granted) merged.add(s.permission)
  }
  setGranted(pluginId, Array.from(merged))
}

/**
 * Revoke permissions from a plugin
 */
export async function revokePluginPermissions(
  pluginId: string,
  permissions: PluginPermission[]
): Promise<void> {
  const current = await getPluginPermissions(pluginId)

  const updated = current.map((status) => ({
    ...status,
    granted: permissions.includes(status.permission) ? false : status.granted,
  }))

  await window.localStorage.setItem(`${PERMISSIONS_KEY}_${pluginId}`, JSON.stringify(updated))

  // Log the revoke action
  await logPermissionAction(pluginId, 'revoke', permissions)

  // Mirror to the in-memory guard with the post-revoke granted set.
  const remaining = updated.filter((s) => s.granted).map((s) => s.permission)
  setGranted(pluginId, remaining)
}

/**
 * Check if a plugin has a specific permission
 */
export async function checkPluginPermission(
  pluginId: string,
  permission: PluginPermission
): Promise<boolean> {
  const permissions = await getPluginPermissions(pluginId)
  const status = permissions.find((p) => p.permission === permission)
  return status?.granted ?? false
}

/**
 * Check multiple permissions at once
 */
export async function checkPluginPermissions(
  pluginId: string,
  permissions: PluginPermission[]
): Promise<Record<PluginPermission, boolean>> {
  const current = await getPluginPermissions(pluginId)
  const result: Record<PluginPermission, boolean> = {} as Record<PluginPermission, boolean>
  
  for (const p of permissions) {
    const status = current.find((s) => s.permission === p)
    result[p] = status?.granted ?? false
  }
  
  return result
}

/**
 * Initialize permissions for a plugin (sets requested flags)
 */
export async function initializePluginPermissions(
  pluginId: string,
  requestedPermissions: PluginPermission[]
): Promise<void> {
  const current = await getPluginPermissions(pluginId)
  
  const updated: PluginPermissionStatus[] = []
  
  for (const p of requestedPermissions) {
    const existing = current.find((s) => s.permission === p)
    updated.push({
      permission: p,
      granted: existing?.granted ?? false,
      requested: true,
    })
  }
  
  // Keep existing permissions that are no longer requested but were granted
  for (const existing of current) {
    if (!requestedPermissions.includes(existing.permission) && existing.granted) {
      updated.push(existing)
    }
  }
  
  await window.localStorage.setItem(`${PERMISSIONS_KEY}_${pluginId}`, JSON.stringify(updated))
}

/**
 * Audit log entry
 */
export interface PermissionAuditLogEntry {
  timestamp: number
  pluginId: string
  action: 'grant' | 'revoke' | 'check'
  permissions: PluginPermission[]
  success: boolean
  reason?: string
}

/**
 * Log a permission action
 */
async function logPermissionAction(
  pluginId: string,
  action: 'grant' | 'revoke',
  permissions: PluginPermission[]
): Promise<void> {
  try {
    const stored = await window.localStorage.getItem(AUDIT_LOG_KEY)
    const logs: PermissionAuditLogEntry[] = stored ? JSON.parse(stored) : []

    logs.push({
      timestamp: Date.now(),
      pluginId,
      action,
      permissions,
      success: true,
    })

    // Keep only last 100 entries
    if (logs.length > 100) {
      logs.shift()
    }

    await window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(logs))
  } catch {
    // Silent fail for audit logging
  }
}

/**
 * Get audit logs
 */
export async function getPermissionAuditLogs(): Promise<PermissionAuditLogEntry[]> {
  try {
    const stored = await window.localStorage.getItem(AUDIT_LOG_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * Clear audit logs
 */
export async function clearPermissionAuditLogs(): Promise<void> {
  await window.localStorage.removeItem(AUDIT_LOG_KEY)
}

/**
 * Drop a plugin's permissions from both the disk store and the
 * in-memory guard. Called on uninstall. The localStorage key is
 * deleted (not zeroed) so the next install of a plugin with the
 * same id starts from a clean slate.
 */
export async function dropPluginPermissions(pluginId: string): Promise<void> {
  await window.localStorage.removeItem(`${PERMISSIONS_KEY}_${pluginId}`)
  clearGranted(pluginId)
}

/**
 * Seed the in-memory guard from localStorage. Called on app start so
 * the host services (event bus, storage, backend) can run a
 * synchronous permission check on the first user action without
 * waiting on the next grant/revoke.
 *
 * `pluginIds` is the list of installed plugin ids; we need it because
 * localStorage is a flat key/value store with no listing query that
 * doesn't depend on the `Object.keys` order.
 */
export async function hydratePermissionGuard(pluginIds: string[]): Promise<void> {
  for (const id of pluginIds) {
    const status = await getPluginPermissions(id)
    const granted = status.filter((s) => s.granted).map((s) => s.permission)
    if (granted.length > 0) {
      setGranted(id, granted)
    }
  }
}
