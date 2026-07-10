/**
 * React hook that subscribes to the plugin-telemetry version
 * counter (`getMetricsVersion()` in `@/lib/plugin-telemetry`).
 *
 * The version counter increments on every `recordEventMetric` /
 * `recordStorageMetric` / `recordHookMetric` / `recordBackendMetric`
 * / `recordPluginConflict` / `clearAllMetrics` call. Components
 * that derive display state from the metric buffers (the
 * `PluginManagerView` stats ribbon, the storage meter, the error
 * counter, etc.) can use this hook to re-render whenever new
 * telemetry lands, *without* polling on a timer.
 *
 * The host maintains a single shared `Set<() => void>` of
 * subscribers (kept inside the telemetry module so recorders can
 * notify it without needing to import React). The hook uses
 * `useSyncExternalStore` so the subscription is set up exactly
 * once and the re-render is properly batched with whatever state
 * change drove the metric recording.
 *
 * **M15 (Wave D review):** the previous `useEffect([plugins.length],
 * ...)` in `PluginManagerView` only re-ran the metrics
 * recomputation when the plugin *count* changed, so a busy
 * host that emitted hundreds of metrics while the user was
 * looking at the stats ribbon would see frozen error counts.
 * This hook makes the "whenever new metrics arrive" case free.
 */
import { useSyncExternalStore } from 'react'
import {
  getMetricsVersion,
  subscribeToMetricsVersion,
} from '@/lib/plugin-telemetry'

/**
 * Subscribe to the plugin-telemetry version counter.
 *
 * @returns Current version (a strictly increasing integer). The
 *          reference returned by this hook changes on every
 *          recorder call, so it's safe to spread into a
 *          `useEffect` dep array (or read directly in render).
 */
export function usePluginTelemetryVersion(): number {
  return useSyncExternalStore(
    // 委托 telemetry 模块管理订阅列表
    subscribeToMetricsVersion,
    // 快照：计数器单调递增，每次记录触发重渲染
    () => getMetricsVersion(),
  )
}
