/**
 * useTheme Hook - Theme management
 */
import { useEffect } from 'react'
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

export function useTheme() {
  const { theme, themeColor } = useUIStore()

  useEffect(() => {
    const root = document.documentElement
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      if (theme === 'system') {
        root.classList.toggle('dark', systemPrefersDark.matches)
      } else {
        root.classList.toggle('dark', theme === 'dark')
      }
    }

    applyTheme()

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme()
      }
    }
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    const { h, s, l } = hexToHSL(themeColor)

    const primaryL = isDark ? Math.min(l + 6, 80) : l
    const hoverL = Math.min(primaryL + 7, 90)

    root.style.setProperty('--theme-color', themeColor)
    root.style.setProperty('--theme-color-hover', `hsl(${h}, ${s}%, ${hoverL}%)`)
    root.style.setProperty('--primary', `${h} ${s}% ${primaryL}%`)
    root.style.setProperty('--ring', `${h} ${s}% ${primaryL}%`)
    root.style.setProperty('--tab-activeBorderTop', themeColor)
    root.style.setProperty('--status-bg', themeColor)
  }, [themeColor, theme])
}
