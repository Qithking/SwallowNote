/**
 * TC-3: Plugin lifecycle hook timeout + auto-disable
 *
 * Covers Task 3 (G3) requirements:
 *  1. `runPluginLifecycleHook` accepts a `timeoutMs` option that
 *     defaults to 5000ms.
 *  2. A slow hook (one that doesn't resolve within the timeout)
 *     causes the host to stop waiting and instead mark the plugin
 *     unhealthy + auto-disable it.
 *  3. The timeout writes a `lastError` entry to telemetry via
 *     `recordPluginError` so the diagnostics popup can surface
 *     it.
 *  4. A hook that completes within budget marks the plugin
 *     healthy (no lastError).
 *  5. A second hook timeout for the same plugin updates the
 *     `lastError` rather than appending a new one (the cache is
 *     a single-slot "last error").
 *  6. The store-level `setPluginHealth` action is a no-op for an
 *     unknown plugin id (e.g. uninstalled concurrently).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearHost as sdkClearHost } from '@swallow-note/plugin-sdk'
import { usePluginStore } from '@/stores'
import {
  runPluginLifecycleHook,
  DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS,
} from '@/lib/plugin-host-takeover'
import {
  clearPluginLastError,
  getPluginLastError,
  markPluginHealthy,
  recordPluginError,
} from '@/lib/plugin-telemetry'
import type { PluginContext, PluginDefinition } from '@/types/plugin'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'com.test.timeout',
    name: 'Timeout',
    description: '',
    version: '0.0.0',
    author: '',
    publishedAt: '2026-01-01',
    iconPosition: 'sidebar',
    contentPosition: 'leftPanel',
    order: 100,
    enabled: true,
    icon: () => null,
    panel: () => null,
    pluginPath: '/tmp/timeout',
    hasBackend: false,
    permissions: [],
    ...overrides,
  } as PluginDefinition
}

const ctx: PluginContext = {
  pluginId: 'com.test.timeout',
  pluginPath: '/tmp/timeout',
  invokeBackend: async () => null,
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The takeover's `handleHookTimeout` calls `console.error`
 * directly so a wedge is visible in dev consoles. Tests that
 * intentionally trigger a timeout need to silence that output
 * (otherwise vitest's reporter prints an unexpected console
 * error). The pattern mirrors TC-09.6-02c in the original
 * plugin-host-takeover tests.
 */
function silenceConsoleError(): () => void {
  const original = console.error
  console.error = () => {}
  return () => {
    console.error = original
  }
}

// ─── Default timeout constant ────────────────────────────────────────────────

describe('TC-3-01: default timeout constant', () => {
  it('TC-3-01a: DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS is 5000ms', () => {
    expect(DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS).toBe(5000)
  })
})

// ─── Slow hook trips the breaker ─────────────────────────────────────────────

describe('TC-3-02: runPluginLifecycleHook timeout → unhealthy + auto-disable', () => {
  beforeEach(() => {
    sdkClearHost()
    // Wipe the cached last-error entries between tests so a
    // previous case doesn't pollute the next one.
    clearPluginLastError('com.test.timeout')
    clearPluginLastError('com.test.timeout-a')
    clearPluginLastError('com.test.timeout-b')
    // Reset the store so each test starts with an empty
    // registry. The store keeps a per-plugin pluginHealth map
    // we want to assert against.
    usePluginStore.setState({
      plugins: [],
      registry: { sidebar: [], editorToolbar: [], titleBar: [] },
      pluginHealth: {},
      activeLeftPanelPluginId: null,
      activeRightPanelPluginId: null,
      activeFullPanelPluginId: null,
      activeEditorAreaPluginId: null,
      loaded: false,
    })
  })

  afterEach(() => {
    sdkClearHost()
  })

  it('TC-3-02a: fast hook (within budget) resolves normally and marks healthy', async () => {
    const plugin = makePlugin({ id: 'com.test.timeout-a' })
    // Register the plugin in the store so `setPluginHealth`
    // accepts the write (it bails on unknown ids).
    usePluginStore.getState().registerPlugin(plugin)
    // A 20ms hook with a 1000ms timeout is well within budget.
    const hook = vi.fn(async () => {
      await wait(20)
    })
    const start = performance.now()
    await runPluginLifecycleHook(plugin, hook, ctx, 'onLoad', { timeoutMs: 1000 })
    const elapsed = performance.now() - start
    expect(hook).toHaveBeenCalledTimes(1)
    // Resolved quickly; we don't assert a hard upper bound
    // (the host has other microtasks in flight) but we should
    // be well under the timeout.
    expect(elapsed).toBeLessThan(500)
    // The plugin's health is healthy – the timeout path was
    // not entered, so `setPluginHealth(pluginId, 'unhealthy')`
    // was never called and the getter still returns 'healthy'
    // (the explicit `markPluginHealthy` ran, and the entry
    // resolves to 'healthy' on read).
    expect(usePluginStore.getState().getPluginHealth(plugin.id)).toBe('healthy')
    // No last-error entry was written.
    expect(getPluginLastError(plugin.id)).toBeUndefined()
  })

  it('TC-3-02b: slow hook (exceeds timeout) → unhealthy + disabled + lastError', async () => {
    const plugin = makePlugin({ id: 'com.test.timeout-b', enabled: true })
    usePluginStore.getState().registerPlugin(plugin)
    // Sanity: starts healthy. (registerPlugin doesn't write
    // to pluginHealth; getPluginHealth defaults to 'unknown'
    // for missing entries, so we set it explicitly to model
    // "previously healthy, now wedged".)
    usePluginStore.getState().setPluginHealth(plugin.id, 'healthy')
    expect(usePluginStore.getState().getPluginHealth(plugin.id)).toBe('healthy')
    // Hook that sleeps for 5s, well past the 50ms timeout.
    const hook = vi.fn(async () => {
      await wait(5000)
    })
    const restore = silenceConsoleError()
    try {
      const start = performance.now()
      await runPluginLifecycleHook(plugin, hook, ctx, 'onLoad', { timeoutMs: 50 })
      const elapsed = performance.now() - start
      // The host must NOT have waited the full 5s; it bails
      // at ~50ms. Allow generous slack (200ms) for the
      // dynamic-import round-trips on cold module graphs.
      expect(elapsed).toBeLessThan(500)
    } finally {
      restore()
    }
    // The plugin was flipped to unhealthy.
    expect(usePluginStore.getState().getPluginHealth(plugin.id)).toBe('unhealthy')
    // The plugin was auto-disabled.
    const reloaded = usePluginStore.getState().getPluginById(plugin.id)
    expect(reloaded?.enabled).toBe(false)
    // The hook was invoked once (the host raced the hook
    // against the timer; the underlying promise is still
    // running but the race resolved to the timer).
    expect(hook).toHaveBeenCalledTimes(1)
    // A lastError was recorded with the timeout message.
    const err = getPluginLastError(plugin.id)
    expect(err).toBeDefined()
    expect(err?.hook).toBe('onLoad')
    expect(err?.autoDisabled).toBe(true)
    expect(err?.message).toMatch(/onLoad/)
    expect(err?.message).toMatch(/50ms/)
  })

  it('TC-3-02c: timeout for a plugin that was uninstalled concurrently is a no-op', async () => {
    // Don't register the plugin – simulates a race where the
    // user uninstalls before the timer fires. The takeover's
    // `getPluginById` guard should prevent the store from
    // accepting a stale health write.
    const plugin = makePlugin({ id: 'com.test.timeout-c' })
    const hook = vi.fn(async () => {
      await wait(5000)
    })
    const restore = silenceConsoleError()
    try {
      await runPluginLifecycleHook(plugin, hook, ctx, 'onLoad', { timeoutMs: 30 })
    } finally {
      restore()
    }
    // The store's pluginHealth map is empty (no plugin registered).
    expect(usePluginStore.getState().pluginHealth).toEqual({})
    // Telemetry DOES record the error (it's fire-and-forget
    // and doesn't depend on the plugin being registered) so
    // the diagnostics popup can still surface it. The
    // `autoDisabled` flag is set to true because the takeover
    // DID attempt to auto-disable; the fact that the plugin
    // was no longer in the registry doesn't change that we
    // intended to disable it.
    const err = getPluginLastError(plugin.id)
    expect(err).toBeDefined()
    expect(err?.autoDisabled).toBe(true)
  })
})

// ─── Telemetry helpers ───────────────────────────────────────────────────────

describe('TC-3-03: telemetry recordPluginError / markPluginHealthy', () => {
  beforeEach(() => {
    clearPluginLastError('com.test.t-a')
    clearPluginLastError('com.test.t-b')
  })

  it('TC-3-03a: recordPluginError stores a single last-error per plugin', () => {
    recordPluginError('com.test.t-a', 'onLoad', 'first', true)
    const first = getPluginLastError('com.test.t-a')
    expect(first?.message).toBe('first')
    expect(first?.autoDisabled).toBe(true)
    expect(first?.hook).toBe('onLoad')
    // A subsequent error overwrites the first (single-slot
    // cache, not a list). The new entry has a fresh
    // timestamp.
    recordPluginError('com.test.t-a', 'onEnable', 'second', false)
    const second = getPluginLastError('com.test.t-a')
    expect(second?.message).toBe('second')
    expect(second?.autoDisabled).toBe(false)
    expect(second?.hook).toBe('onEnable')
    expect(second?.timestamp).toBeGreaterThanOrEqual(first?.timestamp ?? 0)
  })

  it('TC-3-03b: markPluginHealthy clears the cached last-error', () => {
    recordPluginError('com.test.t-b', 'onLoad', 'wedged', true)
    expect(getPluginLastError('com.test.t-b')?.message).toBe('wedged')
    markPluginHealthy('com.test.t-b')
    expect(getPluginLastError('com.test.t-b')).toBeUndefined()
  })
})
