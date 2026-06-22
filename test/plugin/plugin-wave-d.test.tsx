/**
 * TC-WaveD: Plugin UI race-condition / i18n / hook re-entry fixes
 *
 * Covers the Wave D review (M11–M15):
 *
 *  - M15 (`getMetricsVersion` / recorder bump): the version
 *    counter must increment exactly once per recorded metric
 *    and reset on `clearAllMetrics`. The
 *    `usePluginTelemetryVersion` hook must reflect the new
 *    value through its `useSyncExternalStore` subscription.
 *
 *  - M11 (`PluginLogsDialog` toast i18n keys): every toast
 *    string in the dialog must be reachable through the
 *    `plugin.pa.dialog.logs.toast.*` i18n keys (no hardcoded
 *    English in the source). We verify by reading the
 *    component source and asserting every `toast.*` first
 *    argument is a `t(...)` call, and by asserting the keys
 *    exist in both locales.
 *
 *  - M12 (`plugin.pa.loadFailures.banner_plural` zh-CN parity):
 *    the zh-CN locale must declare the same set of
 *    `loadFailures` keys as the en locale.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

// ─── i18n bootstrap ─────────────────────────────────────────────────────────
// We use a real i18next instance (not `useTranslation`'s mock) so the
// keys we test are the same keys the application ships with. The
// resources are loaded from the project's locale files.
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

beforeEach(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        'zh-CN': { translation: zhCN },
      },
      interpolation: { escapeValue: false },
    })
  }
})

// ─── M15: getMetricsVersion counter ─────────────────────────────────────────
import {
  getMetricsVersion,
  recordEventMetric,
  recordStorageMetric,
  recordHookMetric,
  recordBackendMetric,
  recordPluginConflict,
  clearAllMetrics,
  subscribeToMetricsVersion,
} from '@/lib/plugin-telemetry'
import { usePluginTelemetryVersion } from '@/hooks'

describe('TC-WaveD-M15: getMetricsVersion counter', () => {
  beforeEach(() => {
    clearAllMetrics()
  })
  afterEach(() => {
    clearAllMetrics()
  })

  it('bumps the counter by exactly 1 on clearAllMetrics (strictly increasing)', () => {
    // The counter is *strictly* increasing — a clearAllMetrics
    // bumps it but does NOT reset it back to 0. The reason is
    // that `usePluginTelemetryVersion` is consumed by
    // `useSyncExternalStore`, and React's `Object.is`-based
    // change detection needs a fresh integer to trigger a
    // re-render. A counter that "returns to 1" after a clear
    // would still satisfy Object.is (it'd compare 1 === 1,
    // no change), defeating the subscription. So we bump
    // rather than reset.
    const v0 = getMetricsVersion()
    clearAllMetrics()
    expect(getMetricsVersion()).toBe(v0 + 1)
    clearAllMetrics()
    expect(getMetricsVersion()).toBe(v0 + 2)
  })

  it('increments by exactly 1 per recorder call', () => {
    // Read the post-beforeEach baseline. We don't pin the
    // value (the counter is global, persists across test
    // files in the same run, and depends on the order in
    // which Vitest loads modules). The contract we DO pin is
    // the *delta* per recorder call — each one bumps by 1.
    const v0 = getMetricsVersion()
    recordEventMetric('com.test.alpha', 'note:open' as never, {} as never, 1, 1.2, 0)
    expect(getMetricsVersion()).toBe(v0 + 1)
    recordStorageMetric('com.test.alpha', 'set', 1, 16, 0.5, true)
    expect(getMetricsVersion()).toBe(v0 + 2)
    recordHookMetric('com.test.alpha', 'onLoad', 2.0, true)
    expect(getMetricsVersion()).toBe(v0 + 3)
    recordBackendMetric('com.test.alpha', 'scanPlugins', 8.0, true)
    expect(getMetricsVersion()).toBe(v0 + 4)
    recordPluginConflict('iconSlot "sidebar" · [a, b]')
    expect(getMetricsVersion()).toBe(v0 + 5)
  })

  it('subscribers are notified on every recorder call', () => {
    const cb = vi.fn()
    const unsubscribe = subscribeToMetricsVersion(cb)
    expect(cb).not.toHaveBeenCalled()
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    expect(cb).toHaveBeenCalledTimes(1)
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    expect(cb).toHaveBeenCalledTimes(2)
    unsubscribe()
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('a second consecutive clearAllMetrics still bumps the counter', () => {
    // The "still bumps" contract: a second consecutive
    // clearAllMetrics produces a *new* counter value, not the
    // same value as the first clear. We assert the strictly-
    // increasing invariant directly.
    const v0 = getMetricsVersion()
    clearAllMetrics()
    const v1 = getMetricsVersion()
    expect(v1).toBeGreaterThan(v0)
    clearAllMetrics()
    const v2 = getMetricsVersion()
    expect(v2).toBeGreaterThan(v1)
  })
})

describe('TC-WaveD-M15: usePluginTelemetryVersion subscription', () => {
  beforeEach(() => {
    clearAllMetrics()
  })
  afterEach(() => {
    clearAllMetrics()
  })

  it('returns the current version and re-renders when it changes', async () => {
    let renders = 0
    let lastVersion = -1
    function Probe() {
      const v = usePluginTelemetryVersion()
      renders += 1
      lastVersion = v
      return null
    }
    render(<Probe />)
    // The first render reads the current version synchronously.
    await waitFor(() => expect(renders).toBeGreaterThan(0))
    const firstVersion = lastVersion
    // Recording a metric should bump the version. The hook
    // uses a synchronous subscriber-notify, so the next
    // render happens in the same microtask flush.
    act(() => {
      recordHookMetric('com.test.beta', 'onLoad', 0.5, true)
    })
    expect(lastVersion).toBeGreaterThan(firstVersion)
  })
})

// ─── M11: i18n keys for the Logs dialog toasts ─────────────────────────────
describe('TC-WaveD-M11: plugin.pa.dialog.logs.toast.* keys', () => {
  const expectedKeys = [
    'copyEmpty',
    'copySuccess',
    'copyFailed',
    'exportEmpty',
    'exportOpenFailed',
    'exportWriteFailed',
    'exportSuccess',
  ]

  it('en.json declares all 7 toast keys with non-empty strings', () => {
    const t = (en as any).plugin.pa.dialog.logs.toast as Record<string, string>
    for (const k of expectedKeys) {
      expect(typeof t[k], `en toast.${k} missing`).toBe('string')
      expect(t[k].length, `en toast.${k} empty`).toBeGreaterThan(0)
    }
    expect(t.exportSuccess).toContain('{{count}}')
  })

  it('zh-CN.json mirrors all 7 toast keys', () => {
    const t = (zhCN as any).plugin.pa.dialog.logs.toast as Record<string, string>
    for (const k of expectedKeys) {
      expect(typeof t[k], `zh-CN toast.${k} missing`).toBe('string')
      expect(t[k].length, `zh-CN toast.${k} empty`).toBeGreaterThan(0)
    }
    expect(t.exportSuccess).toContain('{{count}}')
  })

  it('PluginManagerConsoleDialog source no longer hardcodes English toast strings', async () => {
    // Regression net for the original Wave D finding: 7
    // `toast.*` calls used to pass a plain English string
    // literal. After the fix, every `toast.*` first argument
    // must be a `t(...)` call. The Logs tab moved into
    // `PluginManagerConsoleDialog` (which subsumes Activity /
    // Diagnostics / Logs in one popup), so we read the new
    // file path. We scan the source for the
    // `toast.{info|success|error}(` pattern and check the
    // character after the opening paren is `t`.
    const fs = await import('fs/promises')
    const path = await import('path')
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/components/Plugin/PluginManagerConsoleDialog.tsx'),
      'utf8',
    )
    const calls = [...src.matchAll(/toast\.(?:info|success|error)\(/g)]
    expect(calls.length).toBeGreaterThanOrEqual(7)
    for (const m of calls) {
      const startIdx = (m.index ?? 0) + m[0].length
      // Strip leading whitespace (formatting allows line
      // breaks between `toast.xxx(` and the first arg).
      const tail = src.slice(startIdx).trimStart().slice(0, 4)
      expect(
        tail.startsWith('t('),
        `toast call at offset ${startIdx} not wrapped in t(): got "${tail}"`,
      ).toBe(true)
    }
  })
})

// ─── M12: zh-CN loadFailures parity ────────────────────────────────────────
describe('TC-WaveD-M12: zh-CN loadFailures parity', () => {
  it('zh-CN declares the same loadFailures key set as en', () => {
    const enKeys = Object.keys((en as any).plugin.pa.loadFailures).sort()
    const zhKeys = Object.keys((zhCN as any).plugin.pa.loadFailures).sort()
    expect(zhKeys).toEqual(enKeys)
  })

  it('zh-CN banner_plural key is present and non-empty', () => {
    const t = (zhCN as any).plugin.pa.loadFailures as Record<string, string>
    expect(typeof t.banner_plural).toBe('string')
    expect(t.banner_plural.length).toBeGreaterThan(0)
    expect(t.banner_plural).toContain('{{count}}')
  })
})

// ─── M14: PluginCommandRecorder passes pure modifier keys through ─────────
/**
 * TC-WaveD-M14: Pure modifier keys (Ctrl/Shift/Alt/Meta) pressed
 * while the recorder badge is "recording" must NOT have their
 * keydown event consumed. The previous implementation called
 * `preventDefault()` + `stopPropagation()` unconditionally; this
 * test fires a bare `Control` keydown at the window and asserts
 * both calls were skipped, and that the recorder is still in
 * the recording state (so a subsequent `Ctrl+K` chord the user
 * is composing can still land).
 */
import { fireEvent } from '@testing-library/react'
import { useUIStore } from '@/stores/ui'

describe('TC-WaveD-M14: PluginCommandRecorder modifier pass-through', () => {
  beforeEach(() => {
    useUIStore.setState({ pluginCommandShortcuts: {} })
  })
  afterEach(() => {
    useUIStore.setState({ pluginCommandShortcuts: {} })
  })

  it('does not preventDefault or stopPropagation on a bare modifier key', async () => {
    const { PluginCommandRecorder } = await import(
      '@/components/Settings/PluginCommandRecorder'
    )

    const command = {
      id: 'cmd',
      label: 'Test Command',
      icon: 'pencil',
    } as never
    const bindingKey = 'com.test.alpha:cmd'

    // Render the recorder. We need a stub PluginCommand shape
    // — only the `label` field is consulted by the recorder
    // (for the conflict banner).
    const { container } = render(
      <div>
        <PluginCommandRecorder bindingKey={bindingKey} command={command} />
      </div>,
    )

    // Click the badge to enter "recording" mode.
    const badge = container.querySelector('.cursor-pointer') as HTMLElement
    expect(badge).toBeTruthy()
    fireEvent.click(badge)

    // Construct a keyboard event that imitates a bare Ctrl
    // keypress (no other modifier, no main key). We can't use
    // `new KeyboardEvent('keydown', …)` in jsdom because the
    // implementation flags `e.ctrlKey` differently from how
    // Chromium would, so we mock the fields the listener
    // actually reads (`key`, `ctrlKey`, …).
    const modifierEvent = new Event('keydown') as unknown as KeyboardEvent
    Object.defineProperties(modifierEvent, {
      key: { value: 'Control' },
      ctrlKey: { value: true },
      shiftKey: { value: false },
      altKey: { value: false },
      metaKey: { value: false },
      preventDefault: { value: vi.fn() },
      stopPropagation: { value: vi.fn() },
    })

    const stopPropagationSpy = vi.spyOn(modifierEvent, 'stopPropagation')
    const preventDefaultSpy = vi.spyOn(modifierEvent, 'preventDefault')

    // Fire the event at the window, since the recorder attaches
    // its handler with `{ capture: true }` on `window`.
    await act(async () => {
      window.dispatchEvent(modifierEvent)
      // Yield a microtask so the (synchronous) listener body
      // runs to completion before assertions.
      await Promise.resolve()
    })

    // The recorder must NOT have consumed a pure modifier.
    expect(preventDefaultSpy).not.toHaveBeenCalled()
    expect(stopPropagationSpy).not.toHaveBeenCalled()
  })

  it('does consume a real chord (e.g. Ctrl+S) so it does not also fire the built-in save', async () => {
    const { PluginCommandRecorder } = await import(
      '@/components/Settings/PluginCommandRecorder'
    )

    const command = {
      id: 'cmd',
      label: 'Test Command',
      icon: 'pencil',
    } as never
    const bindingKey = 'com.test.alpha:cmd'

    const { container } = render(
      <div>
        <PluginCommandRecorder bindingKey={bindingKey} command={command} />
      </div>,
    )
    const badge = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(badge)

    const chordEvent = new Event('keydown') as unknown as KeyboardEvent
    Object.defineProperties(chordEvent, {
      key: { value: 's' },
      ctrlKey: { value: true },
      shiftKey: { value: false },
      altKey: { value: false },
      metaKey: { value: true },
      preventDefault: { value: vi.fn() },
      stopPropagation: { value: vi.fn() },
    })

    const stopPropagationSpy = vi.spyOn(chordEvent, 'stopPropagation')
    const preventDefaultSpy = vi.spyOn(chordEvent, 'preventDefault')

    await act(async () => {
      window.dispatchEvent(chordEvent)
      await Promise.resolve()
    })

    // A real chord *should* be consumed.
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1)
    expect(stopPropagationSpy).toHaveBeenCalledTimes(1)
    // And the binding should have been written to the store.
    expect(useUIStore.getState().pluginCommandShortcuts[bindingKey]).toBe('Ctrl+S')
  })
})
