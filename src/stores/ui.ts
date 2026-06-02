/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { getLatestFolder, getAppSettings, saveAppSettings, setAutoStartEnabled, encryptApiKey, decryptApiKey, restartAiProxy, getBuiltinAiModels } from '@/lib/tauri'
import { ShortcutKey } from '@/lib/shortcuts'
import { AiModelConfig, generateModelId } from '@/lib/ai'
import { useFileTreeStore } from './filetree'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'git' | 'ai' | 'settings'
export type EditorViewMode = 'edit' | 'preview' | 'split'
export type RightPanelType = 'ai' | 'directory' | 'history' | 'editorSettings' | null

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
  autoCheckUpdate: boolean
  closeWithoutExit: boolean
  noteWidth: NoteWidth
  showAllFiles: boolean
  markdownOnly: boolean
  customShortcuts: Record<string, string>
  syncInterval: number
  autoSyncPush: boolean
  uploadPath: string
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
  autoCheckUpdate: true,
  closeWithoutExit: false,
  noteWidth: 'normal',
  showAllFiles: false,
  markdownOnly: false,
  customShortcuts: {},
  syncInterval: 10,
  autoSyncPush: false,
  uploadPath: '',
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
  },
  setThemeColor: (color) => {
    set({ themeColor: color })
    saveAppSettings({ themeColor: color })
  },
  setSidebarView: (view) => set({ sidebarView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(150, Math.min(500, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(150, Math.min(600, width)) }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
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
  setAutoCheckUpdate: (value) => {
    set({ autoCheckUpdate: value })
    saveAppSettings({ autoCheckUpdate: String(value) })
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
  },
  setAutoSyncPush: (value: boolean) => {
    set({ autoSyncPush: value })
    saveAppSettings({ autoSyncPush: String(value) })
  },
  setUploadPath: (path: string) => {
    set({ uploadPath: path })
    saveAppSettings({ uploadPath: path })
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
        restartAiProxy(aiProvider, key, aiBaseUrl, aiModel, aiPort).catch(() => {})
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
    } catch {}
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
        } catch {}
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
      } catch {}
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
        syncInterval: s.syncInterval ? Number(s.syncInterval) : 10,
        autoSyncPush: s.autoSyncPush === 'true',
        uploadPath: s.uploadPath || '',
        aiProvider: s.aiProvider || '',
        aiApiKey: s.aiApiKey || '',
        aiApiKeyDecrypted: '',
        aiBaseUrl: s.aiBaseUrl || '',
        aiModel: s.aiModel || '',
        aiPort: s.aiPort ? Number(s.aiPort) : 4017,
        aiModels,
        activeAiModelId: s.activeAiModelId || (aiModels.length > 0 ? aiModels[0].id : ''),
        defaultAiModelId: s.defaultAiModelId || '',
        customThemes,
        activeLightCustomThemeId: s.activeLightCustomThemeId || 'builtin-light',
        activeDarkCustomThemeId: s.activeDarkCustomThemeId || 'builtin-dark',
      })

      if (s.aiApiKey && s.aiProvider) {
        try {
          const decrypted = await decryptApiKey(s.aiApiKey)
          set({ aiApiKeyDecrypted: decrypted })
        } catch {
          set({ aiApiKeyDecrypted: '' })
        }
      }
      // Batch decrypt all API keys concurrently to avoid N sequential re-renders
      const decryptEntries = aiModels
        .filter((m) => m.apiKey)
        .map((m) => decryptApiKey(m.apiKey!).then((decrypted) => ({ id: m.id, decrypted })).catch(() => null))
      const decryptResults = await Promise.all(decryptEntries)
      const decryptedMap = new Map<string, string>()
      for (const result of decryptResults) {
        if (result) decryptedMap.set(result.id, result.decrypted)
      }
      if (decryptedMap.size > 0) {
        set((state) => ({
          aiModels: state.aiModels.map((am) =>
            decryptedMap.has(am.id) ? { ...am, _decryptedApiKey: decryptedMap.get(am.id) } : am
          ),
        }))
      }
    } catch {
      // DB not ready, use defaults
    }
  },
}))
