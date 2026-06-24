/**
 * Tauri API utilities
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'

// 路径分隔符统一为正斜杠
function normalizePath(path: string | null): string | null {
  if (!path) return null
  return path.replace(/\\/g, '/')
}

// Types matching Rust backend
export interface FileNode {
  id: string
  name: string
  path: string
  is_directory: boolean
  children?: FileNode[]
}

export interface GitStatus {
  branch: string
  modified: string[]
  added: string[]
  deleted: string[]
  untracked: string[]
}

interface CreateFileRequest {
  path: string
  is_directory: boolean
}

interface RenameFileRequest {
  old_path: string
  new_path: string
}

// Search types
export interface SearchRequest {
  query: string
  root_path: string
  case_sensitive: boolean
  whole_word: boolean
  use_regex: boolean
  include_files: string | null
  exclude_files: string | null
}

export interface LineMatch {
  line_number: number
  content: string
  start_col: number
  end_col: number
}

export interface SearchResult {
  file_path: string
  file_name: string
  line_matches: LineMatch[]
}

// Dialog APIs
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  })
  return normalizePath(selected as string | null)
}

export async function openFileDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

export async function saveWorkspaceFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Swallow Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

// .zip 过滤的保存对话框
export async function savePluginConfigsDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath: defaultPath ?? 'swallownote-plugin-configs.zip',
    filters: [
      { name: 'Zip archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

/**
 * Open dialog filtered to `.zip` for the plugin-configs import.
 * Multiple selection is disabled — a bundle is a single archive.
 */
export async function openPluginConfigsDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Zip archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

// File System APIs (using Tauri commands)
export async function pathExists(path: string): Promise<boolean> {
  return await invoke('path_exists', { path })
}

export interface FileMetadata {
  modified_time: string
  file_size: number
}

export async function getFileMetadata(path: string): Promise<FileMetadata> {
  return await invoke('get_file_metadata', { path })
}

export async function listDirectory(
  path: string,
  showAllFiles?: boolean,
  markdownOnly?: boolean,
): Promise<FileNode[]> {
  return await invoke('list_directory', {
    path,
    showAllFiles: showAllFiles ?? false,
    markdownOnly: markdownOnly ?? false,
  })
}

export interface BatchDirResult {
  path: string
  children: FileNode[]
}

export async function listDirectoriesBatch(
  paths: string[],
  showAllFiles?: boolean,
  markdownOnly?: boolean,
): Promise<BatchDirResult[]> {
  return await invoke('list_directories_batch', {
    paths,
    showAllFiles: showAllFiles ?? false,
    markdownOnly: markdownOnly ?? false,
  })
}

export async function readFile(path: string): Promise<string> {
  return await invoke('read_file', { path })
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_file', { path, content })
}

// 返回插件 storage.json 的绝对路径
export async function getPluginStoragePath(pluginId: string): Promise<string> {
  return await invoke('get_plugin_storage_path', { pluginId })
}

// ── Plugin settings（SQLite 后端）──

/** Mirrors the Rust `PluginSettingsView`. */
export interface PluginSettingsView {
  exists: boolean
  values: Record<string, unknown>
  schema: PluginSettingsSchema | null
}

/** Mirrors the Rust `SettingsSchema`. */
export interface PluginSettingsSchema {
  version: number
  title?: string
  description?: string
  fields: PluginSettingsField[]
}

export type PluginSettingsFieldType =
  | 'string'
  | 'string-multiline'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'directory'
  | 'password'

export interface PluginSettingsFieldOption {
  value: unknown
  label: string
}

/** 条件可见性谓词：当 values[key] === equals 时显示字段。 */
export interface PluginSettingsVisibleWhen {
  key: string
  equals: unknown
}

export interface PluginSettingsField {
  key: string
  type: PluginSettingsFieldType
  label: string
  default?: unknown
  required?: boolean
  secret?: boolean
  placeholder?: string
  options?: PluginSettingsFieldOption[]
  visibleWhen?: PluginSettingsVisibleWhen
}

export async function readPluginSettings(
  pluginId: string
): Promise<PluginSettingsView> {
  return await invoke<PluginSettingsView>('read_plugin_settings', {
    pluginId,
  })
}

export async function writePluginSettings(
  pluginId: string,
  values: Record<string, unknown>
): Promise<void> {
  await invoke('write_plugin_settings', { args: { pluginId, values } })
}

export async function deletePluginSettings(pluginId: string): Promise<void> {
  await invoke('delete_plugin_settings', { pluginId })
}

// ── Market source management ──────────────────────────────
export interface MarketSourceView {
  name: string
  url: string
  is_active: boolean
}

export async function listMarketSources(): Promise<MarketSourceView[]> {
  return await invoke<MarketSourceView[]>('list_market_sources')
}

export async function addMarketSource(name: string, url: string): Promise<void> {
  await invoke('add_market_source', { name, url })
}

export async function removeMarketSource(url: string): Promise<void> {
  await invoke('remove_market_source', { url })
}

export async function setActiveMarketSource(url: string): Promise<void> {
  await invoke('set_active_market_source', { url })
}

export async function getActiveMarketSource(): Promise<MarketSourceView | null> {
  return await invoke<MarketSourceView | null>('get_active_market_source')
}

// 启动时 seed 存储大小计数器
export async function getAllPluginStorageSizes(): Promise<Record<string, number>> {
  const raw = await invoke<Record<string, number>>('get_all_plugin_storage_sizes')
  return raw ?? {}
}

// 查询宿主卷真实可用字节。失败返回 null
export async function getStorageCap(): Promise<number | null> {
  try {
    const raw = await invoke<number>('get_storage_cap')
    if (typeof raw !== 'number' || raw <= 0) return null
    return raw
  } catch (err) {
    // 记录错误便于调试
    console.warn(
      '[plugin-storage] getStorageCap() failed — storage meter will show "cap unknown". ' +
        'If this is unexpected, try rebuilding the host binary (cargo tauri dev).',
      err,
    )
    return null
  }
}

// stat 单个插件 storage.json 大小
export async function getPluginStorageSize(pluginId: string): Promise<number> {
  try {
    const path = await getPluginStoragePath(pluginId)
    const meta = await invoke<{ file_size: number }>('get_file_metadata', { path })
    return meta?.file_size ?? 0
  } catch {
    // 插件可能已卸载或尚未写入
    return 0
  }
}

export async function writeBinaryFile(path: string, data: string): Promise<void> {
  await invoke('write_binary_file', { path, data })
}

export async function getHomeDir(): Promise<string> {
  return await invoke('get_home_dir')
}

export async function createFile(path: string, isDirectory: boolean): Promise<string> {
  const req: CreateFileRequest = { path, is_directory: isDirectory }
  return await invoke('create_file', { req })
}

export async function deleteFile(path: string): Promise<void> {
  await invoke('delete_file', { path })
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const req: RenameFileRequest = { old_path: oldPath, new_path: newPath }
  await invoke('rename_file', { req })
}

export async function copyFile(srcPath: string, dstPath: string): Promise<void> {
  const req: RenameFileRequest = { old_path: srcPath, new_path: dstPath }
  await invoke('copy_file', { req })
}

export async function searchInFiles(req: SearchRequest): Promise<SearchResult[]> {
  return await invoke('search_in_files', { req })
}

// Git APIs
export async function gitInit(path: string): Promise<void> {
  await invoke('git_init', { path })
}

export async function gitStatus(path: string): Promise<GitStatus> {
  return await invoke('git_status', { path })
}

export async function gitCommit(path: string, message: string): Promise<void> {
  await invoke('git_commit', { path, message })
}

export async function gitPush(path: string): Promise<void> {
  await invoke('git_push', { path })
}

export async function gitPushWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_push_with_credentials', { path, username, password })
}

export async function gitCommitAndPush(path: string, message: string): Promise<void> {
  await invoke('git_commit_and_push', { path, message })
}

export async function gitPull(path: string): Promise<void> {
  await invoke('git_pull', { path })
}

export async function gitPullWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_pull_with_credentials', { path, username, password })
}

export async function gitForcePush(path: string): Promise<void> {
  await invoke('git_force_push', { path })
}

export async function gitForcePushWithCredentials(path: string, username: string, password: string): Promise<void> {
  await invoke('git_force_push_with_credentials', { path, username, password })
}

export async function gitForcePull(path: string): Promise<void> {
  await invoke('git_force_pull', { path })
}

// Conflict resolution APIs
export interface ConflictFile {
  path: string
  abs_path: string
}

export async function gitGetConflictFiles(repoPath: string): Promise<ConflictFile[]> {
  return await invoke('git_get_conflict_files', { repoPath })
}

export async function gitGetConflictLocalContent(repoPath: string, filePath: string): Promise<string> {
  return await invoke('git_get_conflict_local_content', { repoPath, filePath })
}

export async function gitGetConflictRemoteContent(repoPath: string, filePath: string): Promise<string> {
  return await invoke('git_get_conflict_remote_content', { repoPath, filePath })
}

export async function gitResolveConflictFile(repoPath: string, filePath: string, side: string): Promise<void> {
  await invoke('git_resolve_conflict_file', { repoPath, filePath, side })
}

export async function gitSaveConflictFileContent(repoPath: string, filePath: string, content: string): Promise<void> {
  await invoke('git_save_conflict_file_content', { repoPath, filePath, content })
}

export async function gitAbortConflict(repoPath: string): Promise<void> {
  await invoke('git_abort_conflict', { repoPath })
}

// Conflict Repo Record APIs (persistent conflict state)
export interface ConflictRepoRecord {
  repo_path: string
  repo_name: string
  conflict_file_count: number
  detected_at: string
  updated_at: string
}

export async function getConflictRepoRecords(): Promise<ConflictRepoRecord[]> {
  return await invoke('get_conflict_repo_records')
}

export async function removeConflictRepoRecord(repoPath: string): Promise<void> {
  await invoke('remove_conflict_repo_record', { repoPath })
}

export async function syncConflictRepoRecords(
  conflictRepos: [string, string, number][] // [repo_path, repo_name, file_count][]
): Promise<ConflictRepoRecord[]> {
  return await invoke('sync_conflict_repo_records', { conflictRepos })
}

export async function checkAndUpdateConflictRepo(
  repoPath: string,
  repoName: string
): Promise<number> {
  return await invoke('check_and_update_conflict_repo', { repoPath, repoName })
}

// Word Diff API (computed in Rust via similar crate)
export interface WordDiffPart {
  value: string
  removed: boolean
  added: boolean
}

export interface WordDiffResult {
  old_parts: WordDiffPart[]
  new_parts: WordDiffPart[]
}

export async function computeWordDiff(oldText: string, newText: string): Promise<WordDiffResult> {
  return await invoke('compute_word_diff', { oldText, newText })
}

// Git Keyring Credential APIs
export interface GitCredential {
  username: string
  password: string
}

export async function gitCredentialSave(repoPath: string, username: string, password: string): Promise<void> {
  await invoke('git_credential_save', { repoPath, username, password })
}

export async function gitCredentialGet(repoPath: string): Promise<GitCredential | null> {
  return await invoke('git_credential_get', { repoPath })
}

export async function gitCredentialDelete(repoPath: string): Promise<void> {
  await invoke('git_credential_delete', { repoPath })
}

export async function gitAutoCommit(filePath: string): Promise<void> {
  await invoke('git_auto_commit', { filePath })
}

export async function gitDiff(path: string, filePath: string): Promise<string> {
  return await invoke('git_diff', { path, filePath })
}

export async function gitLog(path: string, maxCount: number = 50): Promise<string[]> {
  return await invoke('git_log', { path, maxCount })
}

export async function gitClone(url: string, localPath: string): Promise<string> {
  return await invoke('git_clone', { url, localPath })
}

export async function gitCloneWithCredentials(url: string, localPath: string, username: string, password: string): Promise<string> {
  return await invoke('git_clone_with_credentials', { url, localPath, username, password })
}

export async function gitCloneCancel(): Promise<boolean> {
  return await invoke('git_clone_cancel')
}

export interface GitCloneStatus {
  pid: number | null
  url: string
  local_path: string
}

export async function gitCloneStatus(): Promise<GitCloneStatus> {
  return await invoke('git_clone_status')
}

export interface GitFileLogEntry {
  hash: string
  message: string
  date: string
  insertions: number
  deletions: number
}

export async function gitFileLog(filePath: string, maxCount: number = 50, skip: number = 0): Promise<GitFileLogEntry[]> {
  return await invoke('git_file_log', { filePath, maxCount, skip })
}

export async function gitShowDiff(filePath: string, commitHash: string): Promise<string> {
  return await invoke('git_show_diff', { filePath, commitHash })
}

export async function gitShowFileContent(filePath: string, commitHash: string): Promise<string> {
  return await invoke('git_show_file_content', { filePath, commitHash })
}

export async function gitPullFileLatest(filePath: string): Promise<string> {
  return await invoke('git_pull_file_latest', { filePath })
}

export async function gitForceUploadFile(filePath: string): Promise<void> {
  await invoke('git_force_upload_file', { filePath })
}

export async function isGitRepository(path: string): Promise<boolean> {
  return await invoke('git_is_repo', { path })
}

export interface GitRepositoryInfo {
  name: string
  path: string
  remote_url: string | null
  has_uncommitted_changes: boolean
  uncommitted_count: number
  current_branch: string
  is_submodule: boolean
  parent_path: string | null
}

export async function scanGitRepos(rootPath: string): Promise<GitRepositoryInfo[]> {
  return await invoke('scan_git_repos', { rootPath })
}

// Clipboard APIs
export async function readClipboardFilePaths(): Promise<string[]> {
  return await invoke('read_clipboard_file_paths')
}

// File watcher APIs
export async function watchDirectory(path: string): Promise<void> {
  await invoke('watch_directory', { path })
}

export async function unwatchDirectory(path: string): Promise<void> {
  await invoke('unwatch_directory', { path })
}

// Platform info
export async function getPlatform(): Promise<string> {
  return await platform()
}

// Folder History APIs
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

// macOS Dock Icon APIs
export async function setDockIconVisibility(visible: boolean): Promise<void> {
  await invoke('set_dock_icon_visibility', { visible })
}

// Locale API - sync frontend language setting to backend
export async function setAppLocale(locale: string): Promise<void> {
  await invoke('set_app_locale', { locale })
}

// Session State APIs
export async function saveSessionState(states: Record<string, string>): Promise<void> {
  await invoke('save_session_state', { states })
}

export async function getSessionState(): Promise<Record<string, string>> {
  return await invoke('get_session_state')
}

// App Settings (persisted via session_state)
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
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(settings).map(
    ([key, value]) => [SETTINGS_PREFIX + key, String(value)] as [string, string]
  )
  await saveSessionState(Object.fromEntries(entries))
}

export async function setAutoStartEnabled(enabled: boolean): Promise<void> {
  const { enable, disable } = await import('@tauri-apps/plugin-autostart')
  if (enabled) {
    await enable()
  } else {
    await disable()
  }
}

export async function openWorkspaceDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

export async function checkLatestVersion(): Promise<{ latest: string; current: string; hasUpdate: boolean } | null> {
  try {
    const packageJson = await import('../../package.json')
    const current = packageJson.default.version
    // Use the Rust backend to check the latest version.
    // This avoids CORS errors and 504 gateway timeouts that occur when the
    // browser directly fetches from api.github.com (especially behind a proxy).
    const [latest, hasUpdate] = await invoke<[string, boolean]>('check_latest_version', { currentVersion: current })
    return { latest, current, hasUpdate }
  } catch (e) {
    console.error('Failed to check latest version:', e)
    return null
  }
}

export interface DownloadProgress {
  progress: number
  downloaded: number
  total: number
}

export interface DownloadComplete {
  path: string
}

export function downloadLatestRelease(
  onProgress: (progress: DownloadProgress) => void,
  onComplete: (path: string) => void,
  onError: (error: string) => void
): () => void {
  let unlistenProgress: (() => void) | null = null
  let unlistenComplete: (() => void) | null = null
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    unlistenProgress?.()
    unlistenComplete?.()
  }

  listen<DownloadProgress>('download-progress', (event) => {
    onProgress(event.payload)
  }).then((fn) => {
    if (cleanedUp) { fn() } else { unlistenProgress = fn }
  })

  listen<DownloadComplete>('download-complete', (event) => {
    onComplete(event.payload.path)
    cleanup()
  }).then((fn) => {
    if (cleanedUp) { fn() } else { unlistenComplete = fn }
  })

  invoke('download_latest_release').catch((e) => {
    onError(String(e))
    cleanup()
  })

  return cleanup
}

export async function openInstaller(path: string): Promise<void> {
  await invoke('open_installer', { path })
}

export async function installAndRestart(dmgPath: string): Promise<void> {
  await invoke('install_and_restart', { dmgPath })
}

// AI APIs
export async function encryptApiKey(plaintext: string): Promise<string> {
  return await invoke('encrypt_api_key', { plaintext })
}

export async function decryptApiKey(encrypted: string): Promise<string> {
  return await invoke('decrypt_api_key', { encrypted })
}

export async function startAiProxy(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<number> {
  return await invoke('start_ai_proxy_cmd', { provider, apiKey, baseUrl, model, port })
}

export async function stopAiProxy(): Promise<void> {
  await invoke('stop_ai_proxy')
}

export async function restartAiProxy(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<number> {
  return await invoke('restart_ai_proxy_cmd', { provider, apiKey, baseUrl, model, port })
}

export async function testAiModel(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<string> {
  return await invoke('test_ai_model_cmd', { provider, apiKey, baseUrl, model, port })
}

export interface AiChatMessage {
  id: number
  role: string
  content: string
  model_id: string
  created_at: string
}

export async function saveAiMessage(
  role: string,
  content: string,
  modelId: string,
): Promise<number> {
  return await invoke('save_ai_message', { role, content, modelId })
}

export async function loadAiMessages(
  beforeId?: number,
  limit?: number,
): Promise<AiChatMessage[]> {
  return await invoke('load_ai_messages', { beforeId, limit })
}

export async function clearAiMessages(): Promise<void> {
  await invoke('clear_ai_messages')
}

export interface AiRolePrompt {
  id: number
  role_key: string
  name: string
  prompt: string
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export async function loadAiRolePrompts(): Promise<AiRolePrompt[]> {
  return await invoke('load_ai_role_prompts')
}

export async function getAiRolePrompt(roleKey: string): Promise<AiRolePrompt | null> {
  return await invoke('get_ai_role_prompt', { roleKey })
}

export async function updateAiRolePrompt(roleKey: string, prompt: string): Promise<void> {
  await invoke('update_ai_role_prompt', { roleKey, prompt })
}

export async function addAiRolePrompt(roleKey: string, name: string, prompt: string): Promise<AiRolePrompt> {
  return await invoke('add_ai_role_prompt', { roleKey, name, prompt })
}

export async function deleteAiRolePrompt(roleKey: string): Promise<void> {
  await invoke('delete_ai_role_prompt', { roleKey })
}

export async function updateAiRolePromptName(roleKey: string, name: string): Promise<void> {
  await invoke('update_ai_role_prompt_name', { roleKey, name })
}

export async function resetAiRolePrompt(roleKey: string): Promise<AiRolePrompt> {
  return await invoke('reset_ai_role_prompt', { roleKey })
}

export interface BuiltinAiModel {
  id: string
  name: string
  category: string
  provider: string
  api_key: string
  base_url: string
  model: string
  is_built_in: boolean
}

export async function getBuiltinAiModels(): Promise<BuiltinAiModel[]> {
  return await invoke('get_builtin_ai_models')
}

// ── Plugin APIs ────────────────────────────────────────────────────────────────

export interface PluginMetadataRust {
  id: string
  name: string
  description: string
  version: string
  author: string
  published_at: string
  /**
   * Where to show the plugin's icon. `null` / `undefined`
   * means the plugin has no UI surface (e.g. a file-format
   * editor that's only triggered by opening the matching
   * file). The host's `buildRegistry` skips the plugin in
   * that case, but the plugin's other capabilities
   * (`editorFileExtensions`, lifecycle hooks, settings, …)
   * are still honoured.
   */
  icon_position: string | null
  /**
   * Where to show the plugin's panel content. Optional for
   * the same reason as `icon_position`.
   */
  content_position: string | null
  order: number
  enabled: boolean
  plugin_path: string
  has_backend: boolean
  // 是否随附 settings.json schema
  has_settings_schema: boolean
  /** The repo URL this plugin was installed from. Empty for local zip uploads. */
  source: string
}

/** Scan the plugins directory and return metadata for each plugin */
export async function scanPlugins(): Promise<PluginMetadataRust[]> {
  return await invoke('scan_plugins')
}

// 安装 .zip 插件。expectedSha256 可选完整性校验，source 可选来源仓库 URL
export async function installPlugin(
  zipPath: string,
  expectedSha256?: string,
  source?: string
): Promise<PluginMetadataRust> {
  return await invoke('install_plugin', { zipPath, expectedSha256, source })
}

/** Uninstall a plugin by id */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  return await invoke('uninstall_plugin', { pluginId })
}

/** Enable or disable a plugin */
export async function togglePluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return await invoke('toggle_plugin_enabled', { pluginId, enabled })
}

// 杀掉插件后端子进程。uninstall 前调用以释放文件句柄
export async function killPlugin(pluginId: string): Promise<boolean> {
  return await invoke<boolean>('kill_plugin', { pluginId })
}

// 单插件导入结果：status 为 ok/missing/error
export interface PluginConfigImportEntry {
  plugin_id: string
  status: 'ok' | 'missing' | 'error'
  message: string
}

/** Outcome of an `importPluginConfigs` call. */
export interface PluginConfigImportResult {
  swallow_version: string
  schema_version: number
  plugin_count: number
  /** Number of storages successfully written. */
  imported: number
  /** Number of entries that were skipped (missing / error). */
  skipped: number
  entries: PluginConfigImportEntry[]
}

/** Manifest at the root of an export bundle. */
export interface ExportManifest {
  schema_version: number
  swallow_version: string
  exported_at: string
  plugin_count: number
  plugin_ids: string[]
}

// 将所有插件 storage.json 打包为 zip
export async function exportPluginConfigs(destPath: string): Promise<ExportManifest> {
  return await invoke<ExportManifest>('export_plugin_configs', { destPath })
}

// 导入插件配置 zip 并合并
export async function importPluginConfigs(srcPath: string): Promise<PluginConfigImportResult> {
  return await invoke<PluginConfigImportResult>('import_plugin_configs', { srcPath })
}
