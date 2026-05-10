/**
 * useKeyboardShortcuts Hook - Global keyboard shortcuts
 */
import { useEffect } from 'react'
import { useUIStore, useEditorStore } from '@/stores'

export function useKeyboardShortcuts() {
  const {
    toggleCommandPalette,
    toggleSearchPanel,
    toggleSidebar,
    setSidebarView,
  } = useUIStore()
  const { tabs, activeTabId, removeTab } = useEditorStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey

      // Ctrl/Cmd + P: Command Palette
      if (isMod && e.key === 'p' && !e.shiftKey) {
        e.preventDefault()
        toggleCommandPalette()
      }

      // Ctrl/Cmd + Shift + F: Global Search
      if (isMod && e.key === 'F') {
        e.preventDefault()
        toggleSearchPanel()
      }

      // Ctrl/Cmd + B: Toggle Sidebar
      if (isMod && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Ctrl/Cmd + W: Close Tab
      if (isMod && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          removeTab(activeTabId)
        }
      }

      // Ctrl/Cmd + 1-9: Switch to tab 1-9
      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabs[index]) {
          useEditorStore.getState().setActiveTab(tabs[index].id)
        }
      }

      // Escape: Close overlays
      if (e.key === 'Escape') {
        const { commandPaletteVisible, searchPanelVisible } = useUIStore.getState()
        if (commandPaletteVisible) {
          toggleCommandPalette()
        } else if (searchPanelVisible) {
          toggleSearchPanel()
        }
      }

      // Ctrl/Cmd + ,: Settings
      if (isMod && e.key === ',') {
        e.preventDefault()
        setSidebarView('settings')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    toggleCommandPalette,
    toggleSearchPanel,
    toggleSidebar,
    setSidebarView,
    tabs,
    activeTabId,
    removeTab,
  ])
}
