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

/**
 * Health-related error record. Distinct from a regular hook
 * `error` (which is a string attached to a `HookMetric`) – this
 * is the per-plugin "last error" snapshot the diagnostics popup
 * shows at the top of the unhealthy plugin's row, and that the
 * plugin health monitor consults when it auto-disables a wedged
 * plugin. The shape is intentionally narrow: hook name, message,
 * timestamp, and whether the plugin was auto-disabled.
 */
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
 * M15 (Wave D review) — `metricsVersion` is a monotonically
 * increasing counter that bumps on every metric-recording call.
 * Consumers that want to re-render whenever the host records new
 * telemetry (e.g. `PluginManagerView` computing the stats ribbon /
 * storage meter / errors counter) read the counter via
 * `getMetricsVersion()` and include it in their `useEffect` deps
 * (or call `usePluginTelemetryVersion()` from `@/hooks`).
 *
 * Why not just call `getAllPluginMetrics()` on an interval? The
 * metric buffers are bounded (1000 entries × 4 arrays = 4000
 * records), but `getAllPluginMetrics` still does O(4M + N) work on
 * every call, and an interval is a free constant-rate re-render
 * even when nothing is happening. A version counter is O(1) and
 * only fires when there's actually a new metric to fold in.
 *
 * The counter starts at 0 and is bumped in every recorder
 * (`recordEventMetric` / `recordStorageMetric` / etc.) via
 * `bumpMetricsVersion()`. `clearAllMetrics()` resets it to 0
 * (the right thing — the "after a clear" UI is the same as the
 * "before any metric" UI). The companion hook
 * `usePluginTelemetryVersion` reads it via a `useSyncExternalStore`
 * subscription so React batches the re-render correctly.
 */
let metricsVersion = 0

/** Bump the version counter. Called by every recorder. */
function bumpMetricsVersion(): void {
  metricsVersion += 1
  // Notify all subscribers. The set is iterated over a copy
  // so a subscriber that unsubscribes itself (or another
  // subscriber) mid-notification doesn't disturb the
  // iteration order. Subscribers are React's
  // `useSyncExternalStore` `onChange` callbacks, which schedule
  // a re-render — they are guaranteed to be cheap (no
  // user-supplied code runs in the body) so we call them
  // synchronously and let React batch the subsequent renders.
  if (metricsVersionSubscribers.size > 0) {
    for (const sub of Array.from(metricsVersionSubscribers)) {
      try {
        sub()
      } catch {
        // A throwing subscriber shouldn't break the recorder
        // path. Swallow the error and continue notifying
        // siblings — the next render pass will surface the
        // problem to the developer console via React's own
        // error boundary.
      }
    }
  }
}

/**
 * Return the current metrics version. The counter increments
 * exactly once per recorded metric (event / storage / hook /
 * backend) and once on `clearAllMetrics`. Callers can include
 * the return value in a `useEffect` dep array to recompute
 * derived state (e.g. the `PluginManagerView` stats ribbon)
 * whenever new telemetry lands.
 */
export function getMetricsVersion(): number {
  return metricsVersion
}

/**
 * Subscribers to the metrics version counter. Kept module-local
 * so recorders can notify it without a circular import. The
 * `usePluginTelemetryVersion` React hook is the primary
 * consumer; tests can subscribe directly to assert notification
 * behaviour without spinning up a renderer.
 */
const metricsVersionSubscribers = new Set<() => void>()

/**
 * Subscribe to metrics-version changes. The returned function
 * is a `useSyncExternalStore`-compatible unsubscribe — calling
 * it removes the callback from the notification set. The
 * callback is invoked once per `recordX` / `clearAllMetrics`
 * call (NOT per microtask), so a busy host that emits a
 * thousand metrics notifies a thousand times — React batches
 * the resulting re-renders.
 */
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

/**
 * Per-plugin "last error" cache. The plugin health monitor writes
 * here when it auto-disables a wedged plugin; the diagnostics popup
 * reads from here to surface a one-liner at the top of the
 * unhealthy plugin's row. Cleared on uninstall so a reinstall
 * starts with a clean slate. We also clear it on a successful
 * hook fire (`markPluginHealthy`) so the badge transitions to
 * "healthy" and the error line disappears.
 */
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
  lastErrorByPlugin.clear()
  // Bump the version counter (do *not* reset to 0) so the
  // `usePluginTelemetryVersion` subscriber sees a fresh value
  // and re-renders. We use a strictly-increasing counter so
  // every recorder call — including a `clearAllMetrics` that
  // happens to land on the same numeric value as the previous
  // state — still produces a new `Object.is` transition.
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
  // Wave C / Minor 7: bump the version counter so React
  // subscribers (`usePluginTelemetryVersion` consumers like
  // `PluginManagerView`'s stats ribbon / storage meter / errors
  // counter) re-render and recompute their snapshots. Without
  // this, a freshly-uninstalled plugin's residual metrics would
  // keep showing in the ribbon until the next recorder call –
  // which on a quiet host could mean "until the next user
  // action". Mirrors the same `bumpMetricsVersion()` call in
  // `clearAllMetrics` and every `recordX` function.
  bumpMetricsVersion()
}

// ─── Health-monitor integration ─────────────────────────────────────────────

/**
 * Record an error for a plugin. Called by the plugin health
 * monitor when a lifecycle hook exceeds the timeout, and by other
 * callers (host shutdown handlers, permission errors) that want
 * to surface a "last error" line in the diagnostics popup. The
 * `autoDisabled` flag is set when the monitor flipped the plugin
 * to disabled as a consequence of the error; it lets the UI
 * decide whether to render the error chip as a "you were
 * auto-disabled" warning vs. a soft "we logged this but did
 * nothing" note.
 */
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

/**
 * Mark a plugin healthy. Called when a lifecycle hook completes
 * within its timeout window; clears the cached `lastError` so
 * the diagnostics popup stops showing a stale error from a prior
 * wedged run. Does NOT touch the metrics ring buffers – a
 * successful run is allowed to leave its `recordHookMetric` entry
 * in the hook log; we only erase the "last error" highlight.
 */
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

/**
 * Record a single plugin conflict to the telemetry ring buffer.
 * The conflict detector in `plugin-conflicts.ts` returns a flat
 * list of `PluginConflict` records; the store hands them here so
 * the Logs popup can render them under a dedicated "⚠️ Conflict"
 * group (and the jsonl export picks them up alongside the rest
 * of the host's hook activity).
 *
 * The metric is recorded as a synthetic host-attributed
 * `HookMetric` with `hook === PLUGIN_CONFLICT_HOOK`. We re-use
 * the hook ring buffer because conflict detection is conceptually
 * a "host lifecycle event" — a one-shot scan that produced a
 * structured finding — and the Logs popup already knows how to
 * render hook entries. The `error` field carries the human
 * message (e.g. "iconSlot \"sidebar\" · [a, b]") so the same
 * text shows up in the popup, the jsonl export, and the
 * clipboard copy without any further translation.
 *
 * Each call appends one metric — the caller should batch the
 * detector's output into N calls (or fold the list into one
 * multi-line message; the popup renders the message as-is so
 * folding keeps the log denser). We pick per-conflict entries
 * for now: the popup can re-group identical conflicts, and
 * jsonl consumers can correlate by timestamp.
 *
 * `success: true` is the default — the detector ran successfully,
 * it just found a collision — and is what `formatLogLine` uses to
 * downgrade a hook line from `'err'` to `'info'`. We then
 * special-case the conflict hook name (see `formatLogLine`) so
 * the line gets a `'warn'` severity regardless.
 */
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
  // Bump the version so any `usePluginTelemetryVersion` consumer
  // (e.g. the Logs popup) picks up the new conflict entry on the
  // next render. Conflicts flow through the hook buffer, so the
  // metric is otherwise invisible to the version counter.
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
    // Task 13 / G13: conflict entries are recorded as synthetic
    // host-attributed hook metrics with `hook === PLUGIN_CONFLICT_HOOK`.
    // Surface them as a `warn` line in the dedicated "⚠️ Conflict"
    // group; the message body carries the human-readable summary
    // produced by the conflict detector (e.g. "iconSlot \"sidebar\"
    // · [a, b]"). Recognising the line by hook name keeps the
    // shape identical to any other hook metric, so the rest of
    // the popup's rendering path doesn't have to special-case
    // anything beyond a single branch here.
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
  /**
   * Cap on the number of records included in the output. Omit
   * (or pass a non-positive value) for "no cap" — every record
   * in the four ring buffers is included. When set, the limit
   * is applied *after* the plugin-id filter so a caller asking
   * for "the most recent 100 events for plugin X" gets 100 of
   * X's events, not 100 mixed events with X filtered out.
   */
  limit?: number
  /**
   * Sort order. `'asc'` (the default) reads top-to-bottom in
   * chronological order — appropriate for a long-term log file
   * that a human will `cat` or `tail -f` later. `'desc'` emits
   * newest-first, which mirrors the visual order of the Logs
   * popup and lets Copy and Export advertise a count the user
   * can verify against what they see on screen.
   */
  order?: 'asc' | 'desc'
}

/**
 * Build a `jsonl` payload from the in-memory metric buffers.
 *
 * jsonl (JSON Lines) is a stable, line-oriented format: each
 * line is a self-contained JSON object, so the file is grep-
 * friendly and tail-able with line-by-line tools (`jq -c .`,
 * `grep '"pluginId":"com.x"' logs.jsonl`, etc.). We pick jsonl
 * over a single big JSON array because the latter requires the
 * whole document in memory before any consumer can stream it,
 * and because each line gets its own timestamp from the metric
 * record – the consumer can sort / filter without re-parsing.
 *
 * The function is pure: it does not touch the filesystem. The
 * caller (the Logs popup) is responsible for handing `text` to
 * the Tauri save dialog + write path. Keeping I/O outside the
 * telemetry module means the function is trivially unit-testable
 * without mocking tauri, and means the same payload can be
 * reused for clipboard-copy, future "send to support" actions,
 * etc.
 *
 * @param pluginId  Optional id. When supplied, the export is
 *                  restricted to records whose `pluginId` matches
 *                  the argument; the popup uses this for its
 *                  per-plugin filter chip. When `undefined`, every
 *                  record in the four ring buffers is included.
 * @param format    Currently only `'jsonl'` is supported; the
 *                  parameter is kept for forward-compat so a
 *                  future PR can add `'csv'` / `'ndjson'` (an
 *                  alias of jsonl) without touching the call
 *                  site.
 * @param options   Optional knobs. `options.limit` caps the
 *                  number of records returned (applied after the
 *                  `pluginId` filter); `options.order` switches
 *                  between chronological (`'asc'`, default) and
 *                  newest-first (`'desc'`) emission. Both are
 *                  omitted by default to preserve the historical
 *                  "full buffer, oldest first" behaviour.
 */
export function exportLogs(
  pluginId?: string,
  format: LogExportFormat = 'jsonl',
  options: ExportLogsOptions = {},
): LogExportResult {
  const { limit, order = 'asc' } = options
  // Walk the same four ring buffers `getRecentLogLines` does, so
  // a Copy and an Export from the same view yield the same record
  // set (modulo ordering). Each array is in insertion order; we
  // sort the merged list by `timestamp` according to the caller's
  // `order` request.
  const all: AnyMetric[] = []
  for (const m of eventMetrics) all.push(m)
  for (const m of storageMetrics) all.push(m)
  for (const m of hookMetrics) all.push(m)
  for (const m of backendMetrics) all.push(m)
  // Stable sort by `timestamp` (ms since epoch). `'asc'` reads
  // top-to-bottom in time order — the canonical "log file" feel.
  // `'desc'` reverses so the head of the file is the most recent
  // event, matching the visual order of the Logs popup.
  all.sort((a, b) =>
    order === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
  )
  const filtered = pluginId
    ? all.filter((m) => m.pluginId === pluginId)
    : all
  // Apply the limit *after* the filter so a scoped call
  // ("most recent 100 for plugin X") gets 100 of X's records
  // even when the global buffer is dominated by other plugins.
  // A non-positive / NaN `limit` is treated as "no cap" to match
  // the contract documented on `ExportLogsOptions.limit`.
  const limited =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? filtered.slice(0, limit)
      : filtered

  // Render the records. We compute the `FormattedLogLine` (which
  // already owns a `time` field) and emit one object per line
  // with a `kind` discriminator so the consumer can route by
  // type without re-parsing the message string. We include the
  // source metric fields under the same key names so the file
  // remains a faithful dump of the host's telemetry buffers,
  // not just a presentation-layer log. We iterate `limited`
  // (the post-filter, post-cap slice) so the rendered `text`
  // is exactly as wide as `recordCount` advertises.
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
  // Trailing newline is the canonical "ends with EOL" line
  // discipline (POSIX text file convention). Tools that read
  // line-by-line ignore the empty last record, but the file
  // is friendlier to `cat | less` and `wc -l` if it ends
  // with a newline.
  const text = lines.length > 0 ? lines.join('\n') + '\n' : ''
  // `format` is reserved for future variants; the call site
  // already passes the literal and a future PR can branch on
  // it without breaking the public signature.
  void format
  return { text, recordCount: limited.length, format: 'jsonl' }
}

// ─── Time-window aggregation (Task 12 / G12) ────────────────────────────────

/**
 * One bucket of aggregated metrics covering a fixed time window.
 *
 * The aggregator splits a time range `[now - bucketCount * windowMs, now]`
 * into `bucketCount` equally-sized buckets and rolls every record whose
 * `timestamp` falls in `[startTs, endTs)` into that bucket. Counts and
 * averages are kept as separate fields so the caller (e.g. the sparkline
 * component) can pick the slice it needs without re-walking the buffer.
 *
 * `errorRate` is pre-computed as `errorCount / totalCount` for the
 * sparkline's color-picking logic – we don't want the rendering layer
 * to know about the count/rate contract, only about "what's the colour
 * of this point".
 */
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

/**
 * Aggregate the in-memory metric buffers into a fixed number of
 * equally-sized time windows ending at `now`.
 *
 * Bucket layout (default 30 × 60_000ms = 30 minutes of history):
 *
 *   now-30m ────────── now-29m ───── ... ──────── now-1m ───── now
 *   | bucket 0 | bucket 1 | ... | bucket 29 |
 *
 * Each record is placed into exactly one bucket. Records older
 * than the first bucket's `startTs` or newer than `now` are dropped –
 * the visualisation is a "recent history" view, not an audit log.
 *
 * Why a dedicated function (and not a hook on the card): the
 * sparkline renders inside a list of 50+ cards, so re-deriving
 * aggregates on every render would walk four 1000-element ring
 * buffers per card per render (200k array reads per frame). By
 * computing the aggregate once per card-mount we keep the cost
 * flat. Callers that need a reactive view can re-invoke on a
 * timer or on a metric-write event; the function is pure over
 * its inputs.
 *
 * Performance: O(M) where M is the total number of buffered
 * metrics across all four ring buffers. Bucket placement is a
 * `Math.floor` index, no allocation per record. Averages are
 * summed in parallel arrays and divided once per bucket at the
 * end, so the inner loop has no branches beyond the filter.
 */
export function aggregateTelemetryByTimeWindow(
  options: TimeWindowAggregateOptions = {}
): TelemetryBucket[] {
  const {
    pluginId,
    windowMs = 60_000,
    bucketCount = 30,
    now = Date.now(),
  } = options

  // Defensive validation – the sparkline component calls us with
  // a `bucketCount` derived from the card width, and we'd rather
  // render an empty chart than crash because the parent passed a
  // NaN. Returning an empty array matches the "no data → don't
  // render" contract documented on the card.
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

  // Closure over the bucket range so the inner loop doesn't have
  // to recompute `firstStart` per record. The index calculation
  // is `floor((ts - firstStart) / windowMs)`, which clamps to a
  // value in `[0, bucketCount)` after the early-return guards.
  //
  // Edge case: a record at `ts === now` is mathematically
  // *outside* the end-exclusive window `[firstStart, now)`, but
  // in practice a metric recorded at the very moment the
  // aggregator runs (e.g. inside a test where everything happens
  // in the same millisecond) would otherwise be silently dropped.
  // We special-case `ts === now` to land in the last bucket so
  // the "every record up to now is counted" contract holds. The
  // alternative — `floor((now - firstStart) / windowMs)` — would
  // return `bucketCount` (out of range) for a 30×60s layout, so
  // the special-case is the cleanest fix.
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
  // Backend IPC metrics – secondary "duration" signal. The
  // sparkline blends hook + backend averages weighted by their
  // counts, but we expose them as separate fields so the caller
  // can choose to render only one (e.g. the marketplace card has
  // no `hasBackend` distinction, so it'd just use the hook
  // average).
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
