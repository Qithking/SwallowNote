/**
 * Plugin Permission Manager
 * 
 * Handles permission checking, granting, and audit logging.
 */

import type { PluginPermission, PluginPermissionStatus } from '@/types/plugin'

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
