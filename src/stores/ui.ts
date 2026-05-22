/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { getLatestFolder, getAppSettings, saveAppSettings, setAutoStartEnabled } from '@/lib/tauri'
import { ShortcutKey } from '@/lib/shortcuts'
import { useFileTreeStore } from './filetree'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'git' | 'ai' | 'settings'
export type EditorViewMode = 'edit' | 'preview' | 'split'
export type RightPanelType = 'ai' | 'directory' | 'history' | 'editorSettings' | null
export type WorkspaceMode = 'folder' | 'workspace'
export type NoteWidth = 'normal' | 'wide'

export interface UIState {
  theme: Theme
  themeColor: string
  sidebarView: SidebarView
  sidebarVisible: boolean
  sidebarWidth: number
  rightPanelWidth: number
  statusBarVisible: boolean
  editorViewMode: EditorViewMode
  commandPaletteVisible: boolean
  searchPanelVisible: boolean
  settingsPanelVisible: boolean
  aiPanelVisible: boolean
  rightPanelType: RightPanelType
  clipboardFiles: string[]
  clipboardIsCut: boolean
  workspaceMode: WorkspaceMode
  autoStart: boolean
  closeWithoutExit: boolean
  noteWidth: NoteWidth
  showAllFiles: boolean
  markdownOnly: boolean
  customShortcuts: Record<string, string>
  syncInterval: number
  setTheme: (theme: Theme) => void
  setThemeColor: (color: string) => void
  setSidebarView: (view: SidebarView) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  toggleStatusBar: () => void
  setEditorViewMode: (mode: EditorViewMode) => void
  toggleCommandPalette: () => void
  toggleSearchPanel: () => void
  setSettingsPanelVisible: (visible: boolean) => void
  toggleSettingsPanel: () => void
  toggleAIPanel: () => void
  setRightPanelType: (type: RightPanelType) => void
  setRightPanelWidth: (width: number) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  setClipboardFiles: (files: string[], isCut: boolean) => void
  clearClipboard: () => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  initWorkspaceMode: () => Promise<void>
  setAutoStart: (value: boolean) => void
  setCloseWithoutExit: (value: boolean) => void
  setNoteWidth: (width: NoteWidth) => void
  setShowAllFiles: (value: boolean) => void
  setMarkdownOnly: (value: boolean) => void
  setSyncInterval: (interval: number) => void
  setShortcut: (key: ShortcutKey, value: string) => void
  resetShortcut: (key: ShortcutKey) => void
  resetAllShortcuts: () => void
  loadSettings: () => Promise<void>
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'light',
  themeColor: '#005fb8',
  sidebarView: 'explorer',
  sidebarVisible: true,
  sidebarWidth: 240,
  rightPanelWidth: 288,
  statusBarVisible: true,
  editorViewMode: 'split',
  commandPaletteVisible: false,
  searchPanelVisible: false,
  settingsPanelVisible: false,
  aiPanelVisible: false,
  rightPanelType: null,
  clipboardFiles: [],
  clipboardIsCut: false,
  workspaceMode: 'folder',
  autoStart: false,
  closeWithoutExit: false,
  noteWidth: 'normal',
  showAllFiles: false,
  markdownOnly: false,
  customShortcuts: {},
  syncInterval: 10,
  setTheme: (theme) => {
    set({ theme })
    saveAppSettings({ theme })
  },
  setThemeColor: (color) => {
    set({ themeColor: color })
    saveAppSettings({ themeColor: color })
  },
  setSidebarView: (view) => set({ sidebarView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(150, Math.min(500, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(150, Math.min(600, width)) }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
  setEditorViewMode: (mode) => set({ editorViewMode: mode }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteVisible: !state.commandPaletteVisible })),
  toggleSearchPanel: () =>
    set((state) => ({ searchPanelVisible: !state.searchPanelVisible })),
  setSettingsPanelVisible: (visible) => set({ settingsPanelVisible: visible }),
  toggleSettingsPanel: () =>
    set((state) => ({ settingsPanelVisible: !state.settingsPanelVisible })),
  toggleAIPanel: () =>
    set((state) => ({ aiPanelVisible: !state.aiPanelVisible })),
  setRightPanelType: (type) => set({ rightPanelType: type }),
  showToast: (message, type = 'info') => {
    switch (type) {
      case 'success':
        toast.success(message, { duration: 3000 })
        break
      case 'error':
        toast.error(message, { duration: 8000 })
        break
      default:
        toast(message, { duration: 3000 })
        break
    }
  },
  setClipboardFiles: (files, isCut) => set({ clipboardFiles: files, clipboardIsCut: isCut }),
  clearClipboard: () => set({ clipboardFiles: [], clipboardIsCut: false }),
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  initWorkspaceMode: async () => {
    try {
      const latestPath = await getLatestFolder()
      if (latestPath && latestPath.endsWith('.swallow-workspace')) {
        set({ workspaceMode: 'workspace' })
      } else {
        set({ workspaceMode: 'folder' })
      }
    } catch {
      set({ workspaceMode: 'folder' })
    }
  },
  setAutoStart: (value) => {
    set({ autoStart: value })
    saveAppSettings({ autoStart: String(value) })
    setAutoStartEnabled(value).catch(() => {})
  },
  setCloseWithoutExit: (value) => {
    set({ closeWithoutExit: value })
    saveAppSettings({ closeWithoutExit: String(value) })
  },
  setNoteWidth: (width) => {
    set({ noteWidth: width })
    saveAppSettings({ noteWidth: width })
  },
  setShowAllFiles: (value) => {
    set({ showAllFiles: value })
    saveAppSettings({ showAllFiles: String(value) })
    useFileTreeStore.getState().refreshExpanded()
  },
  setMarkdownOnly: (value) => {
    set({ markdownOnly: value })
    saveAppSettings({ markdownOnly: String(value) })
    useFileTreeStore.getState().refreshExpanded()
  },
  setSyncInterval: (interval: number) => {
    set({ syncInterval: interval })
    saveAppSettings({ syncInterval: String(interval) })
  },
  setShortcut: (key, value) => {
    set((state) => ({
      customShortcuts: { ...state.customShortcuts, [key]: value },
    }))
    const updated = { ...useUIStore.getState().customShortcuts, [key]: value }
    saveAppSettings({ customShortcuts: JSON.stringify(updated) })
  },
  resetShortcut: (key) => {
    set((state) => {
      const next = { ...state.customShortcuts }
      delete next[key]
      return { customShortcuts: next }
    })
    const updated = { ...useUIStore.getState().customShortcuts }
    delete updated[key]
    saveAppSettings({ customShortcuts: JSON.stringify(updated) })
  },
  resetAllShortcuts: () => {
    set({ customShortcuts: {} })
    saveAppSettings({ customShortcuts: '{}' })
  },
  loadSettings: async () => {
    try {
      const s = await getAppSettings()
      let customShortcuts: Record<string, string> = {}
      if (s.customShortcuts) {
        try {
          customShortcuts = JSON.parse(s.customShortcuts)
        } catch {
          customShortcuts = {}
        }
      }
      set({
        theme: s.theme as Theme,
        themeColor: s.themeColor,
        autoStart: s.autoStart === 'true',
        closeWithoutExit: s.closeWithoutExit === 'true',
        noteWidth: s.noteWidth as NoteWidth,
        showAllFiles: s.showAllFiles === 'true',
        markdownOnly: s.markdownOnly === 'true',
        customShortcuts,
        syncInterval: s.syncInterval ? Number(s.syncInterval) : 10,
      })
    } catch {
      // DB not ready, use defaults
    }
  },
}))
