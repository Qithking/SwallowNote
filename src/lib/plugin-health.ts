/**
 * Plugin Health Monitor
 * 
 * Tracks plugin crash counts and triggers auto-disable after threshold.
 * Resets counter on successful recovery.
 */

import { usePluginStore } from '@/stores'

// Crash threshold: auto-disable after this many crashes
const CRASH_THRESHOLD = 3

// Time window (ms) for counting crashes. After this period, counter resets.
const CRASH_WINDOW_MS = 60000 // 1 minute

interface CrashRecord {
  count: number
  firstCrashAt: number
  lastCrashAt: number
}

const crashRecords = new Map<string, CrashRecord>()

/**
 * Record a crash for a plugin. Auto-disables if threshold reached.
 */
export function recordPluginCrash(pluginId: string, _error: Error): void {
  const now = Date.now()
  let record = crashRecords.get(pluginId)

  if (!record) {
    record = {
      count: 0,
      firstCrashAt: now,
      lastCrashAt: now,
    }
  }

  // Reset if outside the window
  if (now - record.firstCrashAt > CRASH_WINDOW_MS) {
    record.count = 0
    record.firstCrashAt = now
  }

  record.count++
  record.lastCrashAt = now
  crashRecords.set(pluginId, record)

  console.warn(`[plugin-health] Plugin "${pluginId}" crashed (${record.count}/${CRASH_THRESHOLD})`)

  // Auto-disable if threshold reached
  if (record.count >= CRASH_THRESHOLD) {
    console.error(`[plugin-health] Plugin "${pluginId}" exceeded crash threshold (${CRASH_THRESHOLD}), auto-disabling`)
    disablePlugin(pluginId)
  }
}

/**
 * Reset crash counter for a plugin (called on successful recovery).
 */
export function resetPluginCrashCount(pluginId: string): void {
  crashRecords.delete(pluginId)
}

/**
 * Get current crash count for a plugin.
 */
export function getPluginCrashCount(pluginId: string): number {
  return crashRecords.get(pluginId)?.count ?? 0
}

/**
 * Manually disable a plugin via store action.
 */
function disablePlugin(pluginId: string): void {
  try {
    const pluginStore = usePluginStore.getState()
    pluginStore.setPluginEnabled(pluginId, false)
  } catch (err) {
    console.error(`[plugin-health] Failed to disable plugin "${pluginId}":`, err)
  }
}

/**
 * Subscribe to plugin disable events to clean up crash records.
 */
export function initHealthMonitor(): void {
  // Listen for plugin disable events to clean up crash records
  window.addEventListener('plugin:disable', (event) => {
    const detail = (event as CustomEvent<{ pluginId: string }>).detail
    if (detail?.pluginId) {
      resetPluginCrashCount(detail.pluginId)
    }
  })
}
