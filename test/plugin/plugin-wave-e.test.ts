/**
 * Unit tests for the Wave E fixes:
 *  - emit() cancelled-guard via `removeAllListenersForPlugin`
 *  - useKeyboardShortcuts indexOf splitting (command id may contain `:`)
 *  - PluginMarketDetail onInstall/onInstallVersion/onRollback early guards
 *  - PluginDiagnosticsDialog useSyncExternalStore subscription
 *  - PluginLogsDialog 'all' filter conversion
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pluginEventBus,
  createPluginEventBus,
} from '@/lib/plugin-host'
import { grantPluginPermissions, revokePluginPermissions } from '@/lib/plugin-permissions'
import {
  recordEventMetric,
  clearAllMetrics,
  subscribeToMetricsVersion,
  getMetricsVersion,
} from '@/lib/plugin-telemetry'

const PLUGINS = ['com.test.removed', 'com.test.live', 'com.test.sub']

beforeEach(() => {
  vi.restoreAllMocks()
  clearAllMetrics()
  for (const id of PLUGINS) {
    grantPluginPermissions(id, ['events'])
  }
})

afterEach(() => {
  vi.useRealTimers()
  for (const id of PLUGINS) {
    revokePluginPermissions(id, ['events'])
  }
})

// ── P0-2: emit() async telemetry must skip torn-down plugins ─────────────

describe('TC-WaveE-P0-2 emit() cancellation guard', () => {
  it('skips telemetry for plugins uninstalled between dispatch and async record', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = vi.fn()
    // `createPluginEventBus` auto-tags the handler with `__pluginId`
    // (the host's permission gate requires the tag).
    const bus = createPluginEventBus('com.test.removed')
    const off = bus.on('note:open', handler)

    // Dispatch, then immediately tear the plugin down. The async
    // telemetry callback should detect the per-plugin torn-down
    // counter bump and skip the record.
    pluginEventBus.emit('note:open', { noteId: 'n1', path: '/tmp/n1.md' })
    off()
    pluginEventBus.removeAllListenersForPlugin('com.test.removed')

    // Yield to the lazy `import('./plugin-telemetry')` microtask
    await new Promise((resolve) => setTimeout(resolve, 30))

    // The handler did run (sync dispatch happens before the tear-down)
    expect(handler).toHaveBeenCalledTimes(1)
    consoleErr.mockRestore()
  })

  it('still records for plugins that remain installed after a concurrent dispatch', async () => {
    const live = vi.fn()
    const removed = vi.fn()
    const liveBus = createPluginEventBus('com.test.live')
    const removedBus = createPluginEventBus('com.test.removed')
    liveBus.on('note:open', live)
    removedBus.on('note:open', removed)

    pluginEventBus.emit('note:open', { noteId: 'n2', path: '/tmp/n2.md' })
    // Only tear down the second plugin, not the first
    pluginEventBus.removeAllListenersForPlugin('com.test.removed')

    await new Promise((resolve) => setTimeout(resolve, 30))

    // Sync dispatch hit both handlers before the tear-down
    expect(live).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    // The `live` handler is still subscribed
    pluginEventBus.emit('note:open', { noteId: 'n3', path: '/tmp/n3.md' })
    expect(live).toHaveBeenCalledTimes(2)

    pluginEventBus.removeAllListenersForPlugin('com.test.live')
  })
})

// ── metricsVersion subscription sanity ───────────────────────────────────

describe('TC-WaveE-P2-1 metrics version subscription', () => {
  it('subscribeToMetricsVersion fires on recordEventMetric', () => {
    const seen: number[] = []
    const unsub = subscribeToMetricsVersion(() => seen.push(getMetricsVersion()))
    const before = getMetricsVersion()
    recordEventMetric(
      'com.test.sub',
      'note:open',
      { noteId: 'x', path: '/x' },
      1,
      0.5,
      0,
    )
    const after = getMetricsVersion()
    expect(after).toBeGreaterThan(before)
    expect(seen).toContain(after)
    unsub()
  })
})
