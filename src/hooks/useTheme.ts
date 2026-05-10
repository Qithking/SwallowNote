/**
 * useTheme Hook - Theme management
 */
import { useEffect } from 'react'
import { useUIStore } from '@/stores'

export function useTheme() {
  const { theme } = useUIStore()

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
}
