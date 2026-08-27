import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'

// 剪贴板 API
export async function readClipboardFilePaths(): Promise<string[]> {
  return await invoke('read_clipboard_file_paths')
}

// 文件监听 API
export async function watchDirectory(path: string): Promise<void> {
  await invoke('watch_directory', { path })
}

export async function unwatchDirectory(path: string): Promise<void> {
  await invoke('unwatch_directory', { path })
}

// 平台信息
export async function getPlatform(): Promise<string> {
  return await platform()
}

// 文件夹历史 API
export async function saveFolderHistory(path: string): Promise<void> {
  await invoke('save_folder_history', { path })
}

export async function getLatestFolder(): Promise<string | null> {
  return await invoke('get_latest_folder')
}

export async function getFolderHistory(): Promise<string[]> {
  return await invoke('get_folder_history')
}

export async function removeFolderHistory(path: string): Promise<void> {
  await invoke('remove_folder_history', { path })
}

export async function clearOtherFolderHistory(currentPath: string | null): Promise<void> {
  await invoke('clear_other_folder_history', { currentPath })
}

// macOS Dock 图标 API
export async function setDockIconVisibility(visible: boolean): Promise<void> {
  await invoke('set_dock_icon_visibility', { visible })
}

// 语言设置同步到后端
export async function setAppLocale(locale: string): Promise<void> {
  await invoke('set_app_locale', { locale })
}

// 重启应用（用于需要重新初始化窗口的设置项，如 DevTools 开关）
export async function restartApp(): Promise<void> {
  await invoke('restart_app')
}

// 会话状态 API
export async function saveSessionState(states: Record<string, string>): Promise<void> {
  await invoke('save_session_state', { states })
}

export async function getSessionState(): Promise<Record<string, string>> {
  return await invoke('get_session_state')
}

// 应用设置（session_state 持久化）
const SETTINGS_PREFIX = 'settings.'

export interface AppSettings {
  theme: string
  themeColor: string
  autoStart: string
  autoCheckUpdate: string
  closeWithoutExit: string
  noteWidth: string
  showAllFiles: string
  markdownOnly: string
  syncInterval: string
  autoSyncPush: string
  idleAutoPush: string
  idleAutoPushDelay: string
  customShortcuts: string
  pluginCommandShortcuts: string
  customThemes: string
  activeLightCustomThemeId: string
  activeDarkCustomThemeId: string
  uploadPath: string
  aiProvider: string
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  aiPort: string
  aiModels: string
  activeAiModelId: string
  defaultAiModelId: string
  showConflictBadge: string
  developerMode: string
}

export async function getAppSettings(): Promise<AppSettings> {
  const all = await getSessionState()
  const get = (key: string, fallback: string) => all[SETTINGS_PREFIX + key] ?? fallback
  return {
    theme: get('theme', 'light'),
    themeColor: get('themeColor', '#005fb8'),
    autoStart: get('autoStart', 'false'),
    autoCheckUpdate: get('autoCheckUpdate', 'true'),
    closeWithoutExit: get('closeWithoutExit', 'false'),
    noteWidth: get('noteWidth', 'normal'),
    showAllFiles: get('showAllFiles', 'false'),
    markdownOnly: get('markdownOnly', 'false'),
    syncInterval: get('syncInterval', '10'),
    autoSyncPush: get('autoSyncPush', 'false'),
    idleAutoPush: get('idleAutoPush', 'true'),
    idleAutoPushDelay: get('idleAutoPushDelay', '60'),
    customShortcuts: get('customShortcuts', '{}'),
    pluginCommandShortcuts: get('pluginCommandShortcuts', '{}'),
    customThemes: get('customThemes', '[]'),
    activeLightCustomThemeId: get('activeLightCustomThemeId', 'builtin-light'),
    activeDarkCustomThemeId: get('activeDarkCustomThemeId', 'builtin-dark'),
    uploadPath: get('uploadPath', ''),
    aiProvider: get('aiProvider', ''),
    aiApiKey: get('aiApiKey', ''),
    aiBaseUrl: get('aiBaseUrl', ''),
    aiModel: get('aiModel', ''),
    aiPort: get('aiPort', '4017'),
    aiModels: get('aiModels', '[]'),
    activeAiModelId: get('activeAiModelId', ''),
    defaultAiModelId: get('defaultAiModelId', ''),
    showConflictBadge: get('showConflictBadge', 'true'),
    developerMode: get('developerMode', 'false'),
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(settings).map(
    ([key, value]) => [SETTINGS_PREFIX + key, String(value)] as [string, string]
  )
  await saveSessionState(Object.fromEntries(entries))
}

export async function setAutoStartEnabled(enabled: boolean): Promise<void> {
  // Windows 用自定义命令直接操作注册表，正确引用 exe 路径
  // macOS/Linux 继续用 tauri-plugin-autostart
  const isWindows = await platform() === 'windows'
  if (isWindows) {
    await invoke(enabled ? 'enable_autostart' : 'disable_autostart')
  } else {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart')
    if (enabled) {
      await enable()
    } else {
      await disable()
    }
  }
}

export async function isAutoStartEnabled(): Promise<boolean> {
  const isWindows = await platform() === 'windows'
  if (isWindows) {
    return await invoke<boolean>('is_autostart_enabled')
  }
  const { isEnabled } = await import('@tauri-apps/plugin-autostart')
  return await isEnabled()
}
