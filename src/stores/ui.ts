/**
 * UI Store - Manages UI state
 */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { getLatestFolder, getAppSettings, saveAppSettings, setAppLocale, setAutoStartEnabled, isAutoStartEnabled, restartApp } from '@/lib/tauri'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { RIGHT_PANEL_TRANSITION_START, RIGHT_PANEL_TRANSITION_END } from '@/lib/rightPanelTransition'
import { ShortcutKey } from '@/lib/shortcuts'
import { useFileTreeStore } from './filetree'
import { emitLocaleChanged, emitSettingChanged, emitThemeChanged } from '@/lib/plugin-host'
import type { PluginPanelRequest } from '@/types/plugin'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarView = 'explorer' | 'search' | 'categories' | 'git' | 'settings' | `plugin:${string}`
export type EditorViewMode = 'edit' | 'preview' | 'split'
export type RightPanelType = 'directory' | 'history' | 'editorSettings' | 'noteProperties' | `plugin:${string}` | null
/**
 * Section IDs inside the Settings panel. Mirrors the
 * `SettingsSection` type in `Settings/SettingsView.tsx`.
 * `null` means "no specific section requested" (default first paint).
 */
export type SettingsSection = 'general' | 'sync' | 'appearance' | 'shortcuts' | 'plugins' | 'development' | null

export type WorkspaceMode = 'folder' | 'workspace'
export type NoteWidth = 'normal' | 'wide'
/** 更新下载渠道：github=官方直连，ghproxy=gh-proxy 加速 */
export type UpdateChannel = 'github' | 'ghproxy'

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
  /** i18n key for built-in theme names; user themes leave this undefined */
  nameKey?: string
  isBuiltIn: boolean
  themeType: 'light' | 'dark'
  light: CustomThemeColors
  dark: CustomThemeColors
}

export const BUILT_IN_THEMES: CustomTheme[] = [
  {
    id: 'builtin-light',
    name: i18n.t('theme.light'),
    nameKey: 'theme.light',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#0E7490',
      appBg: '#E7EEF1',
      contentBg: '#FBFDFE',
      textColor: '#1A2A32',
      borderColor: '#D5E1E6',
      tooltipColor: '#FBFDFE',
    },
    dark: {
      themeColor: '#0E7490',
      appBg: '#E7EEF1',
      contentBg: '#FBFDFE',
      textColor: '#1A2A32',
      borderColor: '#D5E1E6',
      tooltipColor: '#FBFDFE',
    },
  },
  {
    id: 'builtin-dark',
    name: i18n.t('theme.dark'),
    nameKey: 'theme.dark',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#0891B2',
      appBg: '#0F171D',
      contentBg: '#161F27',
      textColor: '#D9E6EC',
      borderColor: '#2A3A47',
      tooltipColor: '#161F27',
    },
    dark: {
      themeColor: '#0891B2',
      appBg: '#0F171D',
      contentBg: '#161F27',
      textColor: '#D9E6EC',
      borderColor: '#2A3A47',
      tooltipColor: '#161F27',
    },
  },
  {
    id: 'builtin-warm-sand',
    name: i18n.t('theme.warmSand'),
    nameKey: 'theme.warmSand',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#B45309',
      appBg: '#EFE6D8',
      contentBg: '#FFFCF5',
      textColor: '#3D2E1E',
      borderColor: '#DCCEB8',
      tooltipColor: '#FFFCF5',
    },
    dark: {
      themeColor: '#B45309',
      appBg: '#EFE6D8',
      contentBg: '#FFFCF5',
      textColor: '#3D2E1E',
      borderColor: '#DCCEB8',
      tooltipColor: '#FFFCF5',
    },
  },
  {
    id: 'builtin-sage-meadow',
    name: i18n.t('theme.sage'),
    nameKey: 'theme.sage',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#15803D',
      appBg: '#DFEAE0',
      contentBg: '#FAFDFA',
      textColor: '#1F3A26',
      borderColor: '#C2D6C6',
      tooltipColor: '#FAFDFA',
    },
    dark: {
      themeColor: '#15803D',
      appBg: '#DFEAE0',
      contentBg: '#FAFDFA',
      textColor: '#1F3A26',
      borderColor: '#C2D6C6',
      tooltipColor: '#FAFDFA',
    },
  },
  {
    id: 'builtin-midnight-ink',
    name: i18n.t('theme.inkNight'),
    nameKey: 'theme.inkNight',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#6366F1',
      appBg: '#15182B',
      contentBg: '#1D2140',
      textColor: '#D5DBF5',
      borderColor: '#333A5E',
      tooltipColor: '#1D2140',
    },
    dark: {
      themeColor: '#6366F1',
      appBg: '#15182B',
      contentBg: '#1D2140',
      textColor: '#D5DBF5',
      borderColor: '#333A5E',
      tooltipColor: '#1D2140',
    },
  },
  {
    id: 'builtin-ember-glow',
    name: i18n.t('theme.ember'),
    nameKey: 'theme.ember',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#D6531E',
      appBg: '#1D1512',
      contentBg: '#2A201B',
      textColor: '#F0DCD2',
      borderColor: '#4A352C',
      tooltipColor: '#2A201B',
    },
    dark: {
      themeColor: '#D6531E',
      appBg: '#1D1512',
      contentBg: '#2A201B',
      textColor: '#F0DCD2',
      borderColor: '#4A352C',
      tooltipColor: '#2A201B',
    },
  },
  {
    id: 'builtin-dawn',
    name: i18n.t('theme.dawn'),
    nameKey: 'theme.dawn',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#C24328',
      appBg: '#F2E3DB',
      appBgGradient: 'linear-gradient(135deg, #F3CDBB 0%, #F6DCC8 30%, #F7E3C2 60%, #F1DACE 100%)',
      contentBg: 'rgba(255, 252, 250, 0.85)',
      textColor: '#3D2620',
      borderColor: '#DEC4B4',
      tooltipColor: '#FFFCFA',
    },
    dark: {
      themeColor: '#C24328',
      appBg: '#F2E3DB',
      appBgGradient: 'linear-gradient(135deg, #F3CDBB 0%, #F6DCC8 30%, #F7E3C2 60%, #F1DACE 100%)',
      contentBg: 'rgba(255, 252, 250, 0.85)',
      textColor: '#3D2620',
      borderColor: '#DEC4B4',
      tooltipColor: '#FFFCFA',
    },
  },
  {
    id: 'builtin-mint-frost',
    name: i18n.t('theme.mintFrost'),
    nameKey: 'theme.mintFrost',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#0369A1',
      appBg: '#E3F0F4',
      appBgGradient: 'linear-gradient(135deg, #C4E5EE 0%, #CFE8EE 30%, #D2E5E4 60%, #D8EAEF 100%)',
      contentBg: 'rgba(248, 253, 255, 0.85)',
      textColor: '#17323E',
      borderColor: '#B2D2DC',
      tooltipColor: '#F8FDFF',
    },
    dark: {
      themeColor: '#0369A1',
      appBg: '#E3F0F4',
      appBgGradient: 'linear-gradient(135deg, #C4E5EE 0%, #CFE8EE 30%, #D2E5E4 60%, #D8EAEF 100%)',
      contentBg: 'rgba(248, 253, 255, 0.85)',
      textColor: '#17323E',
      borderColor: '#B2D2DC',
      tooltipColor: '#F8FDFF',
    },
  },
  {
    id: 'builtin-galaxy',
    name: i18n.t('theme.galaxy'),
    nameKey: 'theme.galaxy',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#7C3AED',
      appBg: '#151026',
      appBgGradient: 'linear-gradient(135deg, #080618 0%, #2A1860 25%, #100C34 50%, #32206E 75%, #17123A 100%)',
      contentBg: 'rgba(30, 26, 52, 0.85)',
      textColor: '#DCD4F2',
      borderColor: '#393060',
      tooltipColor: '#1E1A34',
    },
    dark: {
      themeColor: '#7C3AED',
      appBg: '#151026',
      appBgGradient: 'linear-gradient(135deg, #080618 0%, #2A1860 25%, #100C34 50%, #32206E 75%, #17123A 100%)',
      contentBg: 'rgba(30, 26, 52, 0.85)',
      textColor: '#DCD4F2',
      borderColor: '#393060',
      tooltipColor: '#1E1A34',
    },
  },
  {
    id: 'builtin-lava',
    name: i18n.t('theme.lava'),
    nameKey: 'theme.lava',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#C2370C',
      appBg: '#180E0B',
      appBgGradient: 'linear-gradient(135deg, #0A0505 0%, #3A150C 25%, #120808 50%, #421A0E 75%, #1A0E0A 100%)',
      contentBg: 'rgba(38, 26, 22, 0.85)',
      textColor: '#EDD6CB',
      borderColor: '#48302A',
      tooltipColor: '#261A16',
    },
    dark: {
      themeColor: '#C2370C',
      appBg: '#180E0B',
      appBgGradient: 'linear-gradient(135deg, #0A0505 0%, #3A150C 25%, #120808 50%, #421A0E 75%, #1A0E0A 100%)',
      contentBg: 'rgba(38, 26, 22, 0.85)',
      textColor: '#EDD6CB',
      borderColor: '#48302A',
      tooltipColor: '#261A16',
    },
  },
  {
    id: 'builtin-sakura',
    name: i18n.t('theme.sakura'),
    nameKey: 'theme.sakura',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#C2427A',
      appBg: '#F1DBE3',
      appBgGradient: 'linear-gradient(135deg, #F2C5D6 0%, #E3CEF2 22%, #D6C4EC 44%, #F2D9E4 66%, #E8CCE2 88%, #F4DBE7 100%)',
      contentBg: 'rgba(255, 246, 249, 0.85)',
      textColor: '#431F30',
      borderColor: '#DFACBE',
      tooltipColor: '#FFF6F9',
    },
    dark: {
      themeColor: '#C2427A',
      appBg: '#F1DBE3',
      appBgGradient: 'linear-gradient(135deg, #F2C5D6 0%, #E3CEF2 22%, #D6C4EC 44%, #F2D9E4 66%, #E8CCE2 88%, #F4DBE7 100%)',
      contentBg: 'rgba(255, 246, 249, 0.85)',
      textColor: '#431F30',
      borderColor: '#DFACBE',
      tooltipColor: '#FFF6F9',
    },
  },
  {
    id: 'builtin-aurora',
    name: i18n.t('theme.aurora'),
    nameKey: 'theme.aurora',
    isBuiltIn: true,
    themeType: 'light',
    light: {
      themeColor: '#0F766E',
      appBg: '#DDEDF2',
      appBgGradient: 'linear-gradient(135deg, #A8DBD2 0%, #C4E8A8 18%, #B4E0D0 36%, #7ED2C4 54%, #A4DFC8 72%, #88D8D4 90%, #B0E8E4 100%)',
      contentBg: 'rgba(242, 252, 250, 0.85)',
      textColor: '#12352C',
      borderColor: '#78C4B8',
      tooltipColor: '#F2FCFA',
    },
    dark: {
      themeColor: '#0F766E',
      appBg: '#DDEDF2',
      appBgGradient: 'linear-gradient(135deg, #A8DBD2 0%, #C4E8A8 18%, #B4E0D0 36%, #7ED2C4 54%, #A4DFC8 72%, #88D8D4 90%, #B0E8E4 100%)',
      contentBg: 'rgba(242, 252, 250, 0.85)',
      textColor: '#12352C',
      borderColor: '#78C4B8',
      tooltipColor: '#F2FCFA',
    },
  },
  {
    id: 'builtin-abyss',
    name: i18n.t('theme.deepSea'),
    nameKey: 'theme.deepSea',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#0F93BF',
      appBg: '#0A161E',
      appBgGradient: 'linear-gradient(135deg, #040A16 0%, #1C3854 20%, #061020 35%, #245270 52%, #081830 68%, #1E4058 82%, #0C1828 100%)',
      contentBg: 'rgba(16, 36, 52, 0.85)',
      textColor: '#A5CFE6',
      borderColor: '#24425C',
      tooltipColor: '#102434',
    },
    dark: {
      themeColor: '#0F93BF',
      appBg: '#0A161E',
      appBgGradient: 'linear-gradient(135deg, #040A16 0%, #1C3854 20%, #061020 35%, #245270 52%, #081830 68%, #1E4058 82%, #0C1828 100%)',
      contentBg: 'rgba(16, 36, 52, 0.85)',
      textColor: '#A5CFE6',
      borderColor: '#24425C',
      tooltipColor: '#102434',
    },
  },
  {
    id: 'builtin-twilight',
    name: i18n.t('theme.dusk'),
    nameKey: 'theme.dusk',
    isBuiltIn: true,
    themeType: 'dark',
    light: {
      themeColor: '#C24B7C',
      appBg: '#100C18',
      appBgGradient: 'linear-gradient(135deg, #060414 0%, #2C1A48 18%, #0E0822 33%, #362454 48%, #121034 63%, #3C204C 78%, #0E1224 93%, #221A42 100%)',
      contentBg: 'rgba(28, 20, 42, 0.85)',
      textColor: '#D6BCCB',
      borderColor: '#3E2850',
      tooltipColor: '#1C142A',
    },
    dark: {
      themeColor: '#C24B7C',
      appBg: '#100C18',
      appBgGradient: 'linear-gradient(135deg, #060414 0%, #2C1A48 18%, #0E0822 33%, #362454 48%, #121034 63%, #3C204C 78%, #0E1224 93%, #221A42 100%)',
      contentBg: 'rgba(28, 20, 42, 0.85)',
      textColor: '#D6BCCB',
      borderColor: '#3E2850',
      tooltipColor: '#1C142A',
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
  settingsPanelVisible: boolean
  logViewerVisible: boolean
  /**
   * Section to focus when the Settings panel opens.
   * Set by callers so the panel jumps directly to the requested
   * section. Cleared after the SettingsView consumes it.
   */
  settingsSection: SettingsSection
  rightPanelType: RightPanelType
  clipboardFiles: string[]
  clipboardIsCut: boolean
  workspaceMode: WorkspaceMode
  autoStart: boolean
  autoCheckUpdate: boolean
  /** 日志单文件占用上限（MB），重启生效 */
  logMaxFileSize: number
  /** 更新下载渠道 */
  updateChannel: UpdateChannel
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
  /** 保存后空闲自动推送开关 */
  idleAutoPush: boolean
  /** 空闲自动推送的等待间隔（秒），保存后该时间内无新保存则触发推送 */
  idleAutoPushDelay: number
  uploadPath: string
  showConflictBadge: boolean
  /**
   * 面板一次性请求（P1.4）：openPluginPanel 写入，插件面板挂载消费
   * （props 送达）后清空；连续触发以最新请求覆盖。
   */
  pendingPluginRequest: PluginPanelRequest | null
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
  toggleLogViewer: () => void
  setSettingsPanelVisible: (visible: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  toggleSettingsPanel: () => void
  setRightPanelType: (type: RightPanelType) => Promise<void>
  setRightPanelWidth: (width: number) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  setClipboardFiles: (files: string[], isCut: boolean) => void
  clearClipboard: () => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  initWorkspaceMode: () => Promise<void>
  setAutoStart: (value: boolean) => void
  setAutoCheckUpdate: (value: boolean) => void
  setLogMaxFileSize: (mb: number) => void
  setUpdateChannel: (channel: UpdateChannel) => void
  /** 切换界面语言并持久化（I5：settings.appLocale + Rust 端 + 插件事件统一收口） */
  changeAppLocale: (locale: 'zh-CN' | 'en') => void
  setCloseWithoutExit: (value: boolean) => void
  setNoteWidth: (width: NoteWidth) => void
  setShowAllFiles: (value: boolean) => void
  setMarkdownOnly: (value: boolean) => void
  setSyncInterval: (interval: number) => void
  setAutoSyncPush: (value: boolean) => void
  setIdleAutoPush: (value: boolean) => void
  setIdleAutoPushDelay: (seconds: number) => void
  setUploadPath: (path: string) => void
  setShowConflictBadge: (value: boolean) => void
  setPendingPluginRequest: (request: PluginPanelRequest | null) => void
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
  developerMode: boolean
  setDeveloperMode: (enabled: boolean) => void
  loadSettings: () => Promise<void>
}

// 右面板开合时同步调整窗口宽度（逻辑像素）：打开 +面板宽、关闭 -面板宽，
// 编辑区（flex:1）因此保持宽度不变。最大化/全屏下窗口尺寸不可改，跳过。
async function adjustWindowWidthForPanel(open: boolean, panelWidth: number): Promise<number | null> {
  try {
    const win = getCurrentWindow()
    // 一次往返取齐窗口状态与尺寸，缩短开合时序中 DOM 变化的等待窗口（防闪动）
    const [maximized, fullscreen, size, sf] = await Promise.all([
      win.isMaximized(),
      win.isFullscreen(),
      win.innerSize(),
      win.scaleFactor(),
    ])
    if (maximized || fullscreen) return null
    const width = Math.round(size.width / sf) + (open ? panelWidth : -panelWidth)
    await win.setSize(new LogicalSize(width, Math.round(size.height / sf)))
    return width
  } catch (e) {
    logger.warn('ui', 'Failed to adjust window width for right panel:', e)
    return null
  }
}

// 等待 webview 视口宽度收敛到目标值再放行解锁：setSize 的 Promise resolve 不代表
// DOM 视口已更新（跨进程异步），解锁早于视口更新会让 flex-1 编辑区在旧视口宽度下
// 瞬间扩展填充原面板空间（关闭方向闪动）。轮询收敛而非固定 sleep；超时兜底防锁宽悬挂。
function waitForViewportWidth(target: number, timeoutMs = 150): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const poll = () => {
      if (Math.abs(window.innerWidth - target) <= 1 || Date.now() - start >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(poll, 16)
    }
    poll()
  })
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'light',
  themeColor: '#0E7490',
  sidebarView: 'explorer',
  sidebarVisible: true,
  sidebarWidth: 240,
  rightPanelWidth: 400,
  statusBarVisible: true,
  editorViewMode: 'split',
  settingsPanelVisible: false,
  logViewerVisible: false,
  settingsSection: null,
  rightPanelType: null,
  clipboardFiles: [],
  clipboardIsCut: false,
  workspaceMode: 'folder',
  autoStart: false,
  autoCheckUpdate: true,
  logMaxFileSize: 10,
  updateChannel: 'github',
  closeWithoutExit: false,
  noteWidth: 'normal',
  showAllFiles: false,
  markdownOnly: false,
  customShortcuts: {},
  pluginCommandShortcuts: {},
  syncInterval: 10,
  autoSyncPush: false,
  idleAutoPush: true,
  idleAutoPushDelay: 60,
  uploadPath: '',
  showConflictBadge: true,
  pendingPluginRequest: null,
  customThemes: [...BUILT_IN_THEMES],
  activeLightCustomThemeId: 'builtin-light',
  activeDarkCustomThemeId: 'builtin-dark',
  developerMode: false,
  setTheme: (theme) => {
    set({ theme })
    saveAppSettings({ theme })
    // 通知插件已解析的主题标识（不暴露原始 system）
    queueMicrotask(() => emitThemeChanged(theme))
  },
  setThemeColor: (color) => {
    set({ themeColor: color })
    saveAppSettings({ themeColor: color })
    // 颜色变更走 settings:change（theme:change 仅关注明暗）
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
  toggleLogViewer: () =>
    set((state) => ({ logViewerVisible: !state.logViewerVisible })),
  setSettingsPanelVisible: (visible) => set({ settingsPanelVisible: visible }),
  setSettingsSection: (section: SettingsSection) => set({ settingsSection: section }),
  toggleSettingsPanel: () =>
    set((state) => ({ settingsPanelVisible: !state.settingsPanelVisible })),
  setRightPanelType: async (type) => {
    if (type !== null) {
      // 打开：同步锁编辑区宽度 → 加宽窗口（编辑区不动，右侧仅露出空白）→ 渲染面板 → 解锁。
      // dispatch 的 handler 在调用栈内同步执行，锁在 await（OS 异步动作）前已生效；
      // 若无锁，webview 重排不等 JS，编辑区 flex 瞬时变宽一帧（闪动）
      window.dispatchEvent(new Event(RIGHT_PANEL_TRANSITION_START))
      const target = await adjustWindowWidthForPanel(true, get().rightPanelWidth)
      // 视口收敛后再渲染面板：若视口滞后就挂载，面板会被旧视口裁剪一帧
      if (target !== null) await waitForViewportWidth(target)
      set({ rightPanelType: type })
      window.dispatchEvent(new Event(RIGHT_PANEL_TRANSITION_END))
    } else {
      // 幂等保护：右面板本就未打开时为 no-op。设置面板等路径会无条件调
      // setRightPanelType(null)（仅确保关闭），若不拦截会把窗口错误收窄一个面板宽
      if (get().rightPanelType === null) return
      // 关闭：同步锁编辑区宽度 → 卸载面板（编辑区不动，右侧空白）→ 收窄窗口
      // → 视口收敛 → 解锁。收敛等待不可省：解锁早于视口更新会让 flex-1 编辑区
      // 在旧视口宽度下瞬间扩展（关闭方向闪动的根因）
      window.dispatchEvent(new Event(RIGHT_PANEL_TRANSITION_START))
      set({ rightPanelType: null })
      const target = await adjustWindowWidthForPanel(false, get().rightPanelWidth)
      if (target !== null) await waitForViewportWidth(target)
      window.dispatchEvent(new Event(RIGHT_PANEL_TRANSITION_END))
    }
  },
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
      // OS 注册失败，回滚乐观状态并提示错误
      logger.error('ui-store', 'setAutoStartEnabled failed', err)
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
  setLogMaxFileSize: (mb) => {
    set({ logMaxFileSize: mb })
    saveAppSettings({ logMaxFileSize: String(mb) })
    queueMicrotask(() => emitSettingChanged('logMaxFileSize', mb))
  },
  setUpdateChannel: (channel) => {
    set({ updateChannel: channel })
    saveAppSettings({ updateChannel: channel })
    queueMicrotask(() => emitSettingChanged('updateChannel', channel))
  },
  changeAppLocale: (locale) => {
    i18n.changeLanguage(locale)
    // 插件语言变化事件（原设置面板与快捷键两处各自派发，统一收口）
    queueMicrotask(() => emitLocaleChanged(locale))
    // 通知 Rust 端（如系统托盘/原生菜单语言）并持久化到 session_state
    setAppLocale(locale).catch((e) => logger.warn('ui-store', 'setAppLocale failed', e))
    saveAppSettings({ appLocale: locale }).catch((e) =>
      logger.warn('ui-store', 'saveAppSettings(appLocale) failed', e)
    )
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
  setIdleAutoPush: (value: boolean) => {
    set({ idleAutoPush: value })
    saveAppSettings({ idleAutoPush: String(value) })
    queueMicrotask(() => emitSettingChanged('idleAutoPush', value))
  },
  setIdleAutoPushDelay: (seconds: number) => {
    set({ idleAutoPushDelay: seconds })
    saveAppSettings({ idleAutoPushDelay: String(seconds) })
    queueMicrotask(() => emitSettingChanged('idleAutoPushDelay', seconds))
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
  setPendingPluginRequest: (request) => set({ pendingPluginRequest: request }),
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
  setDeveloperMode: (value) => {
    set({ developerMode: value })
    saveAppSettings({ developerMode: String(value) })
    queueMicrotask(() => emitSettingChanged('developerMode', value))
    // DevTools 只能在窗口创建时设置，切换后需要重启应用生效。
    // 开发模式下 Vite 由 cargo tauri dev 管理，自动重启 Tauri 进程会断开与 :1420 的连接，
    // 因此开发模式仅提示手动重启；生产包则自动重启。
    const isDevServer = window.location.origin.includes('localhost:1420')
    if (isDevServer) {
      toast.info(i18n.t('theme.devModeChanged'))
    } else {
      restartApp().catch((err) => {
        logger.error('ui-store', 'Failed to restart app:', err)
        toast.error(i18n.t('theme.restartFailed'))
      })
    }
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
        } catch (e) { logger.warn('ui-store', 'custom theme JSON.parse failed', e) }
      }

      // 启动时检查 OS 实际自启状态，与设置同步
      // 用户可能在 Task Manager 或系统设置中手动关闭了自启
      let actualAutoStart = s.autoStart === 'true'
      try {
        actualAutoStart = await isAutoStartEnabled()
      } catch {
        // OS 查询失败时退回读取设置值
      }

      set({
        theme: s.theme as Theme,
        themeColor: s.themeColor,
        autoStart: actualAutoStart,
        autoCheckUpdate: s.autoCheckUpdate !== 'false', // default true
        // 日志上限：非法数值回退默认 10MB
        logMaxFileSize: Number.isFinite(Number(s.logMaxFileSize)) && Number(s.logMaxFileSize) > 0
          ? Number(s.logMaxFileSize)
          : 10,
        // 更新渠道：仅接受已知值，未知回退 github
        updateChannel: s.updateChannel === 'ghproxy' ? 'ghproxy' : 'github',
        closeWithoutExit: s.closeWithoutExit === 'true',
        noteWidth: s.noteWidth as NoteWidth,
        showAllFiles: s.showAllFiles === 'true',
        markdownOnly: s.markdownOnly === 'true',
        customShortcuts,
        pluginCommandShortcuts,
        syncInterval: s.syncInterval ? Number(s.syncInterval) : 10,
        autoSyncPush: s.autoSyncPush === 'true',
        idleAutoPush: s.idleAutoPush !== 'false', // default true
        idleAutoPushDelay: s.idleAutoPushDelay ? Number(s.idleAutoPushDelay) : 60,
        uploadPath: s.uploadPath || '',
        showConflictBadge: s.showConflictBadge !== 'false', // default true
        customThemes,
        activeLightCustomThemeId: s.activeLightCustomThemeId || 'builtin-light',
        activeDarkCustomThemeId: s.activeDarkCustomThemeId || 'builtin-dark',
        developerMode: s.developerMode === 'true',
      })

      // I5：恢复持久化的界面语言（空值/非法值保持 init 默认 zh-CN）
      if (s.appLocale === 'en' || s.appLocale === 'zh-CN') {
        i18n.changeLanguage(s.appLocale)
      }
    } catch {
      // DB not ready, use defaults
    }
  },
}))

// 内置主题名随语言切换动态更新（用户自定义主题名保持不变）
i18n.on('languageChanged', () => {
  const { customThemes } = useUIStore.getState()
  const freshNames = new Map(
    BUILT_IN_THEMES.map((t) => [t.id, i18n.t(t.nameKey!)] as const),
  )
  let changed = false
  const next = customThemes.map((t) => {
    const fresh = freshNames.get(t.id)
    if (fresh && fresh !== t.name) {
      changed = true
      return { ...t, name: fresh }
    }
    return t
  })
  if (changed) useUIStore.setState({ customThemes: next })
})
