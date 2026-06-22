/**
 * Regression test for the permission-guard race condition.
 *
 * Background
 * ----------
 * The previous design re-hydrated the in-memory `grants` cache
 * from localStorage via a fire-and-forget async call kicked off
 * from `App.tsx`. A plugin's first protected operation (e.g.
 * `store.get('key')`) would hit `assertPermission` while the
 * in-flight hydration was still pending, see an empty map, and
 * throw `PluginPermissionDeniedError` for a grant the user had
 * legitimately given in a prior session.
 *
 * Fix
 * ---
 * `plugin-permission-guard.ts` now hydrates the `grants` cache
 * synchronously at module-load time, walking every
 * `plugin_permissions_*` key in localStorage. By the time any
 * downstream code can import the guard and call
 * `assertPermission(...)`, the cache is already populated —
 * no `await`, no race window.
 *
 * What this test pins down
 * ------------------------
 * 1. A grant written to localStorage BEFORE the guard module
 *    is first imported must be visible to `assertPermission`
 *    immediately after the import, with no microtask wait.
 * 2. The eager hydration must ignore entries that are corrupt
 *    or empty, so one bad plugin can't poison the rest of the
 *    cache.
 * 3. A plugin that has *no* localStorage entry (fresh install,
 *    user hasn't opened the permission dialog yet) must still
 *    see a deny — the eager hydration must not invent grants.
 *
 * Note on the import shape
 * ------------------------
 * We use `vi.resetModules()` to force a fresh import of the
 * guard in each `it` block, so the module's top-level IIFE
 * observes the localStorage we just wrote. A static `import`
 * at the top of this file would run the IIFE exactly once at
 * Vitest's module-graph load time and miss the per-test
 * fixtures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const PERMISSIONS_KEY_PREFIX = 'plugin_permissions_'

function seedLocalStorage(entries: Record<string, unknown>): void {
  // Clear any pre-existing test pollution. The test should
  // not depend on the order Vitest runs cases in.
  window.localStorage.clear()
  for (const [pluginId, status] of Object.entries(entries)) {
    window.localStorage.setItem(
      `${PERMISSIONS_KEY_PREFIX}${pluginId}`,
      JSON.stringify(status),
    )
  }
  // A foreign key (different prefix) – must not be picked up.
  window.localStorage.setItem('unrelated_setting', 'should-be-ignored')
}

async function importFreshGuard() {
  // `resetModules` makes Vitest throw away its in-memory
  // copy of the guard module so the next import re-runs the
  // module's top-level code (including the IIFE).
  vi.resetModules()
  return import('@/lib/plugin-permission-guard')
}

describe('TC-WaveH-M1: eager sync hydration of the permission guard', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    window.localStorage.clear()
    vi.resetModules()
  })

  it('a pre-existing localStorage grant is visible to assertPermission without awaiting', async () => {
    seedLocalStorage({
      'com.swallownote.wenyan': [
        { permission: 'storage', granted: true, requested: true },
        { permission: 'events', granted: true, requested: true },
        { permission: 'clipboard', granted: false, requested: true },
      ],
    })

    // Dynamic import so the guard's top-level IIFE observes
    // the localStorage we just wrote.
    const { assertPermission } = await importFreshGuard()

    // Hot path: no await, no microtask gap. The user code
    // path that used to throw here now passes.
    expect(() =>
      assertPermission('com.swallownote.wenyan', 'storage', 'read storage'),
    ).not.toThrow()
    expect(() =>
      assertPermission('com.swallownote.wenyan', 'events', 'emit "note:change"'),
    ).not.toThrow()
    // ...but the not-granted permission still throws.
    expect(() =>
      assertPermission('com.swallownote.wenyan', 'clipboard', 'read clipboard'),
    ).toThrow(/missing permission: clipboard/)
  })

  it('skips entries with no granted permissions (so a fresh install still denies)', async () => {
    seedLocalStorage({
      'com.swallownote.fresh': [
        { permission: 'storage', granted: false, requested: true },
      ],
    })
    const { assertPermission } = await importFreshGuard()

    expect(() =>
      assertPermission('com.swallownote.fresh', 'storage', 'read storage'),
    ).toThrow(/missing permission: storage/)
  })

  it('corrupt entries are logged once and skipped – the rest of the cache still hydrates', async () => {
    // A poison entry – the JSON is broken on purpose.
    window.localStorage.setItem(
      `${PERMISSIONS_KEY_PREFIX}com.swallownote.poison`,
      '{not valid json',
    )
    // A healthy entry sitting right next to the poison one.
    window.localStorage.setItem(
      `${PERMISSIONS_KEY_PREFIX}com.swallownote.healthy`,
      JSON.stringify([{ permission: 'events', granted: true, requested: true }]),
    )

    const { assertPermission } = await importFreshGuard()

    // The healthy plugin's grant must materialise even though
    // a sibling entry is broken.
    expect(() =>
      assertPermission('com.swallownote.healthy', 'events', 'emit "x"'),
    ).not.toThrow()
    // The poison plugin is not granted anything – the broken
    // entry must not silently grant a permission.
    expect(() =>
      assertPermission('com.swallownote.poison', 'storage', 'read storage'),
    ).toThrow(/missing permission: storage/)
    // The warning was emitted at least once.
    expect(warnSpy).toHaveBeenCalled()
  })

  it('keys with a matching prefix but a non-array payload (corrupt / foreign) are ignored', async () => {
    // The audit log lives under `plugin_audit_log` (no
    // underscore), but a future plugin or a typo could land
    // a foreign value under our prefix. The hydration must
    // skip it without crashing the rest of the cache.
    window.localStorage.setItem(
      `${PERMISSIONS_KEY_PREFIX}audit_meta`,
      JSON.stringify({ not: 'an array' }),
    )
    // A healthy entry sitting right next to the foreign one.
    window.localStorage.setItem(
      `${PERMISSIONS_KEY_PREFIX}com.swallownote.healthy`,
      JSON.stringify([{ permission: 'events', granted: true, requested: true }]),
    )

    const { assertPermission } = await importFreshGuard()

    // The healthy plugin's grant must materialise even though
    // a sibling entry is the wrong shape.
    expect(() =>
      assertPermission('com.swallownote.healthy', 'events', 'emit "x"'),
    ).not.toThrow()
    // The foreign entry must not silently grant a permission.
    expect(() =>
      assertPermission('audit_meta', 'storage', 'read storage'),
    ).toThrow(/missing permission: storage/)
    // The warning was emitted at least once.
    expect(warnSpy).toHaveBeenCalled()
  })

  it('keys without the permission prefix are ignored', async () => {
    // The audit log, the auto-update map, and the theme
    // settings all share the localStorage namespace but use
    // their own prefixes – they must not be parsed as
    // permission entries.
    window.localStorage.setItem('plugin_audit_log', '[{"x":1}]')
    window.localStorage.setItem('plugin_auto_update_com.x.y', 'true')
    window.localStorage.setItem('sn-theme', '{"theme":"light"}')

    const { hasPermission } = await importFreshGuard()

    // None of these should be interpreted as a grant.
    expect(hasPermission('audit_log', 'storage')).toBe(false)
    expect(hasPermission('auto_update_com.x.y', 'storage')).toBe(false)
    expect(hasPermission('sn-theme', 'storage')).toBe(false)
  })
})
