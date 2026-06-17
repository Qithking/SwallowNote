/**
 * Plugin Telemetry
 * 
 * Collects observability metrics for plugins:
 * - Event payload sizes and handler durations
 * - Storage sizes and operation counts
 * - Hook invocation timing
 * - Backend IPC call latency
 */

import type { PluginEvent, PluginEventPayloadMap } from '@/types/plugin'
import { getPluginStorageSize } from './tauri'

// ─── Metric types ─────────────────────────────────────────────────────────────

/** A single event emission record */
export interface EventMetric {
  timestamp: number
  pluginId: string
  event: PluginEvent
  payloadSize: number
  handlerCount: number
  totalDurationMs: number
  errors: number
}

/** Storage operation metric */
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

/** Hook invocation metric */
export interface HookMetric {
  timestamp: number
  pluginId: string
  hook: string
  durationMs: number
  success: boolean
  error?: string
}

/** Backend IPC call metric */
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
  /** True when the health monitor disabled the plugin as a
   *  consequence of this error. False for hook-internal errors
   *  that the host surfaces but doesn't act on. */
  autoDisabled: boolean
}

/** Aggregated plugin metrics */
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

/** Plugin metadata cache (for storage size tracking) */
const pluginStorageSize = new Map<string, number>()

/**
 * 指标版本计数器：记录新指标时自增，供 usePluginTelemetryVersion 订阅触发重渲染。
 * clearAllMetrics 重置为 0；每次 recordX 调用通过 bumpMetricsVersion 自增。
 */
let metricsVersion = 0

/** Bump the version counter. Called by every recorder. */
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

/** Synthetic plugin id used to attribute conflict metrics to the
 *  host (the conflict detector lives in the host, not in any
 *  individual plugin). Keeping it as a const string means log
 *  filter chips can treat the host entries uniformly. */
const HOST_PLUGIN_ID = 'host'

/** 每插件"最近错误"缓存：健康监控写入，诊断弹窗读取，卸载或恢复健康时清除。 */
const lastErrorByPlugin = new Map<string, PluginLastError>()

// ─── Recording functions ─────────────────────────────────────────────────────

/** Record an event emission */
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

/** Record a hook invocation */
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
}

// ─── Query functions ──────────────────────────────────────────────────────────

/** Get all event metrics */
export function getEventMetrics(): readonly EventMetric[] {
  return eventMetrics
}

/** Get all storage metrics */
export function getStorageMetrics(): readonly StorageMetric[] {
  return storageMetrics
}

/** Get all hook metrics */
export function getHookMetrics(): readonly HookMetric[] {
  return hookMetrics
}

/** Get all backend metrics */
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

/** Get metrics for all plugins */
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

/** Clear all metrics */
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

/** Clear metrics for a specific plugin. We splice each array in
 *  reverse order so the indexes of the remaining items don't shift
 *  while we iterate. */
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

/**
 * 用 host 的权威字节数初始化/覆盖插件存储尺寸跟踪器。
 * 启动和文件变更时调用；单次调用最多 bump 一次以合并重渲染。
 */
export function seedPluginStorageSizes(sizes: Record<string, number>): void {
  let changed = false
  for (const [pluginId, bytes] of Object.entries(sizes)) {
    const prev = pluginStorageSize.get(pluginId) ?? 0
    // Always overwrite — the host's stat is the source of
    // truth. The JS-side delta tracker can be ahead (pending
    // `set` not yet flushed) but that's bounded by the size
    // of one in-flight value, and a future set/delete will
    // reconcile it.
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

/**
 * 订阅 host 的 plugin-storage-changed 事件以同步外部写入造成的尺寸变化。
 * 返回取消订阅函数；动态 import 以避免测试环境的硬依赖。
 */
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

/** Read the cached storage size for a single plugin (0
 *  if the plugin has no record in the tracker). */
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

// ─── Health-monitor integration ─────────────────────────────────────────────

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

/**
 * Get the most recent health-monitor error for a plugin, if any.
 * Returns `undefined` when the plugin is healthy (no recorded
 * error) or when the last error was cleared via
 * `markPluginHealthy` / `clearPluginLastError`.
 */
export function getPluginLastError(pluginId: string): PluginLastError | undefined {
  return lastErrorByPlugin.get(pluginId)
}

/**
 * Manually clear a plugin's cached "last error". Used by the
 * diagnostics popup's "Clear error" button, and by the store on
 * a successful re-enable so the badge transitions cleanly.
 */
export function clearPluginLastError(pluginId: string): void {
  lastErrorByPlugin.delete(pluginId)
}

// ─── Plugin conflict logging (Task 13 / G13) ───────────────────────────────

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
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/** Estimate the size of a JSON-serializable payload in bytes */
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

/** Measure execution time of a sync function */
export function measure<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now()
  const result = fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

// ─── Log formatting (for the new Logs popup) ────────────────────────────────

/** Log severity for the formatted log line. */
export type LogLevel = 'info' | 'ok' | 'warn' | 'err'

/** Visual grouping hint used by the Logs popup. Plain metric
 *  lines default to `'normal'`; conflict entries are tagged
 *  `'conflict'` so the popup can render them under a dedicated
 *  "⚠️ Conflict" header above the regular stream. */
export type LogLineGroup = 'normal' | 'conflict'

/** Synthetic hook name recorded for conflict entries. Used by
 *  `formatLogLine` to recognise the special "host-attributed"
 *  log line and route it to the conflict group. */
export const PLUGIN_CONFLICT_HOOK = 'plugin.conflict'

/** One formatted line ready to render in the Logs popup. */
export interface FormattedLogLine {
  /** Timestamp the host recorded for the metric. */
  timestamp: number
  /** Time formatted as `HH:MM:SS.mmm`. */
  time: string
  /** Severity used to pick the colour-coded chip. */
  level: LogLevel
  /** Plugin id (short, may be elided for host events). */
  plugin: string
  /** Plain-text body of the log line. Caller can still add `<b>` markup. */
  message: string
  /** Visual grouping hint for the Logs popup. Defaults to
   *  `'normal'` for ordinary metric entries; conflict
   *  detections (Task 13 / G13) set this to `'conflict'` so
   *  the popup can render a dedicated warning section. */
  group?: LogLineGroup
}

/** Union of all metric record types — accepted by `formatLogLine`. */
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
  // BackendMetric (must be last because every other type has a discriminator above)
  const m = metric as BackendMetric
  const level: LogLevel = m.success ? 'info' : 'err'
  return {
    timestamp: m.timestamp,
    time,
    level,
    plugin,
    message: `ipc ${m.command} · ${m.durationMs.toFixed(2)}ms${m.error ? ` · ${m.error}` : ''}`,
  }
  // `now` is reserved for future "x seconds ago" formatting.
  void now
}

/** Return up to `limit` log lines, newest first. */
export function getRecentLogLines(limit: number = 100): FormattedLogLine[] {
  // We use `getAllPluginMetrics` indirectly through the per-type helpers
  // because the host already keeps three ring buffers; merging them
  // is cheaper than asking the plugin store for a per-plugin summary.
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

// ─── Export (Task 8 / G8) ──────────────────────────────────────────────────

/** Supported on-disk formats for `exportLogs`. Currently only
 *  `jsonl` is implemented; the union is kept narrow so the UI
 *  can pass a literal without widening to `string`. */
export type LogExportFormat = 'jsonl'

/** Outcome of a single `exportLogs` call. We return both the
 *  rendered text and the count of records the caller can echo
 *  in a toast – the dialog doesn't have to re-walk the metrics
 *  arrays to figure out "how many lines did I just save?". */
export interface LogExportResult {
  /** Rendered, ready-to-write payload. */
  text: string
  /** Number of metric records actually written. */
  recordCount: number
  /** Format string echoed back so the caller can branch
   *  (e.g. for future CSV / text variants). */
  format: LogExportFormat
}

/** Options that tune `exportLogs` without widening its positional
 *  argument list. Both fields are optional; the defaults preserve
 *  the original "full ring buffer, oldest-first" contract that
 *  pre-existing callers (and the TC-08 tests) rely on. */
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
  // `format` is reserved for future variants; the call site
  // already passes the literal and a future PR can branch on
  // it without breaking the public signature.
  void format
  return { text, recordCount: limited.length, format: 'jsonl' }
}

// ─── Time-window aggregation (Task 12 / G12) ────────────────────────────────

/** 单时间窗口的聚合指标桶。 */
export interface TelemetryBucket {
  /** Bucket start timestamp (inclusive, ms since epoch). */
  startTs: number
  /** Bucket end timestamp (exclusive, ms since epoch). */
  endTs: number
  /** Number of lifecycle hook invocations in this bucket. */
  hookCount: number
  /** Number of backend IPC calls in this bucket. */
  backendCount: number
  /** Number of storage operations in this bucket. */
  storageCount: number
  /** Number of event emissions in this bucket. */
  eventCount: number
  /** Average hook duration in ms; `0` when `hookCount === 0`. */
  avgHookDurationMs: number
  /** Average backend IPC duration in ms; `0` when `backendCount === 0`. */
  avgBackendDurationMs: number
  /** Sum of errors across every metric type in this bucket. */
  errorCount: number
  /** Total number of operations in this bucket. */
  totalCount: number
  /** Error rate `errorCount / totalCount` in `[0, 1]`. `0` when empty. */
  errorRate: number
}

/** Options for `aggregateTelemetryByTimeWindow`. */
export interface TimeWindowAggregateOptions {
  /**
   * Plugin id to filter by. Omit (or pass `undefined`) to aggregate
   * every plugin's records into the same windowed view.
   */
  pluginId?: string
  /**
   * Window size in ms per bucket. Default 60_000 (1 minute). Must
   * be a positive finite number; non-positive values yield an empty
   * result rather than throwing – the sparkline is a "best effort"
   * visualisation, and a misconfigured width should be ignored.
   */
  windowMs?: number
  /**
   * Number of buckets to return. Default 30. Must be a positive
   * integer; non-positive values yield an empty result.
   */
  bucketCount?: number
  /**
   * Reference "now" timestamp (ms since epoch). Defaults to
   * `Date.now()`. Pinning `now` makes the function deterministic
   * for tests so a record recorded at `T` always lands in the
   * same bucket regardless of when the test runs.
   */
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

  // Parallel sum arrays so we can compute averages in a single
  // divide at the end. Reusing fixed-length arrays avoids the GC
  // pressure of allocating inside the per-record loop.
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

  // Hook metrics – the closest signal to "plugin startup time"
  // for the sparkline. We track the running duration sum so the
  // average is `sum / count` at the end.
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
  // Storage operations contribute to the total count and error
  // count but are not "duration"-bearing in the sparkline's
  // vocabulary (we don't want a long `storage.get` to skew the
  // "startup time" line).
  for (const m of storageMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.storageCount++
    b.totalCount++
    if (!m.success) b.errorCount++
  }
  // Event emissions – same rationale as storage: contribute to
  // the error count (the event metric records `errors` as a
  // per-emission integer) but not to the duration line.
  for (const m of eventMetrics) {
    if (pluginId !== undefined && m.pluginId !== pluginId) continue
    const idx = place(m.timestamp)
    if (idx < 0) continue
    const b = buckets[idx]
    b.eventCount++
    b.totalCount++
    b.errorCount += m.errors
  }

  // Finalise averages and error rates. The error rate is the
  // primary input to the sparkline's color picker; we compute it
  // here so the rendering layer never has to.
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
