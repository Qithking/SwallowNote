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
  
  // Update storage size tracking. The host now passes a signed
  // `dataSize` for `set` (new − old) so an overwrite of a 100-byte
  // value with a 30-byte value reports −70 instead of double-
  // counting +30. The tracker treats any value as the size delta
  // to apply — positive for growth, negative for shrinkage — and
  // clamps to 0 to defend against metric drift.
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

/**
 * Get aggregated metrics for a plugin.
 *
 * Performance: the previous implementation called `.filter()` on
 * all four metric arrays per plugin, which made the typical
 * `getAllPluginMetrics()` call O(4 × N × M) (N plugins × M total
 * metrics). For a 200-plugin install with 1000 events buffered
 * per type, that's 800 000 array allocations + scans per click.
 *
 * We pre-group the metrics by plugin id into per-id lists (one
 * pass per array, O(M)) and reuse the groups across all
 * `getPluginMetrics` calls. The total cost of a full snapshot
 * is now O(4M + N) instead of O(4NM).
 */
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

  // Reuse the pre-grouped metrics from `getMetricGroups` (O(4M))
  // and summarise each plugin in a single pass. The previous
  // implementation called `getPluginMetrics(id)` per id, which
  // looked up the group, only to immediately throw it away — but
  // because `getPluginMetrics` did its own `.filter()` scan over
  // all four arrays, the total cost was O(4M) per call × N ids.
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
  _metricsCache = null
  _groupsCache = null
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
}

/** Union of all metric record types — accepted by `formatLogLine`. */
export type AnyMetric = EventMetric | StorageMetric | HookMetric | BackendMetric

/**
 * Convert a single metric record to a display-ready log line. The shape
 * stays the same regardless of source (`event` / `storage` / `hook` /
 * `backend`) so the popup can stream them in arrival order. Severity
 * defaults to `info` and is upgraded to `err` for storage/hook/backend
 * records whose `success === false`, and to `warn` for `success` storage
 * ops on a permission-style hook.
 *
 * We intentionally do not consult any I/O: this is a pure transformation
 * over the metric snapshot the popup is iterating over, so it stays
 * cheap enough to run for every line on every render.
 */
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

function formatTime(d: Date): string {
  const pad = (n: number, w: number = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
