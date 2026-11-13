import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 解析目标路径所属的工作区根（供后端 fs_guard 白名单校验）。
 * - folder 模式：返回当前 rootPath（树内操作与收编前行为一致）
 * - workspace 多根模式：返回包含目标的 folder（目标所属根即其允许根）
 * - 均不匹配返回 null → 后端允许根仅剩 app 数据目录（fail-closed）
 */
export function workspaceRootFor(path: string): string | null {
  const ws = useWorkspaceStore.getState()
  if (ws.rootPath) return ws.rootPath
  const root = ws.workspaceFolders.find((f) => path === f || path.startsWith(f + '/')) ?? null
  // bug-ws-expand-null DEBUG START（临时插桩：定位 workspace 展开被拒根因，fix 后移除）
  logger.warn(
    'file-ops',
    `[bug-ws-expand-null] path=${path} | rootPath=${String(ws.rootPath)} | folders=${JSON.stringify(ws.workspaceFolders)} | resolved=${String(root)}`
  )
  // bug-ws-expand-null DEBUG END
  return root
}

/**
 * 批量路径的允许根：全部路径同属一个 folder 时返回该 folder；
 * 跨 folder 时返回 null，由调用方的 sequential fallback 逐个按各自所属 folder 选根。
 */
function workspaceRootForBatch(paths: string[]): string | null {
  const ws = useWorkspaceStore.getState()
  if (ws.rootPath) return ws.rootPath
  return ws.workspaceFolders.find((f) => paths.every((p) => p === f || p.startsWith(f + '/'))) ?? null
}

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
  return await invoke('get_file_metadata', { path, workspaceRoot: workspaceRootFor(path) })
}

export async function listDirectory(
  path: string,
  showAllFiles?: boolean,
  markdownOnly?: boolean,
  workspaceRootOverride?: string | null,
): Promise<FileNode[]> {
  return await invoke('list_directory', {
    path,
    // 打开工作区流程（loadRoot/addRoot/addRoots）显式传目标自身；树内操作按目标所属根
    workspaceRoot: workspaceRootOverride !== undefined ? workspaceRootOverride : workspaceRootFor(path),
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
  workspaceRootOverride?: string | null,
): Promise<BatchDirResult[]> {
  return await invoke('list_directories_batch', {
    paths,
    // 批量跨 folder 时为 null，调用方 sequential fallback 逐个按各自所属根加载
    workspaceRoot: workspaceRootOverride !== undefined ? workspaceRootOverride : workspaceRootForBatch(paths),
    showAllFiles: showAllFiles ?? false,
    markdownOnly: markdownOnly ?? false,
  })
}

export async function readFile(path: string, workspaceRootOverride?: string | null): Promise<string> {
  return await invoke('read_file', {
    path,
    workspaceRoot: workspaceRootOverride !== undefined ? workspaceRootOverride : workspaceRootFor(path),
  })
}

export async function writeFile(
  path: string,
  content: string,
  workspaceRootOverride?: string | null,
): Promise<void> {
  await invoke('write_file', {
    path,
    content,
    // saveWorkspaceFile 写 .swallow-workspace（位于 folder 外）时显式传所在目录
    workspaceRoot: workspaceRootOverride !== undefined ? workspaceRootOverride : workspaceRootFor(path),
  })
}

export async function writeBinaryFile(path: string, data: string): Promise<void> {
  await invoke('write_binary_file', { path, data, workspaceRoot: workspaceRootFor(path) })
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
  /** 工作区根：后端 fs_guard 白名单校验用（未打开工作区时为空 → fail-closed 拒绝） */
  workspace_root?: string | null
}

/**
 * 调用后端 `download_remote_images` 命令批量下载远程图片。
 * 前端不直接下载图片字节，所有下载 / 落盘 / 相对路径计算均由后端完成。
 * 调用方未显式传 workspace_root 时，此处注入当前工作区根供后端校验。
 */
export async function downloadRemoteImages(
  payload: DownloadImagesPayload
): Promise<RemoteImageResult[]> {
  return await invoke<RemoteImageResult[]>('download_remote_images', {
    // 落盘目录所属的根作为允许根（同一批图片通常同属一个 folder）
    payload: { ...payload, workspace_root: payload.workspace_root ?? workspaceRootFor(payload.images[0]?.target_dir ?? '') },
  })
}

export async function getHomeDir(): Promise<string> {
  return await invoke('get_home_dir')
}

export async function createFile(path: string, isDirectory: boolean): Promise<string> {
  const req: CreateFileRequest = { path, is_directory: isDirectory }
  return await invoke('create_file', { req, workspaceRoot: workspaceRootFor(path) })
}

export async function deleteFile(path: string): Promise<void> {
  await invoke('delete_file', { path, workspaceRoot: workspaceRootFor(path) })
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const req: RenameFileRequest = { old_path: oldPath, new_path: newPath }
  await invoke('rename_file', { req, workspaceRoot: workspaceRootFor(oldPath) })
}

export async function copyFile(srcPath: string, dstPath: string): Promise<void> {
  const req: RenameFileRequest = { old_path: srcPath, new_path: dstPath }
  await invoke('copy_file', { req, workspaceRoot: workspaceRootFor(srcPath) })
}

/** 在系统文件管理器中定位（文件）/打开（目录），按目标路径所属的工作区根过 fs_guard 白名单 */
export async function openInFinder(path: string): Promise<void> {
  await invoke('open_in_finder', { path, workspaceRoot: workspaceRootFor(path) })
}

/** 导出文本到用户经 save dialog 选择的路径（后端唯一放行工作区外写入的命令） */
export async function exportTextFile(path: string, content: string): Promise<void> {
  await invoke('export_text_file', { path, content })
}

/** 运行期把目录加入 asset protocol 允许列表（笔记本地图片显示，B4 收敛后必需） */
export async function registerAssetScope(path: string): Promise<void> {
  await invoke('register_asset_scope', { path })
}

export async function searchInFiles(req: SearchRequest): Promise<SearchResult[]> {
  return await invoke('search_in_files', { req, workspaceRoot: workspaceRootFor(req.root_path) })
}

/** 保存 .md 后同步解析 frontmatter 并更新索引表（fs_guard 白名单校验） */
export async function indexSavedFile(path: string): Promise<void> {
  await invoke('index_saved_file', { path, workspaceRoot: workspaceRootFor(path) })
}
