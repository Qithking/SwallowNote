/**
 * useTheme Hook - Theme management
 */
import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores'

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { h: 221, s: 83, l: 53 }

  let r = parseInt(result[1], 16) / 255
  let g = parseInt(result[2], 16) / 255
  let b = parseInt(result[3], 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return {
    h: Math.round(h * 360 * 10) / 10,
    s: Math.round(s * 100 * 10) / 10,
    l: Math.round(l * 100 * 10) / 10,
  }
}

/**
 * Convert hex color to HSL string format used by Tailwind/shadcn
 * e.g. "#ffffff" → "0 0% 100%"
 */
function hexToHSLString(hex: string): string {
  const { h, s, l } = hexToHSL(hex)
  return `${h} ${s}% ${l}%`
}

/**
 * Build CSS variable overrides for a given mode (dark or light).
 * Returns an object like { '--bg-primary': '#1e1e1e', ... } with only non-empty values.
 */
function buildCssVars(
  isDark: boolean,
  themeColor: string,
  customThemes: { id: string; dark: { themeColor: string; appBg: string; contentBg: string; appBgGradient?: string; contentBgGradient?: string; textColor: string; borderColor: string; tooltipColor: string }; light: { themeColor: string; appBg: string; contentBg: string; appBgGradient?: string; contentBgGradient?: string; textColor: string; borderColor: string; tooltipColor: string } }[],
  activeLightCustomThemeId: string,
  activeDarkCustomThemeId: string,
): Record<string, string> {
  const activeCustomThemeId = isDark ? activeDarkCustomThemeId : activeLightCustomThemeId
  const activeTheme = customThemes.find((t) => t.id === activeCustomThemeId)
  const vars: Record<string, string> = {}
  const add = (name: string, value: string) => { if (value) vars[name] = value }

  if (activeTheme) {
    const colors = isDark ? activeTheme.dark : activeTheme.light
    const { h, s, l } = hexToHSL(colors.themeColor)
    const primaryL = isDark ? Math.min(l + 6, 80) : l
    const hoverL = Math.min(primaryL + 7, 90)
    add('--theme-color', colors.themeColor)
    add('--theme-color-hover', `hsl(${h}, ${s}%, ${hoverL}%)`)
    add('--primary', `${h} ${s}% ${primaryL}%`)
    add('--ring', `${h} ${s}% ${primaryL}%`)
    add('--tab-activeBorderTop', colors.themeColor)
    add('--status-bg', colors.themeColor)
    add('--bg-primary', colors.appBg)
    add('--bg-secondary', colors.contentBg)
    add('--bg-primary-gradient', colors.appBgGradient || '')
    add('--bg-secondary-gradient', colors.contentBgGradient || '')
    add('--text-primary', colors.textColor)
    add('--border-color', colors.borderColor)
    add('--popover', hexToHSLString(colors.tooltipColor))
  } else {
    const { h, s, l } = hexToHSL(themeColor)
    const primaryL = isDark ? Math.min(l + 6, 80) : l
    const hoverL = Math.min(primaryL + 7, 90)
    add('--theme-color', themeColor)
    add('--theme-color-hover', `hsl(${h}, ${s}%, ${hoverL}%)`)
    add('--primary', `${h} ${s}% ${primaryL}%`)
    add('--ring', `${h} ${s}% ${primaryL}%`)
    add('--tab-activeBorderTop', themeColor)
    add('--status-bg', themeColor)
  }
  return vars
}

/** Persist theme preference + both dark/light CSS vars to localStorage for the inline script in index.html */
function persistTheme(theme: string, darkCssVars: Record<string, string>, lightCssVars: Record<string, string>) {
  try {
    localStorage.setItem('sn-theme', JSON.stringify({ theme, darkCssVars, lightCssVars }))
  } catch {}
}

/** Clear custom theme CSS variables so CSS defaults take over */
function clearCustomVars() {
  const root = document.documentElement
  for (const name of ['--bg-primary', '--bg-secondary', '--bg-primary-gradient', '--bg-secondary-gradient', '--text-primary', '--border-color', '--popover']) {
    root.style.setProperty(name, '')
  }
}

export function useTheme() {
  const { theme, themeColor, customThemes, activeLightCustomThemeId, activeDarkCustomThemeId } = useUIStore()

  // Track system dark mode preference so the second useEffect re-runs
  // when system preference changes (needed for theme === 'system')
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // Effect 1: Apply dark class based on theme setting and system preference
  useEffect(() => {
    const root = document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const applyDarkClass = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches)
      root.classList.toggle('dark', isDark)
      setSystemIsDark(isDark)
    }

    applyDarkClass()

    const handleChange = () => {
      if (theme === 'system') {
        applyDarkClass()
      }
    }
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  // Effect 2: Apply custom theme CSS variables and persist to localStorage
  // systemIsDark is a dependency so this re-runs when system preference changes
  useEffect(() => {
    const root = document.documentElement
    const isDark = root.classList.contains('dark')

    const activeCustomThemeId = isDark ? activeDarkCustomThemeId : activeLightCustomThemeId
    const activeTheme = customThemes.find((t) => t.id === activeCustomThemeId)

    if (activeTheme) {
      const colors = isDark ? activeTheme.dark : activeTheme.light
      const { h, s, l } = hexToHSL(colors.themeColor)
      const primaryL = isDark ? Math.min(l + 6, 80) : l
      const hoverL = Math.min(primaryL + 7, 90)

      root.style.setProperty('--theme-color', colors.themeColor)
      root.style.setProperty('--theme-color-hover', `hsl(${h}, ${s}%, ${hoverL}%)`)
      root.style.setProperty('--primary', `${h} ${s}% ${primaryL}%`)
      root.style.setProperty('--ring', `${h} ${s}% ${primaryL}%`)
      root.style.setProperty('--tab-activeBorderTop', colors.themeColor)
      root.style.setProperty('--status-bg', colors.themeColor)
      root.style.setProperty('--bg-primary', colors.appBg)
      root.style.setProperty('--bg-secondary', colors.contentBg)
      root.style.setProperty('--bg-primary-gradient', colors.appBgGradient || '')
      root.style.setProperty('--bg-secondary-gradient', colors.contentBgGradient || '')
      root.style.setProperty('--text-primary', colors.textColor)
      root.style.setProperty('--border-color', colors.borderColor)
      root.style.setProperty('--popover', hexToHSLString(colors.tooltipColor))
    } else {
      const { h, s, l } = hexToHSL(themeColor)
      const primaryL = isDark ? Math.min(l + 6, 80) : l
      const hoverL = Math.min(primaryL + 7, 90)

      root.style.setProperty('--theme-color', themeColor)
      root.style.setProperty('--theme-color-hover', `hsl(${h}, ${s}%, ${hoverL}%)`)
      root.style.setProperty('--primary', `${h} ${s}% ${primaryL}%`)
      root.style.setProperty('--ring', `${h} ${s}% ${primaryL}%`)
      root.style.setProperty('--tab-activeBorderTop', themeColor)
      root.style.setProperty('--status-bg', themeColor)
      clearCustomVars()
    }

    // Cache both dark and light CSS var sets so the inline script picks
    // the right one based on LIVE matchMedia at boot time
    const darkCssVars = buildCssVars(true, themeColor, customThemes, activeLightCustomThemeId, activeDarkCustomThemeId)
    const lightCssVars = buildCssVars(false, themeColor, customThemes, activeLightCustomThemeId, activeDarkCustomThemeId)
    persistTheme(theme, darkCssVars, lightCssVars)
  }, [themeColor, theme, customThemes, activeLightCustomThemeId, activeDarkCustomThemeId, systemIsDark])
}
