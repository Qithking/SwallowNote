/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { getLatestFolder, getAppSettings, saveAppSettings, setAutoStartEnabled, encryptApiKey, decryptApiKey, restartAiProxy, getBuiltinAiModels } from '@/lib/tauri'
import { ShortcutKey } from '@/lib/shortcuts'
import { AiModelConfig, generateModelId } from '@/lib/ai'
import { useFileTreeStore } from './filetree'
import { emitSettingChanged, emitThemeChanged } from '@/lib/plugin-host'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'git' | 'ai' | 'settings' | `plugin:${string}`
export type EditorViewMode = 'edit' | 'preview' | 'split'
export type RightPanelType = 'ai' | 'directory' | 'history' | 'editorSettings' | `plugin:${string}` | null
/**
 * Section IDs inside the Settings panel. Mirrors the
 * `SettingsSection` type in `Settings/SettingsView.tsx`.
 * `null` means "no specific section requested" (default first paint).
 */
export type SettingsSection = 'general' | 'sync' | 'appearance' | 'ai' | 'shortcuts' | 'plugins' | null

/** Request from editor context menu to trigger an AI action */
export interface AiContextMenuRequest {
  /** Unique ID for this request (timestamp-based) to prevent duplicate processing */
  id: string
  /** The AI role key (e.g. 'continue_writing', 'polish') */
  roleKey: string
  /** The role display name */
  roleName: string
  /** Whether the user had selected text in the editor */
  hasSelection: boolean
  /** The selected text content (if hasSelection) or full file content */
  content: string
  /** For selected content: the line range [startLine, endLine] (1-based) */
  lineRange?: [number, number]
  /** The file path relative to rootPath */
  filePath: string
}
export type WorkspaceMode = 'folder' | 'workspace'
export type NoteWidth = 'normal' | 'wide'

export interface CustomThemeColors {
  themeColor: string
  appBg: string
  appBgGradient?: string
  contentBg: string
  contentBgGradient?: string
  textColor: string
  borderColor: string
  tooltipColor: string
}

export interface CustomTheme {
  id: string
  name: string
  isBuiltIn: boolean
  themeType: 'light' | 'dark'
  light: CustomThemeColors
  dark: CustomThemeColors
}

export const BUILT_IN_THEMES: CustomTheme[] = [
  {
    id: 'builtin-light',
    name: '浅色主题',
    isBuiltIn: true,
    themeType: 'light',
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
    themeType: 'dark',
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
  {
    id: 'builtin-warm-sand',
    name: '暖沙',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#b87333',
      appBg: '#e8dfd2',
      contentBg: '#fefdfb',
      textColor: '#3d3225',
      borderColor: '#d5c9b8',
      tooltipColor: '#fefdfb',
    },
    dark: {
      themeColor: '#b87333',
      appBg: '#e8dfd2',
      contentBg: '#fefdfb',
      textColor: '#3d3225',
      borderColor: '#d5c9b8',
      tooltipColor: '#fefdfb',
    },
  },
  {
    id: 'builtin-sage-meadow',
    name: '鼠尾草',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#4a7c59',
      appBg: '#dde5df',
      contentBg: '#fbfdfb',
      textColor: '#2c3e31',
      borderColor: '#bfcfc4',
      tooltipColor: '#fbfdfb',
    },
    dark: {
      themeColor: '#4a7c59',
      appBg: '#dde5df',
      contentBg: '#fbfdfb',
      textColor: '#2c3e31',
      borderColor: '#bfcfc4',
      tooltipColor: '#fbfdfb',
    },
  },
  {
    id: 'builtin-midnight-ink',
    name: '墨夜',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#6c8ebf',
      appBg: '#1a1b2e',
      contentBg: '#222338',
      textColor: '#d4d8e8',
      borderColor: '#3a3b52',
      tooltipColor: '#222338',
    },
    dark: {
      themeColor: '#6c8ebf',
      appBg: '#1a1b2e',
      contentBg: '#222338',
      textColor: '#d4d8e8',
      borderColor: '#3a3b52',
      tooltipColor: '#222338',
    },
  },
  {
    id: 'builtin-ember-glow',
    name: '余烬',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#e8654a',
      appBg: '#1e1a19',
      contentBg: '#2a2523',
      textColor: '#e8ddd8',
      borderColor: '#4a3f3b',
      tooltipColor: '#2a2523',
    },
    dark: {
      themeColor: '#e8654a',
      appBg: '#1e1a19',
      contentBg: '#2a2523',
      textColor: '#e8ddd8',
      borderColor: '#4a3f3b',
      tooltipColor: '#2a2523',
    },
  },
  {
    id: 'builtin-dawn',
    name: '晨曦',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#c96b5e',
      appBg: '#f0e6df',
      appBgGradient: 'linear-gradient(135deg, #ecd5c8 0%, #f2ddd0 30%, #f5e6d0 60%, #f0e4d8 100%)',
      contentBg: 'rgba(255, 252, 250, 0.85)',
      textColor: '#3d2e28',
      borderColor: '#d9c8be',
      tooltipColor: '#fffcfa',
    },
    dark: {
      themeColor: '#c96b5e',
      appBg: '#f0e6df',
      appBgGradient: 'linear-gradient(135deg, #ecd5c8 0%, #f2ddd0 30%, #f5e6d0 60%, #f0e4d8 100%)',
      contentBg: 'rgba(255, 252, 250, 0.85)',
      textColor: '#3d2e28',
      borderColor: '#d9c8be',
      tooltipColor: '#fffcfa',
    },
  },
  {
    id: 'builtin-mint-frost',
    name: '薄荷霜',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#3d8fa5',
      appBg: '#e4eff3',
      appBgGradient: 'linear-gradient(135deg, #cde4ed 0%, #d5e8f0 30%, #d8e5e8 60%, #dce8ec 100%)',
      contentBg: 'rgba(249, 252, 253, 0.85)',
      textColor: '#253540',
      borderColor: '#b8cdd6',
      tooltipColor: '#f9fcfd',
    },
    dark: {
      themeColor: '#3d8fa5',
      appBg: '#e4eff3',
      appBgGradient: 'linear-gradient(135deg, #cde4ed 0%, #d5e8f0 30%, #d8e5e8 60%, #dce8ec 100%)',
      contentBg: 'rgba(249, 252, 253, 0.85)',
      textColor: '#253540',
      borderColor: '#b8cdd6',
      tooltipColor: '#f9fcfd',
    },
  },
  {
    id: 'builtin-galaxy',
    name: '星河',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#9b7ed8',
      appBg: '#191628',
      appBgGradient: 'linear-gradient(135deg, #0a0818 0%, #281850 25%, #121030 50%, #301860 75%, #181438 100%)',
      contentBg: 'rgba(33, 30, 54, 0.85)',
      textColor: '#d8d0e8',
      borderColor: '#3a3455',
      tooltipColor: '#211e36',
    },
    dark: {
      themeColor: '#9b7ed8',
      appBg: '#191628',
      appBgGradient: 'linear-gradient(135deg, #0a0818 0%, #281850 25%, #121030 50%, #301860 75%, #181438 100%)',
      contentBg: 'rgba(33, 30, 54, 0.85)',
      textColor: '#d8d0e8',
      borderColor: '#3a3455',
      tooltipColor: '#211e36',
    },
  },
  {
    id: 'builtin-lava',
    name: '熔岩',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#d45a3a',
      appBg: '#1a1412',
      appBgGradient: 'linear-gradient(135deg, #0e0808 0%, #381810 25%, #140e0c 50%, #402014 75%, #1c120e 100%)',
      contentBg: 'rgba(40, 32, 28, 0.85)',
      textColor: '#e8d8d0',
      borderColor: '#4a3830',
      tooltipColor: '#28201c',
    },
    dark: {
      themeColor: '#d45a3a',
      appBg: '#1a1412',
      appBgGradient: 'linear-gradient(135deg, #0e0808 0%, #381810 25%, #140e0c 50%, #402014 75%, #1c120e 100%)',
      contentBg: 'rgba(40, 32, 28, 0.85)',
      textColor: '#e8d8d0',
      borderColor: '#4a3830',
      tooltipColor: '#28201c',
    },
  },
  {
    id: 'builtin-sakura',
    name: '樱花',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#d4698e',
      appBg: '#f0dde4',
      appBgGradient: 'linear-gradient(135deg, #f0c8d8 0%, #e0d0f0 22%, #d8c8e8 44%, #f0dce6 66%, #e8d0e0 88%, #f2dde8 100%)',
      contentBg: 'rgba(255, 245, 247, 0.85)',
      textColor: '#4a2e38',
      borderColor: '#ddb0c4',
      tooltipColor: '#fff5f7',
    },
    dark: {
      themeColor: '#d4698e',
      appBg: '#f0dde4',
      appBgGradient: 'linear-gradient(135deg, #f0c8d8 0%, #e0d0f0 22%, #d8c8e8 44%, #f0dce6 66%, #e8d0e0 88%, #f2dde8 100%)',
      contentBg: 'rgba(255, 245, 247, 0.85)',
      textColor: '#4a2e38',
      borderColor: '#ddb0c4',
      tooltipColor: '#fff5f7',
    },
  },
  {
    id: 'builtin-aurora',
    name: '极光',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#2da08e',
      appBg: '#dcecf6',
      appBgGradient: 'linear-gradient(135deg, #b8ddd8 0%, #d0e8b8 18%, #c8e0d8 36%, #98d4ca 54%, #b8e0cc 72%, #a0dcd8 90%, #c4e8e4 100%)',
      contentBg: 'rgba(242, 252, 250, 0.85)',
      textColor: '#1a3e35',
      borderColor: '#8ac4b8',
      tooltipColor: '#f2fcfa',
    },
    dark: {
      themeColor: '#2da08e',
      appBg: '#dcecf6',
      appBgGradient: 'linear-gradient(135deg, #b8ddd8 0%, #d0e8b8 18%, #c8e0d8 36%, #98d4ca 54%, #b8e0cc 72%, #a0dcd8 90%, #c4e8e4 100%)',
      contentBg: 'rgba(242, 252, 250, 0.85)',
      textColor: '#1a3e35',
      borderColor: '#8ac4b8',
      tooltipColor: '#f2fcfa',
    },
  },
  {
    id: 'builtin-abyss',
    name: '深海',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#4aa8c7',
      appBg: '#0c1820',
      appBgGradient: 'linear-gradient(135deg, #040c18 0%, #183048 20%, #081420 35%, #204058 52%, #0a1830 68%, #1c3850 82%, #0e1828 100%)',
      contentBg: 'rgba(20, 40, 56, 0.85)',
      textColor: '#a8d0e4',
      borderColor: '#244058',
      tooltipColor: '#142838',
    },
    dark: {
      themeColor: '#4aa8c7',
      appBg: '#0c1820',
      appBgGradient: 'linear-gradient(135deg, #040c18 0%, #183048 20%, #081420 35%, #204058 52%, #0a1830 68%, #1c3850 82%, #0e1828 100%)',
      contentBg: 'rgba(20, 40, 56, 0.85)',
      textColor: '#a8d0e4',
      borderColor: '#244058',
      tooltipColor: '#142838',
    },
  },
  {
    id: 'builtin-twilight',
    name: '暮霭',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#b86b8e',
      appBg: '#120e1a',
      appBgGradient: 'linear-gradient(135deg, #080616 0%, #281840 18%, #10081e 33%, #302048 48%, #140e30 63%, #341c42 78%, #0e1020 93%, #201838 100%)',
      contentBg: 'rgba(32, 24, 46, 0.85)',
      textColor: '#d0b8cc',
      borderColor: '#3c2848',
      tooltipColor: '#20182e',
    },
    dark: {
      themeColor: '#b86b8e',
      appBg: '#120e1a',
      appBgGradient: 'linear-gradient(135deg, #080616 0%, #281840 18%, #10081e 33%, #302048 48%, #140e30 63%, #341c42 78%, #0e1020 93%, #201838 100%)',
      contentBg: 'rgba(32, 24, 46, 0.85)',
      textColor: '#d0b8cc',
      borderColor: '#3c2848',
      tooltipColor: '#20182e',
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
  /**
   * Section to focus when the Settings panel opens.
   * Set by callers (e.g. AIView's settings button) so the panel
   * jumps directly to the requested section. Cleared after the
   * SettingsView consumes it.
   */
  settingsSection: SettingsSection
  aiPanelVisible: boolean
  rightPanelType: RightPanelType
  clipboardFiles: string[]
  clipboardIsCut: boolean
  workspaceMode: WorkspaceMode
  autoStart: boolean
  autoCheckUpdate: boolean
  closeWithoutExit: boolean
  noteWidth: NoteWidth
  showAllFiles: boolean
  markdownOnly: boolean
  customShortcuts: Record<string, string>
  /**
   * User-bound keyboard shortcuts for plugin commands. Keyed by
   * `<pluginId>:<commandId>` so two plugins can contribute
   * commands with the same id without colliding. Persisted to
   * localStorage via `saveAppSettings({ pluginCommandShortcuts })`
   * so the bindings survive an app restart.
   */
  pluginCommandShortcuts: Record<string, string>
  syncInterval: number
  autoSyncPush: boolean
  uploadPath: string
  showConflictBadge: boolean
  aiProvider: string
  aiApiKey: string
  aiApiKeyDecrypted: string
  aiBaseUrl: string
  aiModel: string
  aiPort: number
  aiModels: AiModelConfig[]
  activeAiModelId: string
  defaultAiModelId: string
  aiAttachedFiles: string[]
  aiContextMenuRequest: AiContextMenuRequest | null
  customThemes: CustomTheme[]
  activeLightCustomThemeId: string
  activeDarkCustomThemeId: string
  setTheme: (theme: Theme) => void
  setThemeColor: (color: string) => void
  setSidebarView: (view: SidebarView) => void
  setSidebarWidth: (width: number) => void
  setSidebarVisible: (visible: boolean) => void
  toggleSidebar: () => void
  toggleStatusBar: () => void
  setEditorViewMode: (mode: EditorViewMode) => void
  toggleCommandPalette: () => void
  toggleSearchPanel: () => void
  setSettingsPanelVisible: (visible: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
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
  setAutoCheckUpdate: (value: boolean) => void
  setCloseWithoutExit: (value: boolean) => void
  setNoteWidth: (width: NoteWidth) => void
  setShowAllFiles: (value: boolean) => void
  setMarkdownOnly: (value: boolean) => void
  setSyncInterval: (interval: number) => void
  setAutoSyncPush: (value: boolean) => void
  setUploadPath: (path: string) => void
  setShowConflictBadge: (value: boolean) => void
  setAiProvider: (provider: string) => void
  setAiApiKey: (key: string) => Promise<void>
  setAiBaseUrl: (url: string) => void
  setAiModel: (model: string) => void
  setAiPort: (port: number) => void
  addAiModel: (model: Omit<AiModelConfig, 'id'>) => void
  removeAiModel: (id: string) => void
  setActiveAiModel: (id: string) => void
  setDefaultAiModel: (id: string) => void
  addAiAttachedFile: (filePath: string) => void
  removeAiAttachedFile: (index: number) => void
  clearAiAttachedFiles: () => void
  setAiContextMenuRequest: (request: AiContextMenuRequest | null) => void
  updateAiModelApiKey: (id: string, key: string) => Promise<void>
  setShortcut: (key: ShortcutKey, value: string) => void
  resetShortcut: (key: ShortcutKey) => void
  resetAllShortcuts: () => void
  setPluginCommandShortcut: (bindingKey: string, value: string) => void
  resetPluginCommandShortcut: (bindingKey: string) => void
  resetAllPluginCommandShortcuts: () => void
  /**
   * Drop every plugin-command shortcut that points at a plugin id
   * the user no longer has installed. Called by the plugin store
   * on unregister / setPlugins diff to keep the persisted map from
   * accumulating stale bindings.
   */
  prunePluginCommandShortcuts: (validPluginIds: Set<string>) => void
  setActiveCustomThemeId: (themeType: 'light' | 'dark', id: string) => void
  addCustomTheme: (name: string, themeType: 'light' | 'dark') => void
  deleteCustomTheme: (id: string) => void
  renameCustomTheme: (id: string, name: string) => void
  updateCustomThemeColor: (id: string, themeType: 'light' | 'dark', key: keyof CustomThemeColors, value: string) => void
  loadSettings: () => Promise<void>
}

export const useUIStore = create<UIState>((set, get) => ({
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
  settingsSection: null,
  aiPanelVisible: false,
  rightPanelType: null,
  clipboardFiles: [],
  clipboardIsCut: false,
  workspaceMode: 'folder',
  autoStart: false,
  autoCheckUpdate: true,
  closeWithoutExit: false,
  noteWidth: 'normal',
  showAllFiles: false,
  markdownOnly: false,
  customShortcuts: {},
  pluginCommandShortcuts: {},
  syncInterval: 10,
  autoSyncPush: false,
  uploadPath: '',
  showConflictBadge: true,
  aiProvider: '',
  aiApiKey: '',
  aiApiKeyDecrypted: '',
  aiBaseUrl: '',
  aiModel: '',
  aiPort: 4017,
  aiModels: [],
  activeAiModelId: '',
  defaultAiModelId: '',
  aiAttachedFiles: [],
  aiContextMenuRequest: null,
  customThemes: [...BUILT_IN_THEMES],
  activeLightCustomThemeId: 'builtin-light',
  activeDarkCustomThemeId: 'builtin-dark',
  setTheme: (theme) => {
    set({ theme })
    saveAppSettings({ theme })
    // Plugins only need to know the resolved theme identifier; they
    // shouldn't need to read the raw `theme` (which can be 'system')
    // to compute the actual dark/light state. We emit only the
    // persisted identifier so consumers can mirror localStorage if
    // they want to.
    queueMicrotask(() => emitThemeChanged(theme))
  },
  setThemeColor: (color) => {
    set({ themeColor: color })
    saveAppSettings({ themeColor: color })
    // Colour change goes through `settings:change` rather than
    // `theme:change` because plugins tracking `theme:change` care
    // about the light/dark mode, not the accent colour.
    queueMicrotask(() => emitSettingChanged('themeColor', color))
  },
  setSidebarView: (view) => set({ sidebarView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(150, Math.min(500, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(150, Math.min(600, width)) }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
  setEditorViewMode: (mode) => {
    set({ editorViewMode: mode })
    queueMicrotask(() => emitSettingChanged('editorViewMode', mode))
  },
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteVisible: !state.commandPaletteVisible })),
  toggleSearchPanel: () =>
    set((state) => ({ searchPanelVisible: !state.searchPanelVisible })),
  setSettingsPanelVisible: (visible) => set({ settingsPanelVisible: visible }),
  setSettingsSection: (section: SettingsSection) => set({ settingsSection: section }),
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
    setAutoStartEnabled(value).catch((err) => {
      // OS-level registration (LaunchAgent / registry) failed — the
      // UI is now ahead of reality. Roll back the optimistic state
      // and surface the error so the user isn't silently misled.
      console.error('[ui] setAutoStartEnabled failed', err)
      toast.error(i18n.t('settings.general.autoStart.failed'), { description: String(err) })
      get().setAutoStart(!value)
    })
    queueMicrotask(() => emitSettingChanged('autoStart', value))
  },
  setAutoCheckUpdate: (value) => {
    set({ autoCheckUpdate: value })
    saveAppSettings({ autoCheckUpdate: String(value) })
    queueMicrotask(() => emitSettingChanged('autoCheckUpdate', value))
  },
  setCloseWithoutExit: (value) => {
    set({ closeWithoutExit: value })
    saveAppSettings({ closeWithoutExit: String(value) })
    queueMicrotask(() => emitSettingChanged('closeWithoutExit', value))
  },
  setNoteWidth: (width) => {
    set({ noteWidth: width })
    saveAppSettings({ noteWidth: width })
    queueMicrotask(() => emitSettingChanged('noteWidth', width))
  },
  setShowAllFiles: (value) => {
    // If enabling showAllFiles, disable markdownOnly since they are mutually exclusive
    if (value) {
      set({ showAllFiles: true, markdownOnly: false })
      saveAppSettings({ showAllFiles: 'true', markdownOnly: 'false' })
    } else {
      set({ showAllFiles: false })
      saveAppSettings({ showAllFiles: 'false' })
    }
    useFileTreeStore.getState().refreshExpanded()
  },
  setMarkdownOnly: (value) => {
    // If enabling markdownOnly, disable showAllFiles since they are mutually exclusive
    if (value) {
      set({ markdownOnly: true, showAllFiles: false })
      saveAppSettings({ markdownOnly: 'true', showAllFiles: 'false' })
    } else {
      set({ markdownOnly: false })
      saveAppSettings({ markdownOnly: 'false' })
    }
    useFileTreeStore.getState().refreshExpanded()
  },
  setSyncInterval: (interval: number) => {
    set({ syncInterval: interval })
    saveAppSettings({ syncInterval: String(interval) })
    queueMicrotask(() => emitSettingChanged('syncInterval', interval))
  },
  setAutoSyncPush: (value: boolean) => {
    set({ autoSyncPush: value })
    saveAppSettings({ autoSyncPush: String(value) })
    queueMicrotask(() => emitSettingChanged('autoSyncPush', value))
  },
  setUploadPath: (path: string) => {
    set({ uploadPath: path })
    saveAppSettings({ uploadPath: path })
    queueMicrotask(() => emitSettingChanged('uploadPath', path))
  },
  setShowConflictBadge: (value: boolean) => {
    set({ showConflictBadge: value })
    saveAppSettings({ showConflictBadge: String(value) })
    queueMicrotask(() => emitSettingChanged('showConflictBadge', value))
  },
  setAiProvider: (provider: string) => {
    set({ aiProvider: provider })
    saveAppSettings({ aiProvider: provider })
  },
  setAiApiKey: async (key: string) => {
    try {
      const encrypted = key ? await encryptApiKey(key) : ''
      set({ aiApiKey: encrypted, aiApiKeyDecrypted: key })
      saveAppSettings({ aiApiKey: encrypted })
      const { aiProvider, aiBaseUrl, aiModel, aiPort } = useUIStore.getState()
      if (aiProvider) {
        // Restart failure means the new key is persisted but chat
        // still proxies through the old config — surface this so
        // the user knows the change hasn't taken effect yet.
        restartAiProxy(aiProvider, key, aiBaseUrl, aiModel, aiPort).catch((err) => {
          console.error('[ui] restartAiProxy failed', err)
          toast.error(i18n.t('settings.ai.restartFailed'), { description: String(err) })
        })
      }
    } catch {
      set({ aiApiKeyDecrypted: key })
    }
  },
  setAiBaseUrl: (url: string) => {
    set({ aiBaseUrl: url })
    saveAppSettings({ aiBaseUrl: url })
  },
  setAiModel: (model: string) => {
    set({ aiModel: model })
    saveAppSettings({ aiModel: model })
  },
  setAiPort: (port: number) => {
    set({ aiPort: port })
    saveAppSettings({ aiPort: String(port) })
  },
  addAiModel: (model) => {
    const newModel: AiModelConfig = { ...model, id: generateModelId() }
    set((state) => {
      const aiModels = [...state.aiModels, newModel]
      saveAppSettings({ aiModels: JSON.stringify(aiModels) })
      const updates: Partial<UIState> = { aiModels }
      if (!state.activeAiModelId) {
        updates.activeAiModelId = newModel.id
        saveAppSettings({ activeAiModelId: newModel.id })
      }
      return updates
    })
  },
  removeAiModel: (id: string) => {
    set((state) => {
      const model = state.aiModels.find((m) => m.id === id)
      if (model?.isBuiltIn) return state
      const aiModels = state.aiModels.filter((m) => m.id !== id)
      saveAppSettings({ aiModels: JSON.stringify(aiModels) })
      const updates: Partial<UIState> = { aiModels }
      if (state.activeAiModelId === id) {
        const nextActive = aiModels.length > 0 ? aiModels[0].id : ''
        updates.activeAiModelId = nextActive
        saveAppSettings({ activeAiModelId: nextActive })
      }
      return updates
    })
  },
  setActiveAiModel: (id: string) => {
    set({ activeAiModelId: id })
    saveAppSettings({ activeAiModelId: id })
  },
  setDefaultAiModel: (id: string) => {
    set({ defaultAiModelId: id })
    saveAppSettings({ defaultAiModelId: id })
  },
  addAiAttachedFile: (filePath: string) => {
    set((state) => {
      if (state.aiAttachedFiles.includes(filePath)) return state
      return { aiAttachedFiles: [...state.aiAttachedFiles, filePath] }
    })
  },
  removeAiAttachedFile: (index: number) => {
    set((state) => {
      const files = [...state.aiAttachedFiles]
      files.splice(index, 1)
      return { aiAttachedFiles: files }
    })
  },
  clearAiAttachedFiles: () => set({ aiAttachedFiles: [] }),
  setAiContextMenuRequest: (request) => set({ aiContextMenuRequest: request }),
  updateAiModelApiKey: async (id: string, key: string) => {
    try {
      const encrypted = key ? await encryptApiKey(key) : ''
      set((state) => {
        const aiModels = state.aiModels.map((m) =>
          m.id === id ? { ...m, apiKey: encrypted, _decryptedApiKey: key } : m
        )
        saveAppSettings({ aiModels: JSON.stringify(aiModels) })
        return { aiModels }
      })
    } catch { /* ignore */ }
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
  setPluginCommandShortcut: (bindingKey, value) => {
    set((state) => {
      // If the user re-binds an already-bound command, the new
      // value simply overwrites the old. We don't attempt to
      // resolve conflicts at the store level – the settings panel
      // runs the conflict check first and only calls us on accept.
      const next = { ...state.pluginCommandShortcuts, [bindingKey]: value }
      saveAppSettings({ pluginCommandShortcuts: JSON.stringify(next) })
      return { pluginCommandShortcuts: next }
    })
  },
  resetPluginCommandShortcut: (bindingKey) => {
    set((state) => {
      if (!(bindingKey in state.pluginCommandShortcuts)) return state
      const next = { ...state.pluginCommandShortcuts }
      delete next[bindingKey]
      saveAppSettings({ pluginCommandShortcuts: JSON.stringify(next) })
      return { pluginCommandShortcuts: next }
    })
  },
  resetAllPluginCommandShortcuts: () => {
    set({ pluginCommandShortcuts: {} })
    saveAppSettings({ pluginCommandShortcuts: '{}' })
  },
  prunePluginCommandShortcuts: (validPluginIds) => {
    set((state) => {
      const next: Record<string, string> = {}
      let changed = false
      for (const [bindingKey, value] of Object.entries(state.pluginCommandShortcuts)) {
        // bindingKey format: "<pluginId>:<commandId>". The plugin
        // id may itself contain colons (e.g. reverse-DNS style
        // "com.foo.bar:baz"), so we use the *last* colon as the
        // separator. That's the same convention the settings
        // panel uses to render the row.
        const lastColon = bindingKey.lastIndexOf(':')
        if (lastColon <= 0) continue
        const pluginId = bindingKey.slice(0, lastColon)
        if (validPluginIds.has(pluginId)) {
          // `value` is typed `unknown` from `Object.entries`;
          // the map's `string` value type is enforced by the
          // surrounding Record. A non-string here would mean
          // someone wrote garbage to the persisted map, which
          // we silently drop to keep this prune idempotent.
          if (typeof value === 'string') {
            next[bindingKey] = value
          } else {
            changed = true
          }
        } else {
          changed = true
        }
      }
      if (!changed) return state
      saveAppSettings({ pluginCommandShortcuts: JSON.stringify(next) })
      return { pluginCommandShortcuts: next }
    })
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
    const baseTheme = themeType === 'light' ? BUILT_IN_THEMES[0] : BUILT_IN_THEMES[1]
    const newTheme: CustomTheme = {
      id,
      name,
      isBuiltIn: false,
      themeType,
      light: { ...baseTheme.light },
      dark: { ...baseTheme.dark },
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
      // Plugin-command shortcuts live in the same Tauri session
      // store as `customShortcuts` but with a separate key so a
      // bad payload from one doesn't nuke the other. We parse
      // defensively (a malformed entry would otherwise crash
      // app startup on the `pluginCommandShortcuts[key]` reads
      // scattered through the keyboard handler).
      let pluginCommandShortcuts: Record<string, string> = {}
      if (s.pluginCommandShortcuts) {
        try {
          pluginCommandShortcuts = JSON.parse(s.pluginCommandShortcuts)
        } catch {
          pluginCommandShortcuts = {}
        }
      }
      let customThemes: CustomTheme[] = [...BUILT_IN_THEMES]
      if (s.customThemes) {
        try {
          const parsed = JSON.parse(s.customThemes) as CustomTheme[]
          const userThemes = parsed
            .filter((t) => !t.isBuiltIn)
            .map((t) => ({
              ...t,
              // Migrate old themes without themeType: default to 'light'
              themeType: t.themeType || 'light' as const,
            }))
          customThemes = [...BUILT_IN_THEMES, ...userThemes]
        } catch { /* ignore */ }
      }
      let aiModels: AiModelConfig[] = []
      if (s.aiModels) {
        try {
          aiModels = JSON.parse(s.aiModels) as AiModelConfig[]
        } catch {
          aiModels = []
        }
      }
      if (aiModels.length === 0 && s.aiProvider && s.aiModel) {
        aiModels = [{
          id: generateModelId(),
          name: s.aiModel,
          category: s.aiProvider === 'ollama' ? 'local' as const : 'api' as const,
          provider: s.aiProvider,
          apiKey: s.aiApiKey || '',
          baseUrl: s.aiBaseUrl || '',
          model: s.aiModel,
        }]
      }
      try {
        const builtinModels = await getBuiltinAiModels()
        const builtinIds = new Set(builtinModels.map((bm) => bm.id))
        // Prune stale `builtin-*` entries that no longer exist in the
        // current built-in list (e.g. GLM-Z1-9B removed in 2026-06-17).
        // User-added custom models are untouched.
        aiModels = aiModels.filter((m) => !(m.isBuiltIn && !builtinIds.has(m.id)))
        const existingIds = new Set(aiModels.map((m) => m.id))
        const missing = builtinModels
          .filter((bm) => !existingIds.has(bm.id))
          .map((bm): AiModelConfig => ({
            id: bm.id,
            name: bm.name,
            category: bm.category as AiModelConfig['category'],
            provider: bm.provider as AiModelConfig['provider'],
            apiKey: bm.api_key,
            baseUrl: bm.base_url,
            model: bm.model,
            isBuiltIn: bm.is_built_in,
          }))
        aiModels = [...missing, ...aiModels]
        // Persist the pruned list so the change survives restarts.
        saveAppSettings({ aiModels: JSON.stringify(aiModels) })
      } catch { /* ignore */ }
      // Batch decrypt all API keys concurrently BEFORE setting state,
      // so that models are available with decrypted keys in a single set() call.
      // This avoids a window where components read empty _decryptedApiKey.
      const decryptEntries = aiModels
        .filter((m) => m.apiKey)
        .map((m) => decryptApiKey(m.apiKey!).then((decrypted) => ({ id: m.id, decrypted })).catch(() => null))
      const decryptResults = await Promise.all(decryptEntries)
      const decryptedMap = new Map<string, string>()
      for (const result of decryptResults) {
        if (result) decryptedMap.set(result.id, result.decrypted)
      }
      // Apply decrypted keys to models
      const aiModelsWithDecrypted = decryptedMap.size > 0
        ? aiModels.map((am) =>
            decryptedMap.has(am.id) ? { ...am, _decryptedApiKey: decryptedMap.get(am.id) } : am
          )
        : aiModels

      // Decrypt legacy single-model API key
      let aiApiKeyDecrypted = ''
      if (s.aiApiKey && s.aiProvider) {
        try {
          aiApiKeyDecrypted = await decryptApiKey(s.aiApiKey)
        } catch {
          aiApiKeyDecrypted = ''
        }
      }

      set({
        theme: s.theme as Theme,
        themeColor: s.themeColor,
        autoStart: s.autoStart === 'true',
        autoCheckUpdate: s.autoCheckUpdate !== 'false', // default true
        closeWithoutExit: s.closeWithoutExit === 'true',
        noteWidth: s.noteWidth as NoteWidth,
        showAllFiles: s.showAllFiles === 'true',
        markdownOnly: s.markdownOnly === 'true',
        customShortcuts,
        pluginCommandShortcuts,
        syncInterval: s.syncInterval ? Number(s.syncInterval) : 10,
        autoSyncPush: s.autoSyncPush === 'true',
        uploadPath: s.uploadPath || '',
        showConflictBadge: s.showConflictBadge !== 'false', // default true
        aiProvider: s.aiProvider || '',
        aiApiKey: s.aiApiKey || '',
        aiApiKeyDecrypted,
        aiBaseUrl: s.aiBaseUrl || '',
        aiModel: s.aiModel || '',
        aiPort: s.aiPort ? Number(s.aiPort) : 4017,
        aiModels: aiModelsWithDecrypted,
        activeAiModelId: s.activeAiModelId || (aiModelsWithDecrypted.length > 0 ? aiModelsWithDecrypted[0].id : ''),
        defaultAiModelId: s.defaultAiModelId || '',
        customThemes,
        activeLightCustomThemeId: s.activeLightCustomThemeId || 'builtin-light',
        activeDarkCustomThemeId: s.activeDarkCustomThemeId || 'builtin-dark',
      })
    } catch {
      // DB not ready, use defaults
    }
  },
}))
