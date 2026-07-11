/** 插件健康监控 */

import { usePluginStore } from '@/stores'

// 崩溃阈值，超过自动禁用
const CRASH_THRESHOLD = 3

// 崩溃计数时间窗 ms
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
 * Manually disable a plugin via store action + Rust-side persistence.
 * Both paths are needed so the disabled state survives a restart:
 *   1. Frontend store: marks the plugin disabled in Zustand so the
 *      UI updates immediately and `onDisable` lifecycle hook fires.
 *   2. Backend: writes the `.disabled` marker on disk via Tauri IPC
 *      so the change persists across app restarts.
 */
function disablePlugin(pluginId: string): void {
  try {
    const pluginStore = usePluginStore.getState()
    pluginStore.setPluginEnabled(pluginId, false)
  } catch (err) {
    console.error(`[plugin-health] Failed to disable plugin "${pluginId}" in store:`, err)
  }
  // Persist the disabled state to disk so it survives a restart.
  // Dynamic import avoids a circular dep at module-evaluation time
  // (plugin-health → tauri → plugin-host → plugin-health).
  void import('@/lib/tauri').then(({ togglePluginEnabled }) => {
    void togglePluginEnabled(pluginId, false)
  }).catch((err) => {
    console.error(`[plugin-health] Failed to persist disable for plugin "${pluginId}":`, err)
  })
}

/**
 * 初始化插件健康监控。
 *
 * 注：原监听的 'plugin:disable' 事件全项目无任何 dispatchEvent 触发源，
 * 属死监听器故移除以避免无效代码。如后续实现插件禁用功能，可在此重新
 * 订阅并在禁用时调用 resetPluginCrashCount 清理崩溃记录。
 */
export function initHealthMonitor(): void {
  // 目前无订阅项，保留为后续插件禁用/健康监控的初始化入口
}
