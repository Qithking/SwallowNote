/** 插件权限管理：检查、授权、审计日志 */

import type { PluginPermission, PluginPermissionStatus } from '@/types/plugin'
import { setGranted, clearGranted } from './plugin-permission-guard'

// 存储键
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

/** 授权插件权限 */
export async function grantPluginPermissions(
  pluginId: string,
  permissions: PluginPermission[]
): Promise<void> {
  const current = await getPluginPermissions(pluginId)

  // 合并：保留既有授权并新增 granted:true
  const byName = new Map<string, PluginPermissionStatus>(
    current.map((s) => [s.permission, s] as const),
  )
  for (const p of permissions) {
    const existing = byName.get(p)
    byName.set(p, {
      permission: p,
      granted: true,
      requested: existing?.requested ?? true,
    })
  }
  const updated = Array.from(byName.values())

  await window.localStorage.setItem(`${PERMISSIONS_KEY}_${pluginId}`, JSON.stringify(updated))

  // 记录授权操作
  await logPermissionAction(pluginId, 'grant', permissions)

  // 同步到内存 guard，仅含 granted 项
  const merged = new Set<PluginPermission>()
  for (const s of updated) {
    if (s.granted) merged.add(s.permission)
  }
  setGranted(pluginId, Array.from(merged))
}

/** 撤销插件权限 */
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

  // 记录撤销操作
  await logPermissionAction(pluginId, 'revoke', permissions)

  // 同步撤销后授权集到 guard
  const remaining = updated.filter((s) => s.granted).map((s) => s.permission)
  setGranted(pluginId, remaining)
}

/** 检查插件是否有指定权限 */
export async function checkPluginPermission(
  pluginId: string,
  permission: PluginPermission
): Promise<boolean> {
  const permissions = await getPluginPermissions(pluginId)
  const status = permissions.find((p) => p.permission === permission)
  return status?.granted ?? false
}

/** 批量检查权限 */
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

/** 初始化插件权限（设置 requested） */
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
  
  // 保留不再请求但已授权的权限
  for (const existing of current) {
    if (!requestedPermissions.includes(existing.permission) && existing.granted) {
      updated.push(existing)
    }
  }
  
  await window.localStorage.setItem(`${PERMISSIONS_KEY}_${pluginId}`, JSON.stringify(updated))
}

/** 审计日志条目 */
export interface PermissionAuditLogEntry {
  timestamp: number
  pluginId: string
  action: 'grant' | 'revoke' | 'check'
  permissions: PluginPermission[]
  success: boolean
  reason?: string
}

/** 记录权限操作 */
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

    // 仅保留最近 100 条
    if (logs.length > 100) {
      logs.shift()
    }

    await window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(logs))
  } catch {
    // 审计日志静默失败
  }
}

/** 获取审计日志 */
export async function getPermissionAuditLogs(): Promise<PermissionAuditLogEntry[]> {
  try {
    const stored = await window.localStorage.getItem(AUDIT_LOG_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/** 清空审计日志 */
export async function clearPermissionAuditLogs(): Promise<void> {
  await window.localStorage.removeItem(AUDIT_LOG_KEY)
}

/** 卸载时清除插件权限与内存 guard */
export async function dropPluginPermissions(pluginId: string): Promise<void> {
  await window.localStorage.removeItem(`${PERMISSIONS_KEY}_${pluginId}`)
  clearGranted(pluginId)
}

/** 启动时从 localStorage 填充内存 guard */
export async function hydratePermissionGuard(pluginIds: string[]): Promise<void> {
  await Promise.all(
    pluginIds.map(async (id) => {
      const status = await getPluginPermissions(id)
      const granted = status.filter((s) => s.granted).map((s) => s.permission)
      if (granted.length > 0) {
        setGranted(id, granted)
      }
    }),
  )
}
