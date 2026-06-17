/**
 * Plugin-local translation.
 *
 * Locale state is module-scope. The optional `useTWithBus(panel)`
 * hook subscribes to the host's `locale:change` event so the UI
 * re-renders when the user switches language; without that hook
 * the plugin stays on its default locale (`zh-CN`).
 *
 * The plugin does not bundle `react-i18next`. Standalone previews
 * (`npm run dev`) drive translations via `setLocaleForTesting`.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { PluginPanelProps, PluginEventHandler } from '@swallow-note/plugin-sdk'
import { translate, type Locale } from './translations'

/**
 * Module-scope locale. Set by `subscribeToLocale` and read by
 * `useT`. Using a module variable (not React state) means the
 * `t()` function in event handlers / module bodies always sees
 * the current locale without an extra render.
 */
let currentLocale: Locale = 'zh-CN'
const localeListeners = new Set<(loc: Locale) => void>()

export function getCurrentLocale(): Locale {
  return currentLocale
}

/**
 * Subscribe to the host's `locale:change` event. The handler
 * stores the latest locale and notifies any in-process listeners
 * so React components can re-render.
 *
 * The `panel` parameter is required so the host can attach the
 * permission tag; the actual event name is part of the SDK's
 * `PluginEvent` union.
 */
export function subscribeToLocale(panel: PluginPanelProps): () => void {
  const handler: PluginEventHandler<'locale:change'> = (payload) => {
    const next = (payload.locale === 'en' ? 'en' : 'zh-CN') as Locale
    if (next !== currentLocale) {
      currentLocale = next
      for (const l of localeListeners) l(next)
    }
  }
  return panel.events.on('locale:change', handler)
}

function localeSnapshot(): Locale {
  return currentLocale
}

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener)
  return () => {
    localeListeners.delete(listener)
  }
}

/**
 * Return a `t(key)` function bound to the current locale.
 * `key` uses dot-separated paths (e.g. `mindMap.toolbar.layout`)
 * that mirror the host's translation namespace. Missing keys
 * fall back to zh-CN, then to the key itself, so the UI never
 * crashes.
 *
 * The hook re-renders whenever the module-scope locale changes
 * (i.e. when `subscribeToLocale` fires). Components that mount
 * without a panel — like `MindMapEditorView` — simply stay on
 * the default locale.
 */
export function useT(): (key: string) => string {
  const locale = useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot)
  // Track the locale as state too so callers re-render on change.
  // (useSyncExternalStore covers re-renders already, but using
  // useState keeps the dependency surface in this file obvious.)
  const [, setTick] = useState(0)
  useEffect(() => {
    const l = () => setTick((n) => n + 1)
    localeListeners.add(l)
    return () => {
      localeListeners.delete(l)
    }
  }, [])
  return useCallback((key: string) => translate(locale, key), [locale])
}

/**
 * Variant of `useT` that also subscribes to the host's locale
 * bus on mount, ensuring the hook returns the right strings even
 * if the user changes language while the panel is open. The
 * returned cleanup function should not be called by the consumer;
 * it is for internal use.
 *
 * The optional `panel` is for the host bridge: when provided, the
 * subscription goes through the host's permission-checked bus.
 * When omitted, the hook works as `useT()` (no live updates).
 */
export function useTWithBus(panel?: PluginPanelProps): (key: string) => string {
  useEffect(() => {
    if (!panel) return
    return subscribeToLocale(panel)
  }, [panel])
  return useT()
}

/**
 * Manual setter for tests / standalone previews that want to
 * flip locale without going through the host bus. Plugin code
 * does not need to call this.
 */
export function setLocaleForTesting(loc: Locale): void {
  currentLocale = loc
  for (const l of localeListeners) l(loc)
}
