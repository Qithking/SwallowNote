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
  
  // Update storage size tracking
  if (success && operation === 'set') {
    const current = pluginStorageSize.get(pluginId) ?? 0
    pluginStorageSize.set(pluginId, current + dataSize)
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

/** Get aggregated metrics for a plugin */
export function getPluginMetrics(pluginId: string): PluginMetrics {
  const pluginEvents = eventMetrics.filter((m) => m.pluginId === pluginId)
  const pluginStorage = storageMetrics.filter((m) => m.pluginId === pluginId)
  const pluginHooks = hookMetrics.filter((m) => m.pluginId === pluginId)
  const pluginBackend = backendMetrics.filter((m) => m.pluginId === pluginId)
  
  const totalErrors = 
    pluginEvents.reduce((sum, m) => sum + m.errors, 0) +
    pluginStorage.filter((m) => !m.success).length +
    pluginHooks.filter((m) => !m.success).length +
    pluginBackend.filter((m) => !m.success).length
  
  const eventDurations = pluginEvents.map((m) => m.totalDurationMs)
  const storageDurations = pluginStorage.map((m) => m.durationMs)
  
  const lastActivity = Math.max(
    0,
    ...pluginEvents.map((m) => m.timestamp),
    ...pluginStorage.map((m) => m.timestamp),
    ...pluginHooks.map((m) => m.timestamp),
    ...pluginBackend.map((m) => m.timestamp)
  )
  
  return {
    pluginId,
    totalEvents: pluginEvents.length,
    totalStorageOps: pluginStorage.length,
    totalHookInvocations: pluginHooks.length,
    totalBackendCalls: pluginBackend.length,
    totalErrors,
    averageEventDurationMs: average(eventDurations),
    averageStorageDurationMs: average(storageDurations),
    storageSizeBytes: pluginStorageSize.get(pluginId) ?? 0,
    lastActivity,
  }
}

/** Get metrics for all plugins */
export function getAllPluginMetrics(): PluginMetrics[] {
  const pluginIds = new Set<string>()
  eventMetrics.forEach((m) => pluginIds.add(m.pluginId))
  storageMetrics.forEach((m) => pluginIds.add(m.pluginId))
  hookMetrics.forEach((m) => pluginIds.add(m.pluginId))
  backendMetrics.forEach((m) => pluginIds.add(m.pluginId))
  
  return Array.from(pluginIds).map((id) => getPluginMetrics(id))
}

/** Clear all metrics */
export function clearAllMetrics(): void {
  eventMetrics.length = 0
  storageMetrics.length = 0
  hookMetrics.length = 0
  backendMetrics.length = 0
  pluginStorageSize.clear()
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

/** Calculate average of a number array */
function average(values: number[]): number {
  if (values.length === 0) return 0
  const sum = values.reduce((a, b) => a + b, 0)
  return sum / values.length
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
