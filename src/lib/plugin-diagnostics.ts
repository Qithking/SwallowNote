/**
 * Plugin Diagnostics Export
 *
 * Exports plugin diagnostic data (metrics, errors, config) as a JSON bundle.
 * Used for troubleshooting and bug reports.
 */

import {
  getAllPluginMetrics,
  getEventMetrics,
  getStorageMetrics,
  getHookMetrics,
  getBackendMetrics,
} from './plugin-telemetry'
import { getPermissionAuditLogs, type PermissionAuditLogEntry } from './plugin-permissions'
import { getPluginCrashCount } from './plugin-health'
import { usePluginStore } from '@/stores'

// ─── Diagnostic bundle types ─────────────────────────────────────────────────

export interface DiagnosticBundle {
  version: string
  generatedAt: string
  appVersion: string
  userAgent: string
  platform: string

  // Plugin list
  plugins: Array<{
    id: string
    name: string
    version: string
    author: string
    enabled: boolean
    iconPosition?: string
    contentPosition?: string
    pluginPath: string
    hasBackend: boolean
  }>

  // Aggregated metrics
  metrics: ReturnType<typeof getAllPluginMetrics>

  // Recent events (last 100)
  recentEvents: ReturnType<typeof getEventMetrics>

  // Recent storage operations (last 100)
  recentStorage: ReturnType<typeof getStorageMetrics>

  // Recent hook invocations (last 100)
  recentHooks: ReturnType<typeof getHookMetrics>

  // Recent backend calls (last 100)
  recentBackend: ReturnType<typeof getBackendMetrics>

  // Crash counts per plugin
  crashCounts: Record<string, number>

  // Permission audit logs
  permissionLogs: PermissionAuditLogEntry[]
}

// ─── Bundle generation ────────────────────────────────────────────────────────

/**
 * Generate a complete diagnostic bundle
 *
 * `getPermissionAuditLogs` is async (it reads from disk) so the whole
 * bundle is produced asynchronously. Callers that need a sync snapshot
 * should be aware that permissionLogs will be `[]` until the promise
 * resolves.
 */
export async function generateDiagnosticBundle(): Promise<DiagnosticBundle> {
  const pluginStore = usePluginStore.getState()
  const permissionLogs = await getPermissionAuditLogs()

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    appVersion: '0.1.0', // Could be imported from package.json
    userAgent: navigator.userAgent,
    platform: navigator.platform,

    plugins: pluginStore.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      author: p.author,
      enabled: p.enabled,
      iconPosition: p.iconPosition,
      contentPosition: p.contentPosition,
      pluginPath: p.pluginPath,
      hasBackend: p.hasBackend,
    })),

    metrics: getAllPluginMetrics(),
    recentEvents: getEventMetrics().slice(-100),
    recentStorage: getStorageMetrics().slice(-100),
    recentHooks: getHookMetrics().slice(-100),
    recentBackend: getBackendMetrics().slice(-100),

    crashCounts: pluginStore.plugins.reduce((acc, p) => {
      const count = getPluginCrashCount(p.id)
      if (count > 0) acc[p.id] = count
      return acc
    }, {} as Record<string, number>),

    permissionLogs,
  }
}

/**
 * Generate diagnostic bundle as a JSON string
 */
export async function generateDiagnosticBundleJson(): Promise<string> {
  const bundle = await generateDiagnosticBundle()
  return JSON.stringify(bundle, null, 2)
}

/**
 * Download diagnostic bundle as a file
 */
export async function downloadDiagnosticBundle(): Promise<void> {
  const json = await generateDiagnosticBundleJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.href = url
  link.download = `swallow-note-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  URL.revokeObjectURL(url)
}

/**
 * Copy diagnostic bundle to clipboard
 */
export async function copyDiagnosticBundleToClipboard(): Promise<void> {
  const json = await generateDiagnosticBundleJson()
  await navigator.clipboard.writeText(json)
}

/**
 * Get bundle as a Blob (useful for programmatic use)
 */
export async function getDiagnosticBundleBlob(): Promise<Blob> {
  const json = await generateDiagnosticBundleJson()
  return new Blob([json], { type: 'application/json' })
}
