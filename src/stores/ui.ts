/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { getLatestFolder } from '@/lib/tauri'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'git' | 'ai' | 'settings'
export type EditorViewMode = 'edit' | 'preview' | 'split'
export type RightPanelType = 'ai' | 'directory' | 'history' | 'editorSettings' | null
export type WorkspaceMode = 'folder' | 'workspace'

export interface UIState {
  theme: Theme
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
  setTheme: (theme: Theme) => void
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
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
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
  setTheme: (theme) => set({ theme }),
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
}))
