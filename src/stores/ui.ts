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

export interface CustomThemeColors {
  themeColor: string
  appBg: string
  contentBg: string
  textColor: string
  borderColor: string
  tooltipColor: string
}

export interface CustomTheme {
  id: string
  name: string
  isBuiltIn: boolean
  light: CustomThemeColors
  dark: CustomThemeColors
}

export const BUILT_IN_THEMES: CustomTheme[] = [
  {
    id: 'builtin-light',
    name: '浅色主题',
    isBuiltIn: true,
    light: {
      themeColor: '#005fb8',
      appBg: '#EDEFF2',
      contentBg: '#ffffff',
      textColor: '#1f1f1f',
      borderColor: '#e5e5e5',
      tooltipColor: '#ffffff',
    },
    dark: {
      themeColor: '#005fb8',
      appBg: '#EDEFF2',
      contentBg: '#ffffff',
      textColor: '#1f1f1f',
      borderColor: '#e5e5e5',
      tooltipColor: '#ffffff',
    },
  },
  {
    id: 'builtin-dark',
    name: '深色主题',
    isBuiltIn: true,
    light: {
      themeColor: '#0078d4',
      appBg: '#1e1e1e',
      contentBg: '#252526',
      textColor: '#ffffff',
      borderColor: '#454545',
      tooltipColor: '#1e1e1e',
    },
    dark: {
      themeColor: '#0078d4',
      appBg: '#1e1e1e',
      contentBg: '#252526',
      textColor: '#ffffff',
      borderColor: '#454545',
      tooltipColor: '#1e1e1e',
    },
  },
]

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
  customThemes: CustomTheme[]
  activeLightCustomThemeId: string
  activeDarkCustomThemeId: string
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
  setActiveCustomThemeId: (themeType: 'light' | 'dark', id: string) => void
  addCustomTheme: (name: string, themeType: 'light' | 'dark') => void
  deleteCustomTheme: (id: string) => void
  renameCustomTheme: (id: string, name: string) => void
  updateCustomThemeColor: (id: string, themeType: 'light' | 'dark', key: keyof CustomThemeColors, value: string) => void
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
  customThemes: [...BUILT_IN_THEMES],
  activeLightCustomThemeId: 'builtin-light',
  activeDarkCustomThemeId: 'builtin-dark',
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
  setActiveCustomThemeId: (themeType, id) => {
    if (themeType === 'light') {
      set({ activeLightCustomThemeId: id })
      saveAppSettings({ activeLightCustomThemeId: id })
    } else {
      set({ activeDarkCustomThemeId: id })
      saveAppSettings({ activeDarkCustomThemeId: id })
    }
  },
  addCustomTheme: (name, themeType) => {
    const id = 'custom-' + Date.now()
    const newTheme: CustomTheme = {
      id,
      name,
      isBuiltIn: false,
      light: { ...BUILT_IN_THEMES[0].light },
      dark: { ...BUILT_IN_THEMES[1].dark },
    }
    if (themeType === 'light') {
      set((state) => ({ customThemes: [...state.customThemes, newTheme], activeLightCustomThemeId: id }))
    } else {
      set((state) => ({ customThemes: [...state.customThemes, newTheme], activeDarkCustomThemeId: id }))
    }
    const updated = [...useUIStore.getState().customThemes]
    saveAppSettings({ customThemes: JSON.stringify(updated), ...(themeType === 'light' ? { activeLightCustomThemeId: id } : { activeDarkCustomThemeId: id }) })
  },
  deleteCustomTheme: (id) => {
    const theme = useUIStore.getState().customThemes.find((t) => t.id === id)
    if (!theme || theme.isBuiltIn) return
    set((state) => {
      const next = state.customThemes.filter((t) => t.id !== id)
      const lightId = state.activeLightCustomThemeId === id ? 'builtin-light' : state.activeLightCustomThemeId
      const darkId = state.activeDarkCustomThemeId === id ? 'builtin-dark' : state.activeDarkCustomThemeId
      return { customThemes: next, activeLightCustomThemeId: lightId, activeDarkCustomThemeId: darkId }
    })
    const s = useUIStore.getState()
    saveAppSettings({
      customThemes: JSON.stringify(s.customThemes),
      activeLightCustomThemeId: s.activeLightCustomThemeId,
      activeDarkCustomThemeId: s.activeDarkCustomThemeId,
    })
  },
  renameCustomTheme: (id, name) => {
    const theme = useUIStore.getState().customThemes.find((t) => t.id === id)
    if (!theme || theme.isBuiltIn || !name.trim()) return
    set((state) => ({
      customThemes: state.customThemes.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)),
    }))
    saveAppSettings({ customThemes: JSON.stringify(useUIStore.getState().customThemes) })
  },
  updateCustomThemeColor: (id, themeType, key, value) => {
    const theme = useUIStore.getState().customThemes.find((t) => t.id === id)
    if (!theme || theme.isBuiltIn) return
    set((state) => ({
      customThemes: state.customThemes.map((t) => {
        if (t.id !== id) return t
        return { ...t, [themeType]: { ...t[themeType], [key]: value } }
      }),
    }))
    saveAppSettings({ customThemes: JSON.stringify(useUIStore.getState().customThemes) })
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
      let customThemes: CustomTheme[] = [...BUILT_IN_THEMES]
      if (s.customThemes) {
        try {
          const parsed = JSON.parse(s.customThemes) as CustomTheme[]
          const userThemes = parsed.filter((t) => !t.isBuiltIn)
          customThemes = [...BUILT_IN_THEMES, ...userThemes]
        } catch {}
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
        customThemes,
        activeLightCustomThemeId: s.activeLightCustomThemeId || 'builtin-light',
        activeDarkCustomThemeId: s.activeDarkCustomThemeId || 'builtin-dark',
      })
    } catch {
      // DB not ready, use defaults
    }
  },
}))
