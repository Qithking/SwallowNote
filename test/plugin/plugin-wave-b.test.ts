/**
 * TC-WaveB: Plugin fixes for the fifth-round code review
 *
 * Covers the Wave B Major findings:
 *
 *  M1  dispatchBuiltin toast description — the conflict
 *      toast now carries an explicit description naming the
 *      built-in action that "won" the keystroke. Without
 *      it the toast body says "plugin X is shadowed" while
 *      the action also runs, leaving the user guessing
 *      which side won.
 *
 *  M2  Conflict-toast throttling — even with a stable
 *      sonner `id`, a user holding Ctrl+S for one second
 *      would queue a fresh toast on every keypress (the
 *      `id` collapse still costs a render). The 200ms
 *      per-binding throttle keeps the corner quiet.
 *
 *  M4  SDK dispatchEmit warns on permission denial — the
 *      previous try/catch silently swallowed
 *      `PluginPermissionDeniedError`, hiding a real
 *      "missing events grant" problem from plugin authors.
 *      The SDK now `console.warn`s with an actionable
 *      message; we detect the error by `name` (the SDK
 *      is host-agnostic so it cannot import the class).
 *
 *  M6  setPluginAutoUpdate refuses unknown IDs — a
 *      `setPluginAutoUpdate('unknown', false)` call no
 *      longer writes `pluginAutoUpdate['unknown'] = false`
 *      + a stale `localStorage` key. The store early-
 *      returns; only registered plugin ids are accepted.
 *
 * The M3 / M5 fixes are Rust-side (`src-tauri/src/commands/plugin.rs`)
 * and have their own cargo tests; this file is the
 * TypeScript side of the Wave B contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─── M1 / M2 setup ──────────────────────────────────────────────────────────

// Mock sonner BEFORE importing the hook so the hook picks
// up the mocked `toast` instead of the real implementation.
vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: () => null,
}))

import {
  findConflictingPluginCommandKey,
  dispatchBuiltin,
} from '@/hooks/useKeyboardShortcuts'
import { useUIStore } from '@/stores/ui'
import { usePluginStore, PLUGIN_AUTO_UPDATE_KEY_PREFIX } from '@/stores/plugin'
import { toast } from 'sonner'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fakeKeyEvent(shortcut: string, keyOverrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const parts = shortcut.split('+')
  const mainKey = parts[parts.length - 1]
  const ctrl = parts.includes('Ctrl') || parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  return {
    key: mainKey,
    ctrlKey: ctrl,
    metaKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    preventDefault: vi.fn(),
    ...keyOverrides,
  } as unknown as KeyboardEvent
}

function makePlugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  }
}

function resetPluginStore(): void {
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
}

beforeEach(() => {
  useUIStore.setState({ pluginCommandShortcuts: {} })
  vi.mocked(toast).mockClear()
  resetPluginStore()
})

afterEach(() => {
  useUIStore.setState({ pluginCommandShortcuts: {} })
  vi.mocked(toast).mockClear()
  resetPluginStore()
  vi.useRealTimers()
})

// ─── M1: dispatchBuiltin toast description ──────────────────────────────────

describe('TC-WaveB-M1: dispatchBuiltin toast description names the built-in action', () => {
  it('passes a description string that includes the action key', () => {
    // The pre-fix toast was a single string with no description,
    // so the user saw "plugin X is shadowed" *and* the
    // command palette opened and had to guess why both
    // happened. The fix adds a `description` option that
    // explicitly names the winning built-in.
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m1-desc': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    dispatchBuiltin(e, 'commandPalette', () => {})

    expect(toast).toHaveBeenCalledTimes(1)
    const [, options] = vi.mocked(toast).mock.calls[0] as [
      string,
      { id: string; description?: string; duration?: number },
    ]
    // The description must name the action so the user
    // knows the palette (not the plugin) just opened.
    expect(options.description).toBeDefined()
    expect(options.description).toContain('commandPalette')
  })

  it('renders the description through i18n (zh-CN default)', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m1-i18n': 'Ctrl+S',
      },
    })
    const e = fakeKeyEvent('Ctrl+S')
    dispatchBuiltin(e, 'saveFile', () => {})
    const [, options] = vi.mocked(toast).mock.calls[0] as [
      string,
      { id: string; description: string },
    ]
    // The zh-CN description is the canonical string we
    // added in the i18n patch.
    expect(options.description).toContain('saveFile')
    expect(options.description).toContain('已执行')
  })

  it('extends the toast duration so the description is actually readable', () => {
    // The pre-fix duration was 1.5s; the title alone fits
    // comfortably in that window, but the new two-line
    // message (title + description) doesn't. Lock the new
    // duration to 3s.
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m1-dur': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    dispatchBuiltin(e, 'commandPalette', () => {})
    const [, options] = vi.mocked(toast).mock.calls[0] as [
      string,
      { duration: number },
    ]
    expect(options.duration).toBe(3000)
  })
})

// ─── M2: per-binding-key throttle ───────────────────────────────────────────

describe('TC-WaveB-M2: conflict-toast throttle', () => {
  it('shows the toast once for rapid presses within the throttle window', () => {
    // Holding Ctrl+S for 1s (≈10 keydowns at 100ms cadence)
    // should produce exactly ONE toast, not 10. The
    // sonner `id` already collapses the queue visually, but
    // the previous implementation still *called* `toast`
    // on every keypress, costing a re-render per call.
    //
    // Note: the throttle Map is keyed by binding key, so
    // every test in this suite must use a *unique* binding
    // key — otherwise a previous test's throttle would
    // suppress the current one. The shared module-level
    // Map is intentional (it's a real production cache).
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m2-rapid': 'Ctrl+S',
      },
    })
    for (let i = 0; i < 10; i++) {
      const e = fakeKeyEvent('Ctrl+S')
      dispatchBuiltin(e, 'saveFile', () => {})
    }
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('shows a fresh toast once the throttle window has elapsed', () => {
    // Two presses 250ms apart should produce two toasts:
    // 200ms is the throttle window, so the second press
    // falls just outside it. We use `vi.useFakeTimers()` +
    // `vi.setSystemTime()` to make the timing deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m2-elapsed': 'Ctrl+P',
      },
    })
    dispatchBuiltin(fakeKeyEvent('Ctrl+P'), 'commandPalette', () => {})
    expect(toast).toHaveBeenCalledTimes(1)
    // Advance 250ms — past the 200ms throttle window.
    vi.setSystemTime(new Date('2026-01-01T00:00:00.250Z'))
    dispatchBuiltin(fakeKeyEvent('Ctrl+P'), 'commandPalette', () => {})
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('throttles per binding key (Ctrl+S and Ctrl+P are independent)', () => {
    // Two different plugins bound to two different keys:
    // each key's toast must show exactly once even when
    // both keys are pressed back-to-back in the same
    // throttle window. The Map is keyed by binding key,
    // not by shortcut key.
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:m2-save': 'Ctrl+S',
        'com.bar:m2-pal': 'Ctrl+P',
      },
    })
    dispatchBuiltin(fakeKeyEvent('Ctrl+S'), 'saveFile', () => {})
    dispatchBuiltin(fakeKeyEvent('Ctrl+P'), 'commandPalette', () => {})
    expect(toast).toHaveBeenCalledTimes(2)
  })
})

// ─── M4: SDK dispatchEmit warns on permission denial ────────────────────────

describe('TC-WaveB-M4: dispatchEmit warns on PluginPermissionDeniedError', () => {
  it('console.warns when the host emit throws a permission-denied error', async () => {
    // The SDK is host-agnostic — it can't import the host's
    // `PluginPermissionDeniedError` class — so it detects
    // by `name === 'PluginPermissionDeniedError'`. We
    // install a fake `setHost` override that throws an
    // Error subclass with the matching `name` and verify
    // the SDK surfaces a `console.warn` (not `error`).
    const { setHost, emitNoteChanged } = await import(
      '@swallow-note/plugin-sdk'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = new Error('not allowed')
    err.name = 'PluginPermissionDeniedError'
    ;(err as { operation?: string }).operation = 'emit "note:change"'
    const restore = setHost({
      emit: () => {
        throw err
      },
    })
    try {
      emitNoteChanged('n1', '/a.md', 'body')
      expect(warn).toHaveBeenCalledTimes(1)
      const message = String(warn.mock.calls[0][0])
      // The warning must include the operation name, the
      // missing permission, and the event name so the dev
      // can immediately locate the broken manifest line.
      expect(message).toContain('note:change')
      expect(message).toContain('events')
    } finally {
      restore()
      warn.mockRestore()
    }
  })

  it('falls back to console.error for non-permission errors', async () => {
    // Anything that is NOT a PluginPermissionDeniedError
    // is a real host bug and should still be loud
    // (console.error) so the stack is visible. The
    // previous behaviour (always console.error) is
    // preserved for this case.
    const { setHost, emitNoteChanged } = await import(
      '@swallow-note/plugin-sdk'
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const restore = setHost({
      emit: () => {
        throw new Error('host crashed')
      },
    })
    try {
      emitNoteChanged('n1', '/a.md', 'body')
      expect(error).toHaveBeenCalledTimes(1)
    } finally {
      restore()
      error.mockRestore()
    }
  })
})

// ─── M6: setPluginAutoUpdate refuses unknown IDs ───────────────────────────

describe('TC-WaveB-M6: setPluginAutoUpdate refuses unknown plugin ids', () => {
  it('does not write the in-memory record for a non-existent plugin id', () => {
    // Pre-fix: calling setPluginAutoUpdate('com.test.ghost', false)
    // would write `pluginAutoUpdate['com.test.ghost'] = false`
    // to the store, polluting the map with an id that no
    // plugin will ever resolve to.
    usePluginStore.setState({ pluginAutoUpdate: {} })
    usePluginStore.getState().setPluginAutoUpdate('com.test.ghost', false)
    expect(
      usePluginStore.getState().pluginAutoUpdate['com.test.ghost'],
    ).toBeUndefined()
  })

  it('does not write the localStorage key for a non-existent plugin id', () => {
    usePluginStore.setState({ pluginAutoUpdate: {} })
    usePluginStore.getState().setPluginAutoUpdate('com.test.ghost', false)
    expect(
      window.localStorage.getItem(
        `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.ghost`,
      ),
    ).toBeNull()
  })

  it('does not write either record for `enabled = true` on a non-existent id', () => {
    // Symmetric with the `false` case: even an "opt-in"
    // toggle for a non-existent plugin id should be
    // dropped, so a future install of the same id picks
    // up a clean default (off) instead of inheriting a
    // stale opt-in the user can't audit.
    usePluginStore.setState({ pluginAutoUpdate: {} })
    usePluginStore.getState().setPluginAutoUpdate('com.test.ghost', true)
    expect(
      usePluginStore.getState().pluginAutoUpdate['com.test.ghost'],
    ).toBeUndefined()
    expect(
      window.localStorage.getItem(
        `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.ghost`,
      ),
    ).toBeNull()
  })

  it('still writes the record for a registered plugin id', () => {
    // Sanity check: the early-return must NOT regress the
    // happy path. A registered plugin's toggle should
    // still persist exactly as before.
    const a = makePlugin({ id: 'com.test.registered' })
    usePluginStore.getState().setPlugins([a])
    usePluginStore.getState().setPluginAutoUpdate('com.test.registered', true)
    expect(
      usePluginStore.getState().getPluginAutoUpdate('com.test.registered'),
    ).toBe(true)
    expect(
      window.localStorage.getItem(
        `${PLUGIN_AUTO_UPDATE_KEY_PREFIX}com.test.registered`,
      ),
    ).toBe('true')
  })
})
