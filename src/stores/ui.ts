/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'git' | 'ai' | 'settings'
export type EditorViewMode = 'edit' | 'preview' | 'split'

export interface UIState {
  theme: Theme
  sidebarView: SidebarView
  sidebarVisible: boolean
  statusBarVisible: boolean
  editorViewMode: EditorViewMode
  commandPaletteVisible: boolean
  searchPanelVisible: boolean
  setTheme: (theme: Theme) => void
  setSidebarView: (view: SidebarView) => void
  toggleSidebar: () => void
  toggleStatusBar: () => void
  setEditorViewMode: (mode: EditorViewMode) => void
  toggleCommandPalette: () => void
  toggleSearchPanel: () => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  sidebarView: 'explorer',
  sidebarVisible: true,
  statusBarVisible: true,
  editorViewMode: 'split',
  commandPaletteVisible: false,
  searchPanelVisible: false,
  setTheme: (theme) => set({ theme }),
  setSidebarView: (view) => set({ sidebarView: view }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
  setEditorViewMode: (mode) => set({ editorViewMode: mode }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteVisible: !state.commandPaletteVisible })),
  toggleSearchPanel: () =>
    set((state) => ({ searchPanelVisible: !state.searchPanelVisible })),
}))
