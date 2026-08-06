import { invoke } from '@tauri-apps/api/core'

// Types matching Rust backend
export interface FileNode {
  id: string
  name: string
  path: string
  is_directory: boolean
  children?: FileNode[]
}

interface CreateFileRequest {
  path: string
  is_directory: boolean
}

interface RenameFileRequest {
  old_path: string
  new_path: string
}

// Search Types
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

export async function writeBinaryFile(path: string, data: string): Promise<void> {
  await invoke('write_binary_file', { path, data })
}

// 远程图片批量下载

/** 单张远程图片的下载请求。 */
export interface RemoteImageRequest {
  /** 远程图片 URL（http / https） */
  url: string
  /** 落盘目录（绝对路径，由前端解析 uploadPath 规则得到） */
  target_dir: string
  /** 当前文件所在目录（用于计算相对路径） */
  file_dir: string
  /** 工作区根目录（用于计算相对路径的 fallback） */
  root_path: string
  /** 可选的文件名 hint（来自 URL 原文件名，预留扩展） */
  name_hint?: string
}

/** 单张远程图片的下载结果。 */
export interface RemoteImageResult {
  /** 原始 URL */
  url: string
  /** 是否成功 */
  ok: boolean
  /** 写入的绝对路径（仅成功时有值） */
  local_path: string | null
  /** 基于当前文件目录的相对路径（仅成功时有值） */
  relative_path: string | null
  /** 生成的文件名（仅成功时有值） */
  file_name: string | null
  /** 失败信息（仅失败时有值） */
  error: string | null
}

/** 批量下载入参（与后端 DownloadImagesPayload 对应）。 */
export interface DownloadImagesPayload {
  images: RemoteImageRequest[]
}

/**
 * 调用后端 `download_remote_images` 命令批量下载远程图片。
 * 前端不直接下载图片字节，所有下载 / 落盘 / 相对路径计算均由后端完成。
 */
export async function downloadRemoteImages(
  payload: DownloadImagesPayload
): Promise<RemoteImageResult[]> {
  return await invoke<RemoteImageResult[]>('download_remote_images', { payload })
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
