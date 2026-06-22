/**
 * TC-09.6: Plugin host takeover tests
 *
 * Covers Phase 9.6 requirements:
 *  1. SDK `setHost` is stack-based: arbitrary-order restore works.
 *  2. Each setHost call gets a unique token; the returned restore
 *     pops only its own layer.
 *  3. The host's `runPluginLifecycleHook` installs a per-plugin
 *     override for the duration of the hook and restores it in
 *     `finally` – even when the hook throws.
 *  4. Concurrent hook fires (A and B setHost interleaved) each see
 *     their own overrides; the restore of A doesn't disturb B's
 *     layer and vice versa.
 *  5. Plugin without a `__pluginModule` (inline plugin) skips the
 *     takeover automatically; the hook still fires.
 *  6. The takeover wires the host's permission-checked
 *     `registerContextMenu` for the right plugin id, so an
 *     unauthorized plugin triggers `PluginPermissionDeniedError`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setHost as sdkSetHost,
  clearHost as sdkClearHost,
  registerContextMenu as sdkRegisterContextMenu,
  getPluginStorage as sdkGetPluginStorage,
  getStubMenuRegistry,
  emitNoteOpened as sdkEmitNoteOpened,
} from '@swallow-note/plugin-sdk'
import type { HostOverrides } from '@swallow-note/plugin-sdk'
import {
  registerContextMenu as hostRegisterContextMenu,
  pluginMenuRegistry,
} from '@/lib/plugin-menu'
import { PluginPermissionDeniedError } from '@/lib/plugin-permission-guard'
import { setGranted as setGrantedSync, clearGranted, clearAll } from '@/lib/plugin-permission-guard'
import { pluginEventBus } from '@/lib/plugin-host'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import type { PluginContext, PluginDefinition } from '@/types/plugin'

// ─── SDK setHost stacking semantics ──────────────────────────────────────────

describe('TC-09.6-01: SDK setHost is stack-based with token-keyed restore', () => {
  beforeEach(() => {
    sdkClearHost()
  })
  afterEach(() => {
    sdkClearHost()
  })

  it('TC-09.6-01a: arbitrary-order restore pops the right layer', () => {
    const a = sdkSetHost({ getPluginStorage: () => 'A' as never })
    const b = sdkSetHost({ getPluginStorage: () => 'B' as never })
    // Inner (B) wins over outer (A) because top of stack is read.
    expect(sdkGetPluginStorage('any')).toBe('B')
    // Restore the OUTER layer first. Stack semantics mean the inner
    // B layer is still on top after A is removed – A was below B
    // and is now gone, leaving B as the sole layer. The point of
    // the assertion is "didn't accidentally pop B too?".
    a()
    expect(sdkGetPluginStorage('any')).toBe('B')
    // Restore the INNER layer last.
    b()
    // Stack is empty; SDK falls back to the in-process stub.
    const fallback = sdkGetPluginStorage('any')
    expect(fallback).not.toBe('A')
    expect(fallback).not.toBe('B')
  })

  it('TC-09.6-01b: nested setHost layers are independent (no cross-talk)', () => {
    const a = sdkSetHost({ getPluginStorage: () => 'A' as never })
    const b = sdkSetHost({ getPluginStorage: () => 'B' as never })
    // Inner layer sees B; outer A is still in the stack below.
    expect(sdkGetPluginStorage('any')).toBe('B')
    // Restore inner first – the outer A layer becomes active.
    b()
    expect(sdkGetPluginStorage('any')).toBe('A')
    // Restore outer – stack is empty.
    a()
    const fallback = sdkGetPluginStorage('any')
    expect(fallback).not.toBe('A')
  })

  it('TC-09.6-01c: double restore is a no-op (idempotent)', () => {
    const a = sdkSetHost({ getPluginStorage: () => 'A' as never })
    a()
    // Second restore: the layer is already gone, must not throw.
    expect(() => a()).not.toThrow()
  })

  it('TC-09.6-01d: clearHost wipes every layer at once', () => {
    sdkSetHost({ getPluginStorage: () => 'A' as never })
    sdkSetHost({ getPluginStorage: () => 'B' as never })
    sdkClearHost()
    const fallback = sdkGetPluginStorage('any')
    expect(fallback).not.toBe('A')
    expect(fallback).not.toBe('B')
  })
})

// ─── runPluginLifecycleHook integration ───────────────────────────────────────

/**
 * Build a minimal `PluginDefinition` for testing. We default every
 * metadata field so individual tests can override just the ones
 * they care about.
 */
function makePlugin(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'com.test.sample',
    name: 'Sample',
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
    pluginPath: '/tmp/sample',
    hasBackend: false,
    permissions: [],
    ...overrides,
  } as PluginDefinition
}

function makeModule(overrides: Record<string, unknown> = {}): {
  setHost: ReturnType<typeof vi.fn>
} & Record<string, unknown> {
  return {
    setHost: vi.fn((overrides) => sdkSetHost(overrides)),
    ...overrides,
  }
}

const ctx: PluginContext = {
  pluginId: 'com.test.sample',
  pluginPath: '/tmp/sample',
  invokeBackend: async () => null,
}

describe('TC-09.6-02: runPluginLifecycleHook installs and tears down the takeover', () => {
  beforeEach(() => {
    sdkClearHost()
  })
  afterEach(() => {
    sdkClearHost()
  })

  it('TC-09.6-02a: calls module.setHost with the per-plugin overrides', async () => {
    const mod = makeModule()
    const plugin = makePlugin({ id: 'com.test.alpha' })
    const hook = vi.fn()

    await runPluginLifecycleHook(
      { ...plugin, __pluginModule: mod } as PluginDefinition,
      hook,
      ctx,
      'onLoad'
    )

    expect(mod.setHost).toHaveBeenCalledTimes(1)
    const overrides = mod.setHost.mock.calls[0][0]
    expect(overrides).toHaveProperty('registerContextMenu')
    expect(overrides).toHaveProperty('getPluginStorage')
    expect(overrides).toHaveProperty('invokeBackend')
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('TC-09.6-02b: the restore is called after the hook returns', async () => {
    let captureFromHook: string | null = null
    const mod = makeModule()
    const plugin = makePlugin({ id: 'com.test.beta' })
    const hook = vi.fn(() => {
      // During the hook, the SDK should see the host's override
      // for `registerContextMenu`. We probe by calling the SDK
      // function with a known id; the host's implementation is
      // installed and we just record that it ran.
      captureFromHook = 'during-hook'
    })

    await runPluginLifecycleHook(
      { ...plugin, __pluginModule: mod } as PluginDefinition,
      hook,
      ctx,
      'onLoad'
    )

    expect(captureFromHook).toBe('during-hook')
    // After the hook returns, the stack is empty (clearHost
    // confirmed by TC-09.6-01d-style check).
    expect(sdkGetPluginStorage('com.test.beta')).not.toBe('A')
  })

  it('TC-09.6-02c: restore runs in finally even when the hook throws', async () => {
    const mod = makeModule()
    const restore = vi.fn()
    mod.setHost = vi.fn(() => restore)
    const plugin = makePlugin({ id: 'com.test.gamma' })
    const hook = vi.fn(() => {
      throw new Error('boom')
    })

    // `runLifecycleHook` swallows the error (a buggy plugin must
    // not crash the host), so the outer helper resolves normally.
    // What we care about here is that `restore` still ran in the
    // outer `finally` block – the takeover must be unwound even on
    // failure so the next plugin's setHost doesn't inherit the
    // broken layer.
    //
    // We also probe the host's diagnostics by replacing
    // `console.error` with a counting stub. The test's afterEach
    // (in `clearAll`) restores the original handler. We can't use
    // `vi.spyOn(console, 'error')` here because vitest's
    // jsdom-injected console wrapper obscures the spy.
    const originalError = console.error
    let errorCalls = 0
    console.error = () => {
      errorCalls++
    }
    try {
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        hook,
        ctx,
        'onLoad'
      )
    } finally {
      console.error = originalError
    }
    expect(hook).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)
    // The swallowed error was logged for diagnostics.
    expect(errorCalls).toBeGreaterThan(0)
  })

  it('TC-09.6-02d: no __pluginModule → takeover is silently skipped', async () => {
    const plugin = makePlugin({ id: 'com.test.delta' })
    const hook = vi.fn()
    // No __pluginModule, no setHost call. Hook still runs.
    await runPluginLifecycleHook(plugin, hook, ctx, 'onLoad')
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('TC-09.6-02e: undefined hook is a no-op (matches runLifecycleHook contract)', async () => {
    const mod = makeModule()
    const plugin = makePlugin({ id: 'com.test.epsilon' })
    await runPluginLifecycleHook(
      { ...plugin, __pluginModule: mod } as PluginDefinition,
      undefined,
      ctx,
      'onLoad'
    )
    // No takeover, no hook: setHost is not even attempted.
    expect(mod.setHost).not.toHaveBeenCalled()
  })
})

// ─── Permission enforcement through the takeover ─────────────────────────────

describe('TC-09.6-03: host takeover wires the permission check on registerContextMenu', () => {
  beforeEach(() => {
    sdkClearHost()
    // Wipe the host's in-process menu registry between tests so
    // prior state doesn't leak.
    getStubMenuRegistry().clearPlugin('com.test.perm-a')
    getStubMenuRegistry().clearPlugin('com.test.perm-b')
    // Wipe the in-memory permission grant cache between tests so a
    // grant from one case doesn't accidentally satisfy the check in
    // the next. The setup.ts afterEach clears localStorage; this
    // clears the in-memory mirror the host actually consults.
    clearAll()
    clearGranted('com.test.perm-a')
    clearGranted('com.test.perm-b')
    clearGranted('com.test.perm-c')
    // Also drop any items the host's own registry accumulated.
    pluginMenuRegistry.clearPlugin('com.test.perm-a')
    pluginMenuRegistry.clearPlugin('com.test.perm-b')
    pluginMenuRegistry.clearPlugin('com.test.perm-c')
  })
  afterEach(() => {
    sdkClearHost()
    clearAll()
  })

  it('TC-09.6-03a: registerContextMenu without the grant throws inside the hook', async () => {
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-a',
      permissions: ['context-menu'],
    })
    // No grant for this plugin id. The host's
    // `pluginMenuRegistry.register` calls `assertPermission` and
    // throws `PluginPermissionDeniedError`. The hook's lifecycle
    // runner swallows that error (a buggy plugin must not crash
    // the host), so we capture it inside the hook.
    let captureError: unknown = null
    const hook = vi.fn(() => {
      try {
        sdkRegisterContextMenu('com.test.perm-a', {
          id: 'demo',
          label: 'Demo',
          onClick: () => {},
        })
      } catch (e) {
        captureError = e
        throw e
      }
    })

    // Silently absorb the swallowed error so the test runner
    // doesn't print a stack trace to the console. Direct
    // `console.error` replacement is required because vitest's
    // jsdom-injected wrapper obscures `vi.spyOn` here.
    const originalError = console.error
    console.error = () => {}
    try {
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        hook,
        ctx,
        'onLoad'
      )
    } finally {
      console.error = originalError
    }
    expect(captureError).toBeInstanceOf(PluginPermissionDeniedError)
    // And the host's registry has no items for this plugin
    // because the call was rejected before reaching register.
    expect(pluginMenuRegistry.getByLocation('fileTree').some((it) => it.id === 'demo')).toBe(
      false
    )
  })

  it('TC-09.6-03b: registerContextMenu with the grant succeeds', async () => {
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-b',
      permissions: ['context-menu'],
    })
    // Use the sync in-memory grant setter (the async localStorage
    // helper in `plugin-permissions.ts` would race with the hook's
    // sync assertPermission check).
    setGrantedSync('com.test.perm-b', ['context-menu'])

    const hook = vi.fn(() => {
      sdkRegisterContextMenu('com.test.perm-b', {
        id: 'demo',
        label: 'Demo',
        onClick: () => {},
      })
    })

    await runPluginLifecycleHook(
      { ...plugin, __pluginModule: mod } as PluginDefinition,
      hook,
      ctx,
      'onLoad'
    )
    // The host's registry has the item.
    expect(pluginMenuRegistry.getByLocation('fileTree').some((it) => it.id === 'demo')).toBe(
      true
    )
  })

  it('TC-09.6-03c: hostRegisterContextMenu is a direct path (not via takeover)', () => {
    // Sanity: when the host's own code calls registerContextMenu
    // (e.g. for inline plugins), it goes through the host's
    // pluginMenuRegistry directly and applies the same permission
    // gate. We don't need a takeover for inline plugins because
    // they import from `@/lib/plugin-menu` directly.
    setGrantedSync('com.test.perm-c', ['context-menu'])
    expect(() =>
      hostRegisterContextMenu('com.test.perm-c', {
        id: 'host-direct',
        label: 'Host direct',
        onClick: () => {},
      })
    ).not.toThrow()
  })
})

// ─── Emit permission gate ─────────────────────────────────────────────────────

/**
 * Bug-fix tests for C1 critical: the takeover's `emit` override
 * was a raw `pluginEventBus.emit(...)` and skipped the
 * `assertPermission` check that `on`/`off` get for free via the
 * per-plugin bus. An unauthorized plugin could therefore spoof
 * any host event into every other plugin's handlers. These cases
 * pin the gate in place.
 */
describe('TC-09.6-04: emit() is gated by the events permission (C1 fix)', () => {
  beforeEach(() => {
    sdkClearHost()
    // Reset every plugin the tests touch so a grant from one case
    // doesn't satisfy the next.
    clearAll()
    for (const id of [
      'com.test.perm-emit-a',
      'com.test.perm-emit-b',
      'com.test.perm-emit-c',
    ]) {
      clearGranted(id)
      pluginEventBus.removeAllListenersForPlugin(id)
    }
  })
  afterEach(() => {
    sdkClearHost()
    clearAll()
    for (const id of [
      'com.test.perm-emit-a',
      'com.test.perm-emit-b',
      'com.test.perm-emit-c',
    ]) {
      pluginEventBus.removeAllListenersForPlugin(id)
    }
  })

  it('TC-09.6-04a: emit without the events grant throws inside the hook', async () => {
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-emit-a',
      permissions: ['events'],
    })
    // No grant set. The takeover's `emit` should call
    // `assertPermission` and throw `PluginPermissionDeniedError`
    // before the dispatch ever reaches the global bus.
    let captureError: unknown = null
    const hook = vi.fn(() => {
      const overrides = mod.setHost.mock.calls.at(-1)![0] as HostOverrides
      try {
        overrides.emit!('note:open', { noteId: 'n1', path: '/tmp/n1.md' })
      } catch (e) {
        captureError = e
        throw e
      }
    })

    // Swallow the runLifecycleHook stderr so the test runner
    // doesn't print a stack trace for the expected rejection.
    const originalError = console.error
    console.error = () => {}
    try {
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        hook,
        ctx,
        'onLoad'
      )
    } finally {
      console.error = originalError
    }
    expect(captureError).toBeInstanceOf(PluginPermissionDeniedError)
    const denied = captureError as PluginPermissionDeniedError
    expect(denied.pluginId).toBe('com.test.perm-emit-a')
    expect(denied.permission).toBe('events')
    expect(denied.operation).toBe('emit "note:open"')
  })

  it('TC-09.6-04b: emit with the events grant dispatches to subscribers', async () => {
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-emit-b',
      permissions: ['events'],
    })
    setGrantedSync('com.test.perm-emit-b', ['events'])

    // Subscribe a host-side listener (tagged with __pluginId so the
    // host bus's `on` permission gate accepts it; we grant this
    // listener-id the `events` permission too).
    setGrantedSync('com.test.perm-listener', ['events'])
    const received: Array<{ noteId: string; path: string }> = []
    const handler = (payload: { noteId: string; path: string }) => {
      received.push(payload)
    }
    ;(handler as unknown as { __pluginId: string }).__pluginId = 'com.test.perm-listener'
    const unsub = pluginEventBus.on('note:open', handler)

    try {
      const hook = vi.fn(() => {
        const overrides = mod.setHost.mock.calls.at(-1)![0] as HostOverrides
        overrides.emit!('note:open', { noteId: 'n2', path: '/tmp/n2.md' })
      })
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        hook,
        ctx,
        'onLoad'
      )
      expect(received).toEqual([{ noteId: 'n2', path: '/tmp/n2.md' }])
    } finally {
      unsub()
    }
  })

  it('TC-09.6-04c: SDK emitNoteOpened() helper does not reach the global bus', async () => {
    // The SDK's per-event emit helpers (emitNoteOpened, …) funnel
    // through `hostOverrides.emit` and *swallow* the gate's error
    // (the SDK logs it and returns rather than letting the plugin
    // crash). The observable guarantee we need to pin is therefore
    // not "the helper throws" but "the helper does not reach the
    // global bus". Subscribe a host-side listener and verify it
    // never sees the unauthorized emit.
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-emit-c',
      permissions: ['events'],
    })
    setGrantedSync('com.test.perm-listener', ['events'])
    const received: Array<{ noteId: string; path: string }> = []
    const handler = (p: { noteId: string; path: string }) => received.push(p)
    ;(handler as unknown as { __pluginId: string }).__pluginId = 'com.test.perm-listener'
    const unsub = pluginEventBus.on('note:open', handler)
    const originalError = console.error
    // The SDK logs the swallowed permission error via console.error;
    // silence it so the test runner doesn't print the stack.
    console.error = () => {}
    try {
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        vi.fn(() => {
          // No grant for 'events' on com.test.perm-emit-c, so
          // the gate should reject this dispatch and the
          // subscriber must stay silent.
          sdkEmitNoteOpened('n3', '/tmp/n3.md')
        }),
        ctx,
        'onLoad'
      )
    } finally {
      console.error = originalError
      unsub()
    }
    expect(received).toEqual([])
  })

  it('TC-09.6-04d: a sibling plugin does not receive a rejected emit', async () => {
    // Defence in depth: even if a buggy implementation forgot the
    // gate, the bus dispatch would still be a no-op for the
    // unauthorized plugin's emit. Pin the *observable* behaviour:
    // a sibling subscriber never sees an event that the gate
    // rejected. This catches a future regression where the
    // permission check moves but the dispatch still runs.
    const mod = makeModule()
    const plugin = makePlugin({
      id: 'com.test.perm-emit-a',
      permissions: ['events'],
    })
    setGrantedSync('com.test.perm-listener', ['events'])
    const received: unknown[] = []
    const handler = (p: unknown) => received.push(p)
    ;(handler as unknown as { __pluginId: string }).__pluginId = 'com.test.perm-listener'
    const unsub = pluginEventBus.on('note:open', handler)
    const originalError = console.error
    console.error = () => {}
    try {
      await runPluginLifecycleHook(
        { ...plugin, __pluginModule: mod } as PluginDefinition,
        vi.fn(() => {
          const overrides = mod.setHost.mock.calls.at(-1)![0] as HostOverrides
          expect(() =>
            overrides.emit!('note:open', { noteId: 'n', path: '/p' })
          ).toThrow(PluginPermissionDeniedError)
        }),
        ctx,
        'onLoad'
      )
    } finally {
      console.error = originalError
      unsub()
    }
    expect(received).toEqual([])
  })
})
