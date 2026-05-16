/**
 * Tauri API utilities
 */
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'

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
  return selected as string | null
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
  return selected as string | null
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return selected
}

export async function saveWorkspaceFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Swallow Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return selected
}

// File System APIs (using Tauri commands)
export async function listDirectory(path: string): Promise<FileNode[]> {
  return await invoke('list_directory', { path })
}

export async function readFile(path: string): Promise<string> {
  return await invoke('read_file', { path })
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_file', { path, content })
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

export async function gitCommitAndPush(path: string, message: string): Promise<void> {
  await invoke('git_commit_and_push', { path, message })
}

export async function gitDiff(path: string, filePath: string): Promise<string> {
  return await invoke('git_diff', { path, filePath })
}

export async function gitLog(path: string, maxCount: number = 50): Promise<string[]> {
  return await invoke('git_log', { path, maxCount })
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

export async function openWorkspaceDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return selected as string | null
}
