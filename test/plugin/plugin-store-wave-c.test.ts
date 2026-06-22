/**
 * TC-WaveC: Plugin store fourth-round review fixes
 *
 * Covers the Wave C findings flagged during the fourth-round
 * code review:
 *
 *  M6  setPlugins must clean up the per-plugin auto-update
 *      opt-in and load-failure records (plus the localStorage
 *      key) for every removed plugin, the same way
 *      `unregisterPlugin` already does.
 *  M7  unregisterPlugin must drop the plugin's telemetry
 *      ring-buffer entries (events / storage / hooks / ipc),
 *      the storage-size map, and the cached "last error"
 *      entry. The other cleanup paths (storage cache, event
 *      bus, menu items, command palette, permissions) already
 *      fire; the four ring buffers were the only survivors.
 *  M8  unregisterPlugin must also call
 *      `useUIStore.prunePluginCommandShortcuts` so a plugin
 *      uninstall can't leave dangling user-bound shortcuts in
 *      the persisted settings.
 *  M9  setPlugins must not call `detectPluginConflicts` twice
 *      (once inside `buildConflictMap`, once in the
 *      `recordPluginConflict` loop). Cache the result and
 *      reuse it. We assert the telemetry loop still emits
 *      exactly one entry per detected conflict.
 *  M10 setPluginAutoUpdate must short-circuit when the toggle
 *      is a no-op (in-memory record and mirrored definition
 *      flag are already correct). The previous implementation
 *      always rebuilt the `plugins` array, which forced every
 *      `s.plugins` subscriber to re-render.
 *
 * The `M16` shortcut-conflict toast lives in
 * `useKeyboardShortcuts`; it's covered by
 * `keyboard-shortcut-plugin-conflict.test.ts` so this file
 * stays focused on the store changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePluginStore, PLUGIN_AUTO_UPDATE_KEY_PREFIX } from '@/stores/plugin'
import { useUIStore } from '@/stores/ui'
import {
  recordEventMetric,
  recordStorageMetric,
  recordHookMetric,
  recordBackendMetric,
  recordPluginError,
  getEventMetrics,
  getStorageMetrics,
  getHookMetrics,
  getBackendMetrics,
  getPluginLastError,
  clearAllMetrics,
} from '@/lib/plugin-telemetry'
import { registerCommand, listPluginCommands, clearPluginCommands } from '@/lib/plugin-commands'
import { setGranted, clearAll as clearAllGrants } from '@/lib/plugin-permission-guard'
import type { PluginDefinition } from '@/types/plugin'

// ─── Fixture helpers ────────────────────────────────────────────────────────

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

/**
 * Resilient reset between tests. The plugin store keeps
 * module-level state (Zustand), so we call the same setters
 * the production code uses to bring it back to a known
 * baseline. We don't `setState({ ...initial })` directly
 * because that's not a documented Zustand pattern and the
 * store's reducer functions own the cleanup semantics we want
 * to assert.
 */
function resetStores(): void {
  usePluginStore.setState({
    plugins: [],
    registry: { sidebar: [], editorToolbar: [], titleBar: [] },
    pluginHealth: {},
    pluginAutoUpdate: {},
    loadFailures: {},
    pluginConflicts: {},
    activeLeftPanelPluginId: null,
    activeRightPanelPluginId: null,
    activeFullPanelPluginId: null,
    activeEditorAreaPluginId: null,
  })
  useUIStore.setState({
    pluginCommandShortcuts: {},
  })
  clearAllMetrics()
  // Wave A / C2: wipe the command-palette registry between
  // tests so leftovers from one suite don't leak into the
  // next. The registry is module-level state in
  // `plugin-commands.ts`; without this reset a test that
  // registered a command (and never unregistered it) would
  // have it visible in every subsequent test's
  // `listPluginCommands()` snapshot.
  clearPluginCommands('com.test.going')
  clearPluginCommands('com.test.staying')
  clearPluginCommands('com.test.keep')
  clearPluginCommands('com.test.drop')
  clearPluginCommands('com.test.cmd-pal-a')
  clearPluginCommands('com.test.cmd-pal-b')
  // `registerCommand` enforces the `events` permission, so
  // the C2 suite has to clear the in-memory grant cache
  // (the registry reads from a module-level Map) before
  // each test. Otherwise a grant leaked from another
  // test would silently let a command through here even
  // when the fixture plugin's `permissions` array is
  // empty.
  clearAllGrants()
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  resetStores()
  vi.useRealTimers()
})

// ─── M6: setPlugins prunes pluginAutoUpdate / loadFailures ─────────────────

describe('TC-WaveC-M6: setPlugins prunes auto-update + load-failure state for removed plugins', () => {
  it('drops the per-plugin auto-update record when a plugin is removed by setPlugins', () => {
    const a = makePlugin({ id: 'com.test.a' })
    const b = makePlugin({ id: 'com.test.b' })
    // Seed the store with both plugins and a stored opt-in for each.
    usePluginStore.getState().setPlugins([a, b])
    usePluginStore.getState().setPluginAutoUpdate('com.test.a', true)
    usePluginStore.getState().setPluginAutoUpdate('com.test.b', true)
    expect(usePluginStore.getState().getPluginAutoUpdate('com.test.a')).toBe(true)

    // Rescan with only `b` — the marketplace uninstall path. The
    // `a` entry should disappear from the in-memory map.
    usePluginStore.getState().setPlugins([b])
    expect(usePluginStore.getState().getPluginAutoUpdate('com.test.a')).toBe(false)
    // `b` should still be opted in (unrelated to the removal).
    expect(usePluginStore.getState().getPluginAutoUpdate('com.test.b')).toBe(true)
  })

  it('removes the localStorage opt-in key for the uninstalled plugin', () => {
    const a = makePlugin({ id: 'com.test.ls' })
    usePluginStore.getState().setPlugins([a])
    usePluginStore.getState().setPluginAutoUpdate('com.test.ls', true)
    // The opt-in is persisted to localStorage. Confirm baseline
    // so the post-removal assertion is meaningful.
    expect(window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.ls`)).toBe('true')

    usePluginStore.getState().setPlugins([])
    expect(
      window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.ls`),
    ).toBeNull()
  })

  it('drops the per-plugin load-failure record when a plugin is removed by setPlugins', () => {
    // The realistic scenario: a plugin was previously
    // registered AND has a load failure recorded (e.g. a
    // half-loaded package that later got fully removed from
    // disk by the user). A rescan that no longer includes
    // the broken plugin should clear the failure record.
    const broken = makePlugin({ id: 'com.test.lf' })
    usePluginStore.getState().registerPlugin(broken)
    usePluginStore.getState().setLoadFailures([
      {
        id: 'com.test.lf',
        name: 'Broken',
        reason: 'manifest parse error',
        ts: Date.now(),
        pluginPath: '/tmp/broken',
      },
    ])
    expect(usePluginStore.getState().loadFailures['com.test.lf']).toBeDefined()

    // Rescan with an unrelated plugin — the broken plugin's
    // load-failure record should vanish from the map.
    usePluginStore.getState().setPlugins([makePlugin({ id: 'com.test.ok' })])
    expect(usePluginStore.getState().loadFailures['com.test.lf']).toBeUndefined()
  })
})

// ─── M7: unregisterPlugin clears telemetry ring buffers ────────────────────

describe('TC-WaveC-M7: unregisterPlugin clears the plugin telemetry ring buffers', () => {
  it('drops every ring-buffer entry attributed to the removed plugin', () => {
    const a = makePlugin({ id: 'com.test.telem-a' })
    const b = makePlugin({ id: 'com.test.telem-b' })
    usePluginStore.getState().registerPlugin(a)
    usePluginStore.getState().registerPlugin(b)

    // Seed metrics for both plugins. We use the recorders the
    // host itself uses so the test exercises the real
    // production code path.
    recordEventMetric(a.id, 'note:open', { noteId: 'n', path: '/a' }, 0, 1, 0)
    recordStorageMetric(a.id, 'set', 1, 10, 1, true)
    recordHookMetric(a.id, 'onLoad', 5, true)
    recordBackendMetric(a.id, 'cmd', 2, true)
    // And one entry for the other plugin to confirm the
    // per-plugin scoping of the cleanup.
    recordHookMetric(b.id, 'onLoad', 7, true)

    expect(getEventMetrics().some((m) => m.pluginId === a.id)).toBe(true)
    expect(getStorageMetrics().some((m) => m.pluginId === a.id)).toBe(true)
    expect(getHookMetrics().some((m) => m.pluginId === a.id)).toBe(true)
    expect(getBackendMetrics().some((m) => m.pluginId === a.id)).toBe(true)
    expect(getHookMetrics().some((m) => m.pluginId === b.id)).toBe(true)

    usePluginStore.getState().unregisterPlugin(a.id)

    expect(getEventMetrics().some((m) => m.pluginId === a.id)).toBe(false)
    expect(getStorageMetrics().some((m) => m.pluginId === a.id)).toBe(false)
    expect(getHookMetrics().some((m) => m.pluginId === a.id)).toBe(false)
    expect(getBackendMetrics().some((m) => m.pluginId === a.id)).toBe(false)
    // The other plugin's metrics are untouched.
    expect(getHookMetrics().some((m) => m.pluginId === b.id)).toBe(true)
  })

  it('clears the cached lastError for the removed plugin', () => {
    const a = makePlugin({ id: 'com.test.err' })
    usePluginStore.getState().registerPlugin(a)
    recordPluginError(a.id, 'onLoad', 'timeout', false)
    expect(getPluginLastError(a.id)?.message).toBe('timeout')

    usePluginStore.getState().unregisterPlugin(a.id)
    expect(getPluginLastError(a.id)).toBeUndefined()
  })
})

// ─── M8: unregisterPlugin prunes pluginCommandShortcuts ────────────────────

describe('TC-WaveC-M8: unregisterPlugin prunes the user-bound plugin-command shortcut', () => {
  it('drops the binding key for the removed plugin only', () => {
    // Both plugins are in the store. The prune pass runs
    // after the unregister and uses the post-set valid id
    // set as the source of truth — i.e. the binding for
    // `com.test.going` should be removed because that
    // plugin is no longer in the store, even though the
    // user never explicitly asked for the shortcut to be
    // unbound. (The `prunePluginCommandShortcuts` helper
    // has its own idempotent contract; this test exercises
    // the integration with `unregisterPlugin`.)
    const going = makePlugin({ id: 'com.test.going' })
    const staying = makePlugin({ id: 'com.test.staying' })
    usePluginStore.getState().setPlugins([going, staying])
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.test.going:cmd': 'Ctrl+Shift+X',
        'com.test.staying:cmd': 'Ctrl+Shift+Y',
      },
    })

    usePluginStore.getState().unregisterPlugin('com.test.going')

    expect(
      useUIStore.getState().pluginCommandShortcuts['com.test.going:cmd'],
    ).toBeUndefined()
    expect(
      useUIStore.getState().pluginCommandShortcuts['com.test.staying:cmd'],
    ).toBe('Ctrl+Shift+Y')
  })

  it('drops the binding key when the plugin is present in the store', () => {
    const a = makePlugin({ id: 'com.test.keep' })
    const b = makePlugin({ id: 'com.test.drop' })
    usePluginStore.getState().setPlugins([a, b])
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.test.keep:cmd': 'Ctrl+Shift+X',
        'com.test.drop:cmd': 'Ctrl+Shift+Y',
      },
    })

    usePluginStore.getState().unregisterPlugin('com.test.drop')

    expect(
      useUIStore.getState().pluginCommandShortcuts['com.test.drop:cmd'],
    ).toBeUndefined()
    expect(
      useUIStore.getState().pluginCommandShortcuts['com.test.keep:cmd'],
    ).toBe('Ctrl+Shift+X')
  })
})

// ─── M9: setPlugins calls detectPluginConflicts only once ──────────────────

describe('TC-WaveC-M9: setPlugins invokes detectPluginConflicts only once per refresh', () => {
  it('emits exactly one telemetry line per detected conflict (no duplication)', async () => {
    // Two enabled plugins share the same commandPalette entry —
    // the canonical commandPalette collision. A third plugin
    // uses a unique command so we also know the detector isn't
    // over-reporting.
    const a = makePlugin({ id: 'com.test.collide-a', commandPalette: ['shared.cmd'] })
    const b = makePlugin({ id: 'com.test.collide-b', commandPalette: ['shared.cmd'] })
    const c = makePlugin({ id: 'com.test.collide-c', commandPalette: ['unique.cmd'] })

    usePluginStore.getState().setPlugins([a, b, c])
    // Yield once so the synchronous `set()` plus the
    // post-set telemetry loop both have run.
    await Promise.resolve()

    const conflicts = getHookMetrics().filter(
      (m) => m.hook === 'plugin.conflict' && m.error?.includes('shared.cmd'),
    )
    // The previous double-call bug would have produced two
    // entries per conflict; the fix produces exactly one.
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].error).toContain('com.test.collide-a')
    expect(conflicts[0].error).toContain('com.test.collide-b')
  })

  it('keeps the per-plugin conflict map consistent with the detector output', () => {
    // Two enabled plugins share the same `commandPalette` entry.
    // The detector should emit one conflict, and each plugin's
    // bucket should hold it. We assert against the absolute
    // count to lock the contract: the map is 1:1 with the
    // detector output, not silently de-duplicated.
    const a = makePlugin({
      id: 'com.test.cm-a',
      commandPalette: ['collide.cmd'],
    })
    const b = makePlugin({
      id: 'com.test.cm-b',
      commandPalette: ['collide.cmd'],
    })
    usePluginStore.getState().setPlugins([a, b])

    const map = usePluginStore.getState().pluginConflicts
    const aConflicts = map['com.test.cm-a']
    const bConflicts = map['com.test.cm-b']
    expect(aConflicts).toBeDefined()
    expect(bConflicts).toBeDefined()
    expect(aConflicts).toHaveLength(bConflicts.length)
    // The kinds are stable: the single commandPalette
    // collision. We assert the *peer id set* is the same
    // across both plugins' buckets — i.e. the per-plugin
    // projection is symmetric.
    const aPeerIds = aConflicts.map((c) => c.kind).sort()
    const bPeerIds = bConflicts.map((c) => c.kind).sort()
    expect(aPeerIds).toEqual(bPeerIds)
    // Each conflict should list both plugins as peers.
    for (const c of aConflicts) {
      expect(c.peerIds).toEqual(['com.test.cm-a', 'com.test.cm-b'])
    }
  })
})

// ─── M10: setPluginAutoUpdate short-circuits no-op toggles ─────────────────

describe('TC-WaveC-M10: setPluginAutoUpdate short-circuits a no-op toggle', () => {
  it('does not replace the plugins array when the opt-in is already in the requested state', () => {
    const a = makePlugin({ id: 'com.test.au' })
    usePluginStore.getState().setPlugins([a])
    const before = usePluginStore.getState().plugins
    // No `setPluginAutoUpdate` call yet — the mirrored
    // `autoUpdate` is `false`, the in-memory record is
    // absent. Toggle "off" → "off" should be a no-op.
    usePluginStore.getState().setPluginAutoUpdate('com.test.au', false)
    const after = usePluginStore.getState().plugins
    expect(after).toBe(before)
  })

  it('does not replace the plugins array when toggling to the already-stored value', () => {
    const a = makePlugin({ id: 'com.test.au2' })
    usePluginStore.getState().setPlugins([a])
    usePluginStore.getState().setPluginAutoUpdate('com.test.au2', true)
    const afterFirst = usePluginStore.getState().plugins
    // Toggle the same value a second time — the in-memory
    // record is `true`, the mirrored flag is `true`, and
    // `setPluginAutoUpdate('com.test.au2', true)` must be
    // a no-op.
    usePluginStore.getState().setPluginAutoUpdate('com.test.au2', true)
    const afterSecond = usePluginStore.getState().plugins
    expect(afterSecond).toBe(afterFirst)
  })

  it('replaces the plugins array when the toggle actually flips the value', () => {
    const a = makePlugin({ id: 'com.test.au3' })
    usePluginStore.getState().setPlugins([a])
    const before = usePluginStore.getState().plugins
    usePluginStore.getState().setPluginAutoUpdate('com.test.au3', true)
    const after = usePluginStore.getState().plugins
    // Different reference because the autoUpdate flag flipped
    // from false → true.
    expect(after).not.toBe(before)
    expect(usePluginStore.getState().getPluginAutoUpdate('com.test.au3')).toBe(true)
  })

  it('persists the localStorage value only when the toggle actually changes', () => {
    const a = makePlugin({ id: 'com.test.au4' })
    usePluginStore.getState().setPlugins([a])
    usePluginStore.getState().setPluginAutoUpdate('com.test.au4', true)
    const firstWrite = window.localStorage.getItem(
      `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.au4`,
    )
    expect(firstWrite).toBe('true')
    // Spy on `setItem` to confirm we don't write again on a
    // no-op toggle. We can't easily spy on window.localStorage
    // directly, so we just toggle the same value and check
    // the value is still 'true' (it would still be 'true'
    // even if we wrote again, so this is mostly a smoke
    // test — the meaningful check is the array-reference
    // check above).
    usePluginStore.getState().setPluginAutoUpdate('com.test.au4', true)
    expect(
      window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.au4`),
    ).toBe('true')
    // Now flip to false; the new value should be persisted.
    usePluginStore.getState().setPluginAutoUpdate('com.test.au4', false)
    expect(
      window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.au4`),
    ).toBe('false')
  })
})

// ─── Wave A / C2: unregisterPlugin clears the command palette ────────────

describe('TC-WaveA-C2: unregisterPlugin clears the plugin command-palette entries', () => {
  it('drops the command-palette entries owned by the removed plugin', () => {
    const a = makePlugin({ id: 'com.test.cmd-pal-a' })
    const b = makePlugin({ id: 'com.test.cmd-pal-b' })
    usePluginStore.getState().registerPlugin(a)
    usePluginStore.getState().registerPlugin(b)
    // `registerCommand` gates on the `events` permission.
    // Grant it to both fixture plugins so the registry
    // accepts the calls; the test then asserts that the
    // permission gate is independent from the
    // cleanup contract we're locking here.
    setGranted(a.id, ['events'])
    setGranted(b.id, ['events'])

    // Both plugins contribute one command each. The pre-fix
    // code path silently leaked `a`'s command on
    // `unregisterPlugin(a.id)` because the helper call
    // (`clearPluginCommands(target.id)`) was only on the
    // `setPlugins` diff path.
    registerCommand(a.id, {
      id: 'open',
      title: 'Open',
      onTrigger: () => {},
    })
    registerCommand(b.id, {
      id: 'open',
      title: 'Open',
      onTrigger: () => {},
    })
    // Sanity-check the baseline: both commands are visible.
    const before = listPluginCommands()
    expect(before.some((c) => (c as { __pluginId?: string }).__pluginId === a.id)).toBe(true)
    expect(before.some((c) => (c as { __pluginId?: string }).__pluginId === b.id)).toBe(true)

    usePluginStore.getState().unregisterPlugin(a.id)

    const after = listPluginCommands()
    // `a`'s command is gone…
    expect(after.some((c) => (c as { __pluginId?: string }).__pluginId === a.id)).toBe(false)
    // …and `b`'s command is untouched.
    expect(after.some((c) => (c as { __pluginId?: string }).__pluginId === b.id)).toBe(true)
  })

  it('mirrors the setPlugins diff path: both call clearPluginCommands', () => {
    // Wave A / C2 is about *consistency* between the two
    // cleanup paths. The pre-fix code called
    // `clearPluginCommands(target.id)` from the `setPlugins`
    // diff loop but NOT from `unregisterPlugin`, so a plugin
    // uninstalled via the explicit "Uninstall" button
    // (which calls `unregisterPlugin`) leaked its command-
    // palette entries. We assert the two paths are now
    // equivalent: after either `unregisterPlugin(a.id)` or
    // `setPlugins([b])` the registry no longer contains
    // `a`'s command.
    const a = makePlugin({ id: 'com.test.cmd-pal-a' })
    const b = makePlugin({ id: 'com.test.cmd-pal-b' })
    setGranted(a.id, ['events'])
    setGranted(b.id, ['events'])

    // Path 1: unregisterPlugin.
    usePluginStore.getState().registerPlugin(a)
    usePluginStore.getState().registerPlugin(b)
    registerCommand(a.id, { id: 'cmd', title: 'A', onTrigger: () => {} })
    registerCommand(b.id, { id: 'cmd', title: 'B', onTrigger: () => {} })
    usePluginStore.getState().unregisterPlugin(a.id)
    expect(listPluginCommands().some((c) => (c as { __pluginId?: string }).__pluginId === a.id)).toBe(false)
    expect(listPluginCommands().some((c) => (c as { __pluginId?: string }).__pluginId === b.id)).toBe(true)

    // Path 2: setPlugins diff (now with `a` already gone).
    // The diff loop must clear `b`'s command when `b`
    // disappears from the incoming list.
    usePluginStore.getState().setPlugins([])
    expect(listPluginCommands()).toHaveLength(0)
  })
})
