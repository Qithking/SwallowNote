/** 插件遥测：收集事件、存储、钩子、IPC 指标 */

import type { PluginEvent, PluginEventPayloadMap } from '@/types/plugin'
import { getPluginStorageSize } from './tauri'
import { logger } from './logger'

// 指标类型

/** 单次事件发射记录 */
export interface EventMetric {
  timestamp: number
  pluginId: string
  event: PluginEvent
  payloadSize: number
  handlerCount: number
  totalDurationMs: number
  errors: number
}

/** 存储操作指标 */
export interface StorageMetric {
  timestamp: number
  pluginId: string
  operation: 'get' | 'set' | 'delete' | 'clear' | 'keys'
  keyCount: number
  dataSize: number
  durationMs: number
  success: boolean
  error?: string
}

/** 钩子调用指标 */
export interface HookMetric {
  timestamp: number
  pluginId: string
  hook: string
  durationMs: number
  success: boolean
  error?: string
}

/** 后端 IPC 调用指标 */
export interface BackendMetric {
  timestamp: number
  pluginId: string
  command: string
  durationMs: number
  success: boolean
  error?: string
}

/** 健康监控用的"最近错误"快照，区别于 HookMetric.error，用于诊断弹窗显示。 */
export interface PluginLastError {
  pluginId: string
  hook: string
  message: string
  timestamp: number
  /** 健康监控据此禁用插件时为 true */
  autoDisabled: boolean
}

/** 插件聚合指标 */
export interface PluginMetrics {
  pluginId: string
  totalEvents: number
  totalStorageOps: number
  totalHookInvocations: number
  totalBackendCalls: number
  totalErrors: number
  averageEventDurationMs: number
  averageStorageDurationMs: number
  storageSizeBytes: number
  lastActivity: number
}

// ─── In-memory metric store ───────────────────────────────────────────────────

const MAX_METRICS_PER_TYPE = 1000

const eventMetrics: EventMetric[] = []
const storageMetrics: StorageMetric[] = []
const hookMetrics: HookMetric[] = []
const backendMetrics: BackendMetric[] = []

/** 插件元数据缓存（存储尺寸跟踪） */
const pluginStorageSize = new Map<string, number>()

/** 指标版本计数器：记录时自增触发重渲染 */
let metricsVersion = 0

/** 自增版本计数器 */
function bumpMetricsVersion(): void {
  metricsVersion += 1
  // 迭代副本以避免订阅者取消订阅导致迭代错乱。
  if (metricsVersionSubscribers.size > 0) {
    for (const sub of Array.from(metricsVersionSubscribers)) {
      try {
        sub()
      } catch {
        // 吞掉订阅者异常，避免破坏记录路径。
      }
    }
  }
}

/** 返回当前指标版本号。 */
export function getMetricsVersion(): number {
  return metricsVersion
}

/** 指标版本订阅者集合。 */
const metricsVersionSubscribers = new Set<() => void>()

/** 订阅指标版本变化，返回取消订阅函数，兼容 useSyncExternalStore。 */
export function subscribeToMetricsVersion(onChange: () => void): () => void {
  metricsVersionSubscribers.add(onChange)
  return () => {
    metricsVersionSubscribers.delete(onChange)
  }
}

/** 用于归因冲突指标的合成 plugin id */
const HOST_PLUGIN_ID = 'host'

/** 每插件"最近错误"缓存：健康监控写入，诊断弹窗读取，卸载或恢复健康时清除。 */
const lastErrorByPlugin = new Map<string, PluginLastError>()

// 记录函数

/** 记录事件发射 */
export function recordEventMetric(
  pluginId: string,
  event: PluginEvent,
  payload: PluginEventPayloadMap[typeof event],
  handlerCount: number,
  totalDurationMs: number,
  errors: number
): void {
  const payloadSize = estimatePayloadSize(payload)

  eventMetrics.push({
    timestamp: Date.now(),
    pluginId,
    event,
    payloadSize,
    handlerCount,
    totalDurationMs,
    errors,
  })

  // Trim to max
  if (eventMetrics.length > MAX_METRICS_PER_TYPE) {
    eventMetrics.shift()
  }
  _metricsCache = null
  _groupsCache = null
  bumpMetricsVersion()

  // 合并到统一 LogStore（AC-8）：'ok'→info, 'err'→error
  const source = `plugin:${pluginId}`
  const msg = `event ${event} · ${handlerCount} handlers · ${totalDurationMs.toFixed(2)}ms${errors > 0 ? ` · ${errors} error(s)` : ''}`
  if (errors > 0) {
    logger.error(source, msg)
  } else {
    logger.info(source, msg)
  }
}

/** Record a storage operation */
export function recordStorageMetric(
  pluginId: string,
  operation: StorageMetric['operation'],
  keyCount: number,
  dataSize: number,
  durationMs: number,
  success: boolean,
  error?: string
): void {
  storageMetrics.push({
    timestamp: Date.now(),
    pluginId,
    operation,
    keyCount,
    dataSize,
    durationMs,
    success,
    error,
  })

  if (storageMetrics.length > MAX_METRICS_PER_TYPE) {
    storageMetrics.shift()
  }
  _metricsCache = null
  _groupsCache = null
  bumpMetricsVersion()

  // 合并到统一 LogStore（AC-8）
  const source = `plugin:${pluginId}`
  const msg = `storage.${operation} · ${keyCount} keys · ${dataSize}B · ${durationMs.toFixed(2)}ms${error ? ` · ${error}` : ''}`
  if (success) {
    logger.info(source, msg)
  } else {
    logger.error(source, msg)
  }

  // dataSize 为 set/delete 的尺寸增量（正增长/负收缩）。
  if (success && operation === 'set') {
    const current = pluginStorageSize.get(pluginId) ?? 0
    pluginStorageSize.set(pluginId, Math.max(0, current + dataSize))
  } else if (success && operation === 'delete') {
    const current = pluginStorageSize.get(pluginId) ?? 0
    pluginStorageSize.set(pluginId, Math.max(0, current - dataSize))
  } else if (success && operation === 'clear') {
    pluginStorageSize.set(pluginId, 0)
  }
}

/** 记录钩子调用 */
export function recordHookMetric(
  pluginId: string,
  hook: string,
  durationMs: number,
  success: boolean,
  error?: string
): void {
  hookMetrics.push({
    timestamp: Date.now(),
    pluginId,
    hook,
    durationMs,
    success,
    error,
  })

  if (hookMetrics.length > MAX_METRICS_PER_TYPE) {
    hookMetrics.shift()
  }
  _metricsCache = null
  _groupsCache = null
  bumpMetricsVersion()

  // 合并到统一 LogStore（AC-8）
  const source = `plugin:${pluginId}`
  const msg = `hook ${hook} · ${durationMs.toFixed(2)}ms${error ? ` · ${error}` : ''}`
  if (success) {
    logger.info(source, msg)
  } else {
    logger.error(source, msg)
  }
}

/** Record a backend IPC call */
export function recordBackendMetric(
  pluginId: string,
  command: string,
  durationMs: number,
  success: boolean,
  error?: string
): void {
  backendMetrics.push({
    timestamp: Date.now(),
    pluginId,
    command,
    durationMs,
    success,
    error,
  })

  if (backendMetrics.length > MAX_METRICS_PER_TYPE) {
    backendMetrics.shift()
  }
  _metricsCache = null
  _groupsCache = null
  bumpMetricsVersion()

  // 合并到统一 LogStore（AC-8）
  const source = `plugin:${pluginId}`
  const msg = `ipc ${command} · ${durationMs.toFixed(2)}ms${error ? ` · ${error}` : ''}`
  if (success) {
    logger.info(source, msg)
  } else {
    logger.error(source, msg)
  }
}

// 查询函数

/** 获取全部事件指标 */
export function getEventMetrics(): readonly EventMetric[] {
  return eventMetrics
}

/** Get all storage metrics */
export function getStorageMetrics(): readonly StorageMetric[] {
  return storageMetrics
}

/** 获取全部钩子指标 */
export function getHookMetrics(): readonly HookMetric[] {
  return hookMetrics
}

/** 获取全部后端指标 */
export function getBackendMetrics(): readonly BackendMetric[] {
  return backendMetrics
}

/** 按 pluginId 预分组缓存，避免每次调用全量过滤。 */
type PluginMetricGroup = {
  events: EventMetric[]
  storage: StorageMetric[]
  hooks: HookMetric[]
  backend: BackendMetric[]
}

let _groupsCache: Map<string, PluginMetricGroup> | null = null
let _groupsCacheAt = 0
const GROUPS_CACHE_TTL_MS = 1000

function getMetricGroups(): Map<string, PluginMetricGroup> {
  const now = Date.now()
  if (_groupsCache && now - _groupsCacheAt < GROUPS_CACHE_TTL_MS) {
    return _groupsCache
  }
  const groups = new Map<string, PluginMetricGroup>()
  const ensure = (id: string): PluginMetricGroup => {
    let g = groups.get(id)
    if (!g) {
      g = { events: [], storage: [], hooks: [], backend: [] }
      groups.set(id, g)
    }
    return g
  }
  for (const m of eventMetrics) ensure(m.pluginId).events.push(m)
  for (const m of storageMetrics) ensure(m.pluginId).storage.push(m)
  for (const m of hookMetrics) ensure(m.pluginId).hooks.push(m)
  for (const m of backendMetrics) ensure(m.pluginId).backend.push(m)
  _groupsCache = groups
  _groupsCacheAt = now
  return groups
}

function summariseGroup(pluginId: string, g: PluginMetricGroup): PluginMetrics {
  let totalEvents = 0
  let totalStorageOps = 0
  let totalHookInvocations = 0
  let totalBackendCalls = 0
  let totalErrors = 0
  let eventDurationSum = 0
  let storageDurationSum = 0
  let lastActivity = 0

  for (const m of g.events) {
    totalEvents++
    eventDurationSum += m.totalDurationMs
    totalErrors += m.errors
    if (m.timestamp > lastActivity) lastActivity = m.timestamp
  }
  for (const m of g.storage) {
    totalStorageOps++
    storageDurationSum += m.durationMs
    if (m.timestamp > lastActivity) lastActivity = m.timestamp
    if (!m.success) totalErrors++
  }
  for (const m of g.hooks) {
    totalHookInvocations++
    if (m.timestamp > lastActivity) lastActivity = m.timestamp
    if (!m.success) totalErrors++
  }
  for (const m of g.backend) {
    totalBackendCalls++
    if (m.timestamp > lastActivity) lastActivity = m.timestamp
    if (!m.success) totalErrors++
  }

  return {
    pluginId,
    totalEvents,
    totalStorageOps,
    totalHookInvocations,
    totalBackendCalls,
    totalErrors,
    averageEventDurationMs: totalEvents === 0 ? 0 : eventDurationSum / totalEvents,
    averageStorageDurationMs: totalStorageOps === 0 ? 0 : storageDurationSum / totalStorageOps,
    storageSizeBytes: pluginStorageSize.get(pluginId) ?? 0,
    lastActivity,
  }
}

export function getPluginMetrics(pluginId: string): PluginMetrics {
  const groups = getMetricGroups()
  const g = groups.get(pluginId) ?? {
    events: [],
    storage: [],
    hooks: [],
    backend: [],
  }
  return summariseGroup(pluginId, g)
}

/** 获取所有插件指标 */
let _metricsCache: PluginMetrics[] | null = null
let _metricsCacheAt = 0
const METRICS_CACHE_TTL_MS = 1000

export function getAllPluginMetrics(): PluginMetrics[] {
  const now = Date.now()
  if (_metricsCache && now - _metricsCacheAt < METRICS_CACHE_TTL_MS) {
    return _metricsCache
  }

  // 复用预分组结果汇总所有插件。
  const groups = getMetricGroups()
  const result: PluginMetrics[] = []
  for (const [id, g] of groups) {
    result.push(summariseGroup(id, g))
  }
  _metricsCache = result
  _metricsCacheAt = now
  return result
}

/** 清空全部指标 */
export function clearAllMetrics(): void {
  eventMetrics.length = 0
  storageMetrics.length = 0
  hookMetrics.length = 0
  backendMetrics.length = 0
  pluginStorageSize.clear()
  _metricsCache = null
  _groupsCache = null
  lastErrorByPlugin.clear()
  // bump（不重置）以确保订阅者检测到变化。
  bumpMetricsVersion()
}

/** 清除指定插件指标，逆序 splice 保持索引稳定 */
export function clearPluginMetrics(pluginId: string): void {
  for (let i = eventMetrics.length - 1; i >= 0; i--) {
    if (eventMetrics[i].pluginId === pluginId) eventMetrics.splice(i, 1)
  }
  for (let i = storageMetrics.length - 1; i >= 0; i--) {
    if (storageMetrics[i].pluginId === pluginId) storageMetrics.splice(i, 1)
  }
  for (let i = hookMetrics.length - 1; i >= 0; i--) {
    if (hookMetrics[i].pluginId === pluginId) hookMetrics.splice(i, 1)
  }
  for (let i = backendMetrics.length - 1; i >= 0; i--) {
    if (backendMetrics[i].pluginId === pluginId) backendMetrics.splice(i, 1)
  }
  pluginStorageSize.delete(pluginId)
  lastErrorByPlugin.delete(pluginId)
  _metricsCache = null
  _groupsCache = null
  // bump 以触发订阅者重渲染。
  bumpMetricsVersion()
}

/** 用 host 字节数初始化插件存储尺寸跟踪器 */
export function seedPluginStorageSizes(sizes: Record<string, number>): void {
  let changed = false
  for (const [pluginId, bytes] of Object.entries(sizes)) {
    const prev = pluginStorageSize.get(pluginId) ?? 0
    // 以 host 统计为准覆盖
    if (prev !== bytes) {
      pluginStorageSize.set(pluginId, Math.max(0, bytes))
      changed = true
    }
  }
  if (changed) {
    bumpMetricsVersion()
  }
}

/** 重新 stat 单个插件 storage.json 并更新跟踪器。 */
export async function refreshPluginStorageSize(pluginId: string): Promise<number | null> {
  const size = await getPluginStorageSize(pluginId)
  const prev = pluginStorageSize.get(pluginId) ?? 0
  if (size !== prev) {
    pluginStorageSize.set(pluginId, size)
    bumpMetricsVersion()
  }
  return size
}

/** 订阅 plugin-storage-changed 事件同步尺寸 */
export async function subscribeToPluginStorageChanges(): Promise<() => void> {
  if (pluginStorageChangesUnsub) return pluginStorageChangesUnsub
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<{ pluginId: string; size: number }>(
    'plugin-storage-changed',
    (event) => {
      const { pluginId, size } = event.payload
      if (!pluginId) return
      const prev = pluginStorageSize.get(pluginId) ?? 0
      if (size !== prev) {
        pluginStorageSize.set(pluginId, Math.max(0, size))
        bumpMetricsVersion()
      }
    }
  )
  pluginStorageChangesUnsub = unlisten
  return unlisten
}

let pluginStorageChangesUnsub: (() => void) | null = null

/** 返回所有被跟踪插件的存储总字节数。 */
export function getTotalPluginStorageBytes(): number {
  let total = 0
  for (const bytes of pluginStorageSize.values()) {
    total += bytes
  }
  return total
}

/** 读取插件缓存存储尺寸，无记录为 0 */
export function getPluginStorageBytes(pluginId: string): number {
  return pluginStorageSize.get(pluginId) ?? 0
}

/** 返回所有插件存储尺寸的快照（浅拷贝）。 */
export function getAllPluginStorageBytesSnapshot(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, bytes] of pluginStorageSize) {
    out[id] = bytes
  }
  return out
}

/** 测试专用：重置订阅状态。 */
export function __resetPluginStorageChangesForTests(): void {
  if (pluginStorageChangesUnsub) {
    pluginStorageChangesUnsub()
    pluginStorageChangesUnsub = null
  }
}

// 健康监控集成

/** 记录插件"最近错误"。autoDisabled 区分自动禁用与仅记录两种情况。 */
export function recordPluginError(
  pluginId: string,
  hook: string,
  message: string,
  autoDisabled: boolean = false,
): void {
  lastErrorByPlugin.set(pluginId, {
    pluginId,
    hook,
    message,
    timestamp: Date.now(),
    autoDisabled,
  })
}

/** 标记插件健康：清除 lastError，保留指标缓冲。 */
export function markPluginHealthy(pluginId: string): void {
  lastErrorByPlugin.delete(pluginId)
}

/** 返回最近错误，健康时为 undefined */
export function getPluginLastError(pluginId: string): PluginLastError | undefined {
  return lastErrorByPlugin.get(pluginId)
}

/** 手动清除最近错误缓存 */
export function clearPluginLastError(pluginId: string): void {
  lastErrorByPlugin.delete(pluginId)
}

// 插件冲突日志

/** 将插件冲突记录为合成的 HookMetric（hook=plugin.conflict），供 Logs 弹窗渲染。 */
export function recordPluginConflict(message: string): void {
  hookMetrics.push({
    timestamp: Date.now(),
    pluginId: HOST_PLUGIN_ID,
    hook: PLUGIN_CONFLICT_HOOK,
    durationMs: 0,
    success: true,
    error: message,
  })
  if (hookMetrics.length > MAX_METRICS_PER_TYPE) {
    hookMetrics.shift()
  }
  _metricsCache = null
  _groupsCache = null
  // bump 以让 Logs 弹窗感知新冲突。
  bumpMetricsVersion()

  // 合并到统一 LogStore（AC-8）：冲突归为 warn 级别
  logger.warn(`plugin:${HOST_PLUGIN_ID}`, message)
}

// 辅助函数

/** 估算 JSON 载荷字节数 */
function estimatePayloadSize(payload: unknown): number {
  try {
    return JSON.stringify(payload).length
  } catch {
    return 0
  }
}

/** Measure execution time of an async function */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now()
  const result = await fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

/** 测量同步函数执行耗时 */
export function measure<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now()
  const result = fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

// 日志格式化

/** 日志严重级别 */
export type LogLevel = 'info' | 'ok' | 'warn' | 'err'

/** conflict 类型用于弹窗分组渲染 */
export type LogLineGroup = 'normal' | 'conflict'

export const PLUGIN_CONFLICT_HOOK = 'plugin.conflict'

/** 可渲染的日志行 */
export interface FormattedLogLine {
  /** 指标时间戳 */
  timestamp: number
  /** HH:MM:SS.mmm 格式时间 */
  time: string
  /** 严重级别，用于配色 */
  level: LogLevel
  /** 插件 id */
  plugin: string
  /** 日志正文 */
  message: string
  group?: LogLineGroup
}

/** 所有指标记录的联合类型 */
export type AnyMetric = EventMetric | StorageMetric | HookMetric | BackendMetric

/** 将单条指标转换为日志行。严重级别默认 info，失败时升级。 */
export function formatLogLine(metric: AnyMetric, now: number = Date.now()): FormattedLogLine {
  const date = new Date(metric.timestamp)
  const time = formatTime(date)
  const plugin = metric.pluginId
  if ('event' in metric) {
    const m = metric as EventMetric
    const errs = m.errors
    const level: LogLevel = errs > 0 ? 'err' : 'ok'
    return {
      timestamp: m.timestamp,
      time,
      level,
      plugin,
      message: `event ${m.event} · ${m.handlerCount} handlers · ${m.totalDurationMs.toFixed(2)}ms${errs > 0 ? ` · ${errs} error(s)` : ''}`,
    }
  }
  if ('operation' in metric) {
    const m = metric as StorageMetric
    const level: LogLevel = m.success ? 'info' : 'err'
    return {
      timestamp: m.timestamp,
      time,
      level,
      plugin,
      message: `storage.${m.operation} · ${m.keyCount} keys · ${m.dataSize}B · ${m.durationMs.toFixed(2)}ms${m.error ? ` · ${m.error}` : ''}`,
    }
  }
  if ('hook' in metric) {
    const m = metric as HookMetric
    // 冲突条目归为 warn 级别和 'conflict' 分组。
    if (m.hook === PLUGIN_CONFLICT_HOOK) {
      return {
        timestamp: m.timestamp,
        time,
        level: 'warn',
        plugin,
        group: 'conflict',
        message: m.error ?? 'plugin conflict',
      }
    }
    const level: LogLevel = m.success ? 'info' : 'err'
    return {
      timestamp: m.timestamp,
      time,
      level,
      plugin,
      message: `hook ${m.hook} · ${m.durationMs.toFixed(2)}ms${m.error ? ` · ${m.error}` : ''}`,
    }
  }
  // BackendMetric 兜底分支
  const m = metric as BackendMetric
  const level: LogLevel = m.success ? 'info' : 'err'
  return {
    timestamp: m.timestamp,
    time,
    level,
    plugin,
    message: `ipc ${m.command} · ${m.durationMs.toFixed(2)}ms${m.error ? ` · ${m.error}` : ''}`,
  }
  // now 预留给未来的相对时间格式
  void now
}

/** 返回最近 limit 条日志，新到旧 */
export function getRecentLogLines(limit: number = 100): FormattedLogLine[] {
  // 合并环形缓冲比按插件汇总更省
  const events = eventMetrics
  const storage = storageMetrics
  const hooks = hookMetrics
  const backend = backendMetrics
  const all: AnyMetric[] = []
  for (const m of events) all.push(m)
  for (const m of storage) all.push(m)
  for (const m of hooks) all.push(m)
  for (const m of backend) all.push(m)
  return all
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((m) => formatLogLine(m))
}

// 日志导出

/** 目前仅支持 jsonl */
export type LogExportFormat = 'jsonl'

/** exportLogs 返回结果：渲染文本与记录数 */
export interface LogExportResult {
  /** 待写入的渲染文本 */
  text: string
  /** 实际写入的记录数 */
  recordCount: number
  /** 格式回显，供调用方分支 */
  format: LogExportFormat
}

/** exportLogs 的可选配置参数 */
export interface ExportLogsOptions {
  /** 记录数上限，过滤后应用；省略或非正值表示无上限。 */
  limit?: number
  /** 排序：'asc'（默认）或 'desc'。 */
  order?: 'asc' | 'desc'
}

/** 将指标缓冲构建为 jsonl 载荷。纯函数，可选 pluginId 过滤、limit、order。 */
export function exportLogs(
  pluginId?: string,
  format: LogExportFormat = 'jsonl',
  options: ExportLogsOptions = {},
): LogExportResult {
  const { limit, order = 'asc' } = options
  // 合并四个环形缓冲并按 timestamp 排序。
  const all: AnyMetric[] = []
  for (const m of eventMetrics) all.push(m)
  for (const m of storageMetrics) all.push(m)
  for (const m of hookMetrics) all.push(m)
  for (const m of backendMetrics) all.push(m)
  // 按 order 排序。
  all.sort((a, b) =>
    order === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
  )
  const filtered = pluginId
    ? all.filter((m) => m.pluginId === pluginId)
    : all
  // limit 在过滤后应用。
  const limited =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? filtered.slice(0, limit)
      : filtered

  // 渲染每条记录为带 kind 的 JSON 对象。
  const lines: string[] = []
  for (const m of limited) {
    const formatted = formatLogLine(m)
    if ('event' in m) {
      lines.push(
        JSON.stringify({
          kind: 'event',
          timestamp: m.timestamp,
          time: formatted.time,
          level: formatted.level,
          pluginId: m.pluginId,
          event: m.event,
          payloadSize: m.payloadSize,
          handlerCount: m.handlerCount,
          totalDurationMs: m.totalDurationMs,
          errors: m.errors,
        }),
      )
    } else if ('operation' in m) {
      lines.push(
        JSON.stringify({
          kind: 'storage',
          timestamp: m.timestamp,
          time: formatted.time,
          level: formatted.level,
          pluginId: m.pluginId,
          operation: m.operation,
          keyCount: m.keyCount,
          dataSize: m.dataSize,
          durationMs: m.durationMs,
          success: m.success,
          error: m.error ?? null,
        }),
      )
    } else if ('hook' in m) {
      lines.push(
        JSON.stringify({
          kind: 'hook',
          timestamp: m.timestamp,
          time: formatted.time,
          level: formatted.level,
          pluginId: m.pluginId,
          hook: m.hook,
          durationMs: m.durationMs,
          success: m.success,
          error: m.error ?? null,
        }),
      )
    } else {
      // BackendMetric
      lines.push(
        JSON.stringify({
          kind: 'ipc',
          timestamp: m.timestamp,
          time: formatted.time,
          level: formatted.level,
          pluginId: m.pluginId,
          command: m.command,
          durationMs: m.durationMs,
          success: m.success,
          error: m.error ?? null,
        }),
      )
    }
  }
  // 尾随换行遵循 POSIX 约定。
  const text = lines.length > 0 ? lines.join('\n') + '\n' : ''
  // format 预留给未来格式扩展
  void format
  return { text, recordCount: limited.length, format: 'jsonl' }
}

// 时间窗口聚合

/** 单时间窗口的聚合指标桶。 */
export interface TelemetryBucket {
  /** 桶起始时间戳（含） */
  startTs: number
  /** 桶结束时间戳（不含） */
  endTs: number
  /** 钩子调用数 */
  hookCount: number
  /** 后端 IPC 调用数 */
  backendCount: number
  /** 存储操作数 */
  storageCount: number
  /** 事件发射数 */
  eventCount: number
  /** 平均钩子耗时 ms */
  avgHookDurationMs: number
  /** 平均后端耗时 ms */
  avgBackendDurationMs: number
  /** 错误总数 */
  errorCount: number
  /** 操作总数 */
  totalCount: number
  /** 错误率 [0,1] */
  errorRate: number
}

/** 聚合参数 */
export interface TimeWindowAggregateOptions {
  /** 过滤插件 id；省略聚合所有插件 */
  pluginId?: string
  /** 桶宽 ms，默认 60000；非正返回空 */
  windowMs?: number
  /** 桶数，默认 30；非正返回空 */
  bucketCount?: number
  /** 参考 now 时间戳，默认 Date.now() */
  now?: number
}

/** 将指标缓冲聚合为固定数量的等宽时间窗口桶。 */
export function aggregateTelemetryByTimeWindow(
  options: TimeWindowAggregateOptions = {}
): TelemetryBucket[] {
  const {
    pluginId,
    windowMs = 60_000,
    bucketCount = 30,
    now = Date.now(),
  } = options

  // 防御性校验：非有限值返回空数组。
  if (!Number.isFinite(windowMs) || windowMs <= 0) return []
  if (!Number.isFinite(bucketCount) || bucketCount <= 0) return []

  const firstStart = now - bucketCount * windowMs
  const buckets: TelemetryBucket[] = new Array(bucketCount)
  for (let i = 0; i < bucketCount; i++) {
    const endTs = firstStart + (i + 1) * windowMs
    buckets[i] = {
      startTs: endTs - windowMs,
      endTs,
      hookCount: 0,
      backendCount: 0,
      storageCount: 0,
      eventCount: 0,
      avgHookDurationMs: 0,
      avgBackendDurationMs: 0,
      errorCount: 0,
      totalCount: 0,
      errorRate: 0,
    }
  }

  // 并行累加数组，末尾统一算均值
  const hookDurationSum = new Array<number>(bucketCount).fill(0)
  const backendDurationSum = new Array<number>(bucketCount).fill(0)

  // 计算时间戳所属桶索引。ts === now 归入最后一个桶。
  const place = (ts: number): number => {
    if (ts < firstStart) return -1
    if (ts > now) return -1
    if (ts === now) return bucketCount - 1
    const idx = Math.floor((ts - firstStart) / windowMs)
    return idx >= 0 && idx < bucketCount ? idx : -1
  }

  // 钩子指标：启动时长信号
  for (const m of hookMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.hookCount++
    b.totalCount++
    hookDurationSum[idx] += m.durationMs
    if (!m.success) b.errorCount++
  }
  // backend IPC 指标：次级时长信号。
  for (const m of backendMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.backendCount++
    b.totalCount++
    backendDurationSum[idx] += m.durationMs
    if (!m.success) b.errorCount++
  }
  // 存储操作仅计入总数和错误数
  for (const m of storageMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.storageCount++
    b.totalCount++
    if (!m.success) b.errorCount++
  }
  // 事件发射仅计入错误数
  for (const m of eventMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.eventCount++
    b.totalCount++
    b.errorCount += m.errors
  }

  // 计算均值与错误率
  for (let i = 0; i < bucketCount; i++) {
    const b = buckets[i]
    b.avgHookDurationMs = b.hookCount > 0 ? hookDurationSum[i] / b.hookCount : 0
    b.avgBackendDurationMs = b.backendCount > 0 ? backendDurationSum[i] / b.backendCount : 0
    b.errorRate = b.totalCount > 0 ? b.errorCount / b.totalCount : 0
  }

  return buckets
}

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
