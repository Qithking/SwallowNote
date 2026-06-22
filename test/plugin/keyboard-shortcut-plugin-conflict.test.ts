/**
 * TC-WaveC-M16: Built-in shortcut vs plugin-command binding conflict
 *
 * Covers the Wave C M16 finding: a plugin command bound to the
 * same key combination as a built-in shortcut used to be
 * silently shadowed — the user pressed the key, the built-in
 * ran, and the plugin command never fired. The fix surfaces
 * a sonner toast so the user knows their plugin command is
 * being shadowed by the built-in.
 *
 * The behaviour we lock here:
 *   1. `findConflictingPluginCommandKey` returns the
 *      `<pluginId>:<commandId>` key for a binding that
 *      matches the event, and `null` when no binding
 *      matches.
 *   2. `dispatchBuiltin` is a no-op (returns `false`,
 *      doesn't call `preventDefault`, doesn't fire the
 *      toast) when the event doesn't match the built-in
 *      shortcut — so a keystroke the editor would have
 *      wanted is left alone.
 *   3. When the event matches a built-in shortcut AND a
 *      plugin command is bound to the same key, the toast
 *      fires with the plugin id and the built-in action
 *      also runs.
 *   4. When the event matches a built-in shortcut but no
 *      plugin command is bound to the same key, the
 *      built-in action runs and the toast is NOT fired.
 *   5. The plugin id is correctly stripped from the
 *      `<pluginId>:<commandId>` binding key in the toast
 *      message (with a reverse-DNS id that itself contains
 *      colons, the toast reads the full id up to the LAST
 *      colon).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock sonner BEFORE importing the hook so the hook picks
// up the mocked `toast` instead of the real implementation
// (which would otherwise try to render to a DOM that the
// test setup doesn't own).
vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: () => null,
}))

import {
  findConflictingPluginCommandKey,
  dispatchBuiltin,
} from '@/hooks/useKeyboardShortcuts'
import { useUIStore } from '@/stores/ui'
import { toast } from 'sonner'
import i18n from 'i18next'

/**
 * Construct a KeyboardEvent that `matchShortcut` will accept
 * for a given shortcut string like 'Ctrl+P'. We don't fire
 * the event through `window.dispatchEvent` because we want
 * to drive `dispatchBuiltin` directly with the event
 * object (the hook's own listener does the same).
 */
function fakeKeyEvent(shortcut: string, keyOverrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  // Parse "Ctrl+P" / "Ctrl+Shift+S" / "F2" / "Ctrl+Delete"
  // etc. into the modifier flags the matcher expects.
  const parts = shortcut.split('+')
  const mainKey = parts[parts.length - 1]
  const ctrl = parts.includes('Ctrl') || parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  return {
    key: mainKey,
    ctrlKey: ctrl,
    metaKey: ctrl, // matchShortcut accepts either as "Mod"
    shiftKey: shift,
    altKey: alt,
    preventDefault: vi.fn(),
    ...keyOverrides,
  } as unknown as KeyboardEvent
}

beforeEach(() => {
  // Reset the plugin-command shortcut map so each test
  // starts from a known baseline. The setup file already
  // wipes localStorage; we just need the in-memory state.
  useUIStore.setState({ pluginCommandShortcuts: {} })
  // Spy on the sonner toast so we can assert the message
  // and the duration knob.
  vi.mocked(toast).mockClear()
})

afterEach(() => {
  useUIStore.setState({ pluginCommandShortcuts: {} })
  vi.mocked(toast).mockClear()
})

describe('TC-WaveC-M16: findConflictingPluginCommandKey', () => {
  it('returns null when no plugin command is bound to the event', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:bar': 'Ctrl+Shift+X',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    expect(findConflictingPluginCommandKey(e)).toBeNull()
  })

  it('returns the binding key when a plugin command is bound to the same key', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:bar': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    expect(findConflictingPluginCommandKey(e)).toBe('com.foo:bar')
  })

  it('ignores empty / falsy binding values', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:bar': '',
        'com.baz:qux': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    expect(findConflictingPluginCommandKey(e)).toBe('com.baz:qux')
  })

  it('returns the first matching key (iteration order is insertion order)', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.first:cmd': 'Ctrl+P',
        'com.second:cmd': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    // Object.entries preserves insertion order, so the
    // first-registered binding wins — matches the existing
    // plugin-command loop in `useKeyboardShortcuts` (which
    // also iterates in insertion order and returns on the
    // first match).
    expect(findConflictingPluginCommandKey(e)).toBe('com.first:cmd')
  })
})

describe('TC-WaveC-M16: dispatchBuiltin no-op path', () => {
  it('returns false and does not call preventDefault when the event does not match the built-in', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:cmd': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+S') // built-in saveFile is Ctrl+S, not Ctrl+P
    const action = vi.fn()
    const result = dispatchBuiltin(e, 'commandPalette', action)
    expect(result).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('TC-WaveC-M16: dispatchBuiltin built-in wins, no conflict', () => {
  it('runs the action without a toast when no plugin command is bound to the same key', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        // Unrelated — bound to a different key.
        'com.foo:cmd': 'Ctrl+Shift+X',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    const action = vi.fn()
    const result = dispatchBuiltin(e, 'commandPalette', action)
    expect(result).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('TC-WaveC-M16: dispatchBuiltin built-in wins, plugin binding shadows it', () => {
  it('fires the toast AND runs the action when a plugin command is bound to the same key', () => {
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:bar': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    const action = vi.fn()
    const result = dispatchBuiltin(e, 'commandPalette', action)
    expect(result).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
    // The toast is invoked once with the localised
    // message and a 3s duration (Wave B / M1: bumped from
    // 1.5s to give the new two-line "title + description"
    // layout room to be read). Wave A / C1: the
    // message is now sourced from i18n (defaulting to
    // zh-CN in the test setup), and the options object
    // carries a stable id so the same conflict doesn't
    // stack a new toast on every keypress.
    expect(toast).toHaveBeenCalledTimes(1)
    const [message, options] = vi.mocked(toast).mock.calls[0] as [
      string,
      { duration: number; id: string; description: string },
    ]
    expect(message).toContain('com.foo')
    expect(message).toContain('内置命令')
    // Wave B / M1: the description names the built-in
    // action that just ran, so the user can tell which
    // side won the keystroke.
    expect(options.description).toContain('commandPalette')
    expect(options.duration).toBe(3000)
    // Stable id is derived from the shortcut key, not the
    // plugin binding, so the same key collision always
    // collapses to one toast.
    expect(options.id).toBe('plugin-conflict-commandPalette')
  })

  it('strips the command id from the binding key (last colon wins)', () => {
    // Reverse-DNS plugin ids commonly contain colons.
    // The settings panel uses `lastIndexOf(':')` to split
    // the binding key, so the toast message should also
    // use the same convention — otherwise the user would
    // see a confusing "com.foo:bar:cmd" id in the toast.
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.foo:bar:cmd': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    const action = vi.fn()
    dispatchBuiltin(e, 'commandPalette', action)
    const [message] = vi.mocked(toast).mock.calls[0] as [string]
    // The id is the part BEFORE the last colon.
    expect(message).toContain('com.foo:bar')
    // The command id is stripped.
    expect(message).not.toContain('cmd')
  })

  it('passes the plugin id to i18n as a substitution variable', () => {
    // Wave A / C1: the toast must be sourced from
    // `i18n.t('settings.pluginCommandShadowed', { id })`,
    // not a hard-coded string. We assert that flipping
    // the active language flips the message — if the
    // original hard-coded Chinese string were still in
    // place, this would not happen.
    //
    // Wave B / M2: the throttle is keyed by binding
    // key, so we re-bind to a *fresh* key between
    // languages to avoid the second dispatch being
    // silently swallowed by the 200ms throttle. The
    // production code only throttles consecutive
    // keydowns of the *same* conflict; the test was
    // previously only viable because there was no
    // throttle.
    useUIStore.setState({
      pluginCommandShortcuts: {
        'com.langcheck:en': 'Ctrl+P',
      },
    })
    const e = fakeKeyEvent('Ctrl+P')
    const action = vi.fn()
    const prevLang = i18n.language
    try {
      i18n.changeLanguage('en')
      dispatchBuiltin(e, 'commandPalette', action)
      const [enMessage] = vi.mocked(toast).mock.calls[0] as [string]
      expect(enMessage).toContain('com.langcheck')
      expect(enMessage).toContain('built-in command')
      vi.mocked(toast).mockClear()
      i18n.changeLanguage('zh-CN')
      // Swap the binding key so the throttle Map doesn't
      // suppress the second toast.
      useUIStore.setState({
        pluginCommandShortcuts: {
          'com.langcheck:zh': 'Ctrl+P',
        },
      })
      dispatchBuiltin(e, 'commandPalette', action)
      const [zhMessage] = vi.mocked(toast).mock.calls[0] as [string]
      expect(zhMessage).toContain('com.langcheck')
      expect(zhMessage).toContain('内置命令')
    } finally {
      i18n.changeLanguage(prevLang)
    }
  })
})
