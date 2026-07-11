/** 插件诊断数据导出（JSON 包，用于排障和 bug 报告） */

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
// 从 package.json 导入版本号，避免硬编码（resolveJsonModule 已启用）
import { version } from '../../package.json'

// 诊断包类型

export interface DiagnosticBundle {
  version: string
  generatedAt: string
  appVersion: string
  userAgent: string
  platform: string

  // 插件列表
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

  // 聚合指标
  metrics: ReturnType<typeof getAllPluginMetrics>

  // 最近事件（末 100 条）
  recentEvents: ReturnType<typeof getEventMetrics>

  // 最近存储操作（末 100 条）
  recentStorage: ReturnType<typeof getStorageMetrics>

  // 最近 hook 调用（末 100 条）
  recentHooks: ReturnType<typeof getHookMetrics>

  // 最近后端调用（末 100 条）
  recentBackend: ReturnType<typeof getBackendMetrics>

  // 各插件崩溃计数
  crashCounts: Record<string, number>

  // 权限审计日志
  permissionLogs: PermissionAuditLogEntry[]
}

// 诊断包生成

/** 生成完整诊断包（异步，因需读取权限日志） */
export async function generateDiagnosticBundle(): Promise<DiagnosticBundle> {
  const pluginStore = usePluginStore.getState()
  const permissionLogs = await getPermissionAuditLogs()

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    appVersion: version,
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

/** 生成 JSON 字符串形式的诊断包 */
export async function generateDiagnosticBundleJson(): Promise<string> {
  const bundle = await generateDiagnosticBundle()
  return JSON.stringify(bundle, null, 2)
}

/** 下载诊断包为文件 */
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

/** 复制诊断包到剪贴板 */
export async function copyDiagnosticBundleToClipboard(): Promise<void> {
  const json = await generateDiagnosticBundleJson()
  await navigator.clipboard.writeText(json)
}

/** 获取诊断包为 Blob */
export async function getDiagnosticBundleBlob(): Promise<Blob> {
  const json = await generateDiagnosticBundleJson()
  return new Blob([json], { type: 'application/json' })
}
