/**
 * Storage size tracking — host seed + watcher reconciliation
 * (Wave H / Plan A + B)
 *
 * Covers the gap that the JS-side `recordStorageMetric`
 * delta tracker only knows about writes that pass through
 * the JS layer. This file exercises the two new
 * reconciliation paths:
 *
 *  1. **`seedPluginStorageSizes`** — bulk overwrite from
 *     the host's `get_all_plugin_storage_sizes` startup
 *     seed. Asserts that a fresh app launch with a
 *     pre-existing 2 MB storage file shows the right byte
 *     count *before* any JS-side write happens.
 *  2. **`subscribeToPluginStorageChanges`** — runtime
 *     reconciliation from the host's
 *     `plugin-storage-changed` events. Asserts that an
 *     external write (e.g. import) bumps the size to
 *     whatever the host reports, even if the JS delta
 *     tracker thinks the file is still 0 bytes.
 *
 * Why not test `refreshPluginStorageSize`? It's the
 * single-plugin wrapper around the same primitives and
 * shares the same code path as the event handler — the
 * coverage is implicit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Tauri event listener module. We use a virtual
// listener store so we can fire events from tests without
// going through the real `@tauri-apps/api/event` module.
const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set())
    eventListeners.get(event)!.add((payload) => handler({ payload }))
    return () => {
      eventListeners.get(event)?.delete(handler as never)
    }
  }),
}))

// Mock the `tauri.ts` wrappers so the seeder can be
// driven from tests without an actual Tauri host.
vi.mock('@/lib/tauri', () => ({
  getPluginStorageSize: vi.fn(async () => 0),
  getAllPluginStorageSizes: vi.fn(async () => ({})),
  getStorageCap: vi.fn(async () => null),
}))

import {
  seedPluginStorageSizes,
  subscribeToPluginStorageChanges,
  clearAllMetrics,
  getPluginMetrics,
  getMetricsVersion,
  subscribeToMetricsVersion,
  __resetPluginStorageChangesForTests,
  getTotalPluginStorageBytes,
  getPluginStorageBytes,
  getAllPluginStorageBytesSnapshot,
} from '@/lib/plugin-telemetry'
import { getAllPluginStorageSizes, getPluginStorageSize } from '@/lib/tauri'

beforeEach(() => {
  // Tear down the module-level subscription cache so the
  // next `subscribeToPluginStorageChanges` call registers a
  // fresh handler in the freshly-emptied `eventListeners`
  // map. This is the only "global" state that survives
  // between tests; everything else is reset by
  // `clearAllMetrics` and the `vi.mock` defaults.
  __resetPluginStorageChangesForTests()
  clearAllMetrics()
  eventListeners.clear()
  vi.mocked(getAllPluginStorageSizes).mockReset()
  vi.mocked(getPluginStorageSize).mockReset()
  vi.mocked(getAllPluginStorageSizes).mockResolvedValue({})
  vi.mocked(getPluginStorageSize).mockResolvedValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('seedPluginStorageSizes', () => {
  it('overwrites the per-plugin byte count from the host', async () => {
    // Imagine a fresh app launch: a 2 MB storage file
    // already exists from a previous session, but the
    // JS-side delta tracker is at 0 because nothing has
    // been written yet this session.
    vi.mocked(getAllPluginStorageSizes).mockResolvedValueOnce({
      'com.swallownote.export': 2_097_152, // exactly 2 MiB
    })

    let version = -1
    const off = subscribeToMetricsVersion(() => {
      version = getMetricsVersion()
    })

    seedPluginStorageSizes(await getAllPluginStorageSizes())
    off()

    const metrics = getPluginMetrics('com.swallownote.export')
    expect(metrics.storageSizeBytes).toBe(2_097_152)
    expect(version).toBeGreaterThan(0)
  })

  it('skips the version bump when nothing changed', () => {
    // Pre-seed once.
    seedPluginStorageSizes({ 'a': 100 })
    // Reset the subscription probe.
    let calls = 0
    const off = subscribeToMetricsVersion(() => {
      calls += 1
    })
    // Same map, same values → no re-render.
    seedPluginStorageSizes({ 'a': 100 })
    off()
    expect(calls).toBe(0)
  })

  it('handles empty maps and missing plugin ids gracefully', () => {
    // Should not throw, and the existing entries (none in
    // this fresh test) should be preserved.
    expect(() => seedPluginStorageSizes({})).not.toThrow()
    expect(() => seedPluginStorageSizes({ 'x': 50 })).not.toThrow()
    expect(getPluginMetrics('x').storageSizeBytes).toBe(50)
  })

  it('clamps negative bytes to 0 (defensive against bad host data)', () => {
    seedPluginStorageSizes({ 'bad': -1 })
    expect(getPluginMetrics('bad').storageSizeBytes).toBe(0)
  })
})

describe('getTotalPluginStorageBytes / getPluginStorageBytes / snapshot', () => {
  it('returns 0 when no plugins are tracked', () => {
    expect(getTotalPluginStorageBytes()).toBe(0)
    expect(getPluginStorageBytes('does-not-exist')).toBe(0)
    expect(getAllPluginStorageBytesSnapshot()).toEqual({})
  })

  it('returns the per-plugin bytes from a seed', () => {
    seedPluginStorageSizes({
      'a': 100,
      'b': 250,
      'c': 1024,
    })
    expect(getTotalPluginStorageBytes()).toBe(1374)
    expect(getPluginStorageBytes('a')).toBe(100)
    expect(getPluginStorageBytes('b')).toBe(250)
    expect(getPluginStorageBytes('c')).toBe(1024)
  })

  it('snapshot is a defensive copy — mutating it does not affect internal state', () => {
    seedPluginStorageSizes({ 'a': 100 })
    const snap = getAllPluginStorageBytesSnapshot()
    snap.a = 999
    snap['new'] = 123
    expect(getPluginStorageBytes('a')).toBe(100)
    expect(getPluginStorageBytes('new')).toBe(0)
  })

  it('reflects updates from the storage-changed event subscription path', async () => {
    // Simulate the host firing a series of storage-changed
    // events (e.g. external file modifications caught by
    // the file watcher). The total should accumulate as
    // each event lands.
    seedPluginStorageSizes({ 'a': 100, 'b': 200 })
    expect(getTotalPluginStorageBytes()).toBe(300)

    const off = await subscribeToPluginStorageChanges()
    const handlers = eventListeners.get('plugin-storage-changed')!
    handlers.forEach((h) => h({ pluginId: 'a', size: 500 }))
    handlers.forEach((h) => h({ pluginId: 'b', size: 0 }))
    off()

    expect(getTotalPluginStorageBytes()).toBe(500)
  })
})

describe('subscribeToPluginStorageChanges', () => {
  it('reconciles a single plugin on a storage-changed event', async () => {
    const off = await subscribeToPluginStorageChanges()
    expect(eventListeners.has('plugin-storage-changed')).toBe(true)

    // Fire an event as if the host just wrote 5 KB to a
    // plugin's storage.
    const handlers = eventListeners.get('plugin-storage-changed')!
    handlers.forEach((h) => h({ pluginId: 'com.swallownote.x', size: 5120 }))

    expect(getPluginMetrics('com.swallownote.x').storageSizeBytes).toBe(5120)
    off()
  })

  it('does not bump the version when size is unchanged', async () => {
    seedPluginStorageSizes({ 'com.swallownote.x': 1024 })
    const off = await subscribeToPluginStorageChanges()

    let calls = 0
    const offV = subscribeToMetricsVersion(() => {
      calls += 1
    })

    const handlers = eventListeners.get('plugin-storage-changed')!
    handlers.forEach((h) => h({ pluginId: 'com.swallownote.x', size: 1024 }))
    offV()
    off()

    expect(calls).toBe(0)
  })

  it('is idempotent — multiple subscribe calls return the same unlisten', async () => {
    const off1 = await subscribeToPluginStorageChanges()
    const off2 = await subscribeToPluginStorageChanges()
    expect(off2).toBe(off1)
    off1()
  })

  it('ignores malformed payloads', async () => {
    const off = await subscribeToPluginStorageChanges()
    const handlers = eventListeners.get('plugin-storage-changed')!
    // Missing fields should not throw.
    expect(() => handlers.forEach((h) => h({} as never))).not.toThrow()
    expect(() => handlers.forEach((h) => h({ pluginId: '', size: 100 } as never))).not.toThrow()
    off()
  })
})
