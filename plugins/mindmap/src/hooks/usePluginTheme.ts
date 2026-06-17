/**
 * Theme resolution for the plugin.
 *
 * The plugin needs to know whether the host is in `dark`,
 * `light`, or `system` mode so the simple-mind-map canvas can
 * match the surrounding UI. When a `panel` is provided the
 * hook subscribes to the host's `theme:change` event; without
 * a panel it falls back to `prefers-color-scheme` and stays
 * responsive to OS-level dark/light toggles via a media-query
 * listener.
 */
import { useEffect, useState } from 'react'
import type { PluginPanelProps, PluginEventHandler } from '@swallow-note/plugin-sdk'

export type EffectiveTheme = 'dark' | 'light'

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveEffective(theme: string | undefined): EffectiveTheme {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  // 'system' (or anything unrecognised) follows the OS.
  return systemPrefersDark() ? 'dark' : 'light'
}

let currentTheme = 'system'
const themeListeners = new Set<(t: string) => void>()

export function getCurrentTheme(): string {
  return currentTheme
}

/**
 * Subscribe to `theme:change`. Idempotent — call from any number
 * of panels, the cleanup function unregisters exactly the
 * listener registered by this call.
 */
export function subscribeToTheme(panel: PluginPanelProps): () => void {
  const handler: PluginEventHandler<'theme:change'> = (payload) => {
    if (payload.theme !== currentTheme) {
      currentTheme = payload.theme
      for (const l of themeListeners) l(payload.theme)
    }
  }
  return panel.events.on('theme:change', handler)
}

/**
 * React hook returning `{ theme, isDark }`. `theme` is the raw
 * value from the host (`light`/`dark`/`system`) and `isDark` is
 * the resolved dark/light state, accounting for system
 * preference and live media-query changes.
 *
 * The `panel` argument is optional. When omitted the hook
 * follows `prefers-color-scheme` only; this is the path used
 * by the `editorComponent` (which doesn't receive a `panel`).
 */
export function usePluginTheme(panel?: PluginPanelProps): { theme: string; isDark: boolean } {
  const [theme, setTheme] = useState<string>(currentTheme)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark())

  useEffect(() => {
    if (!panel) return
    return subscribeToTheme(panel)
  }, [panel])

  useEffect(() => {
    const l = (t: string) => setTheme(t)
    themeListeners.add(l)
    return () => {
      themeListeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // When the host hasn't pushed a theme (`currentTheme === 'system'`),
  // use the live media-query value. Otherwise trust the host's
  // explicit choice.
  const isDark =
    theme === 'light' ? false : theme === 'dark' ? true : systemDark
  return { theme, isDark }
}

/**
 * Test-only helper to push a theme without going through the
 * host bus. Plugin code does not need to call this.
 */
export function setThemeForTesting(theme: string): void {
  currentTheme = theme
  for (const l of themeListeners) l(theme)
}
