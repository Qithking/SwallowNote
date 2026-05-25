/**
 * API Adapter - Converts between frontend and backend types
 */
import { listDirectory, readFile, writeFile, createFile, deleteFile, renameFile, listDirectoriesBatch, FileNode as BackendFileNode, BatchDirResult as BackendBatchDirResult } from './tauri'

// Convert backend snake_case to frontend camelCase
export interface FileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isExpanded?: boolean
}

function convertFileNode(node: BackendFileNode): FileNode {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    isDirectory: node.is_directory,
    children: node.children?.map(convertFileNode),
  }
}

export async function loadDirectory(
  path: string,
  showAllFiles?: boolean,
  markdownOnly?: boolean,
): Promise<FileNode[]> {
  const nodes = await listDirectory(path, showAllFiles, markdownOnly)
  return nodes.map(convertFileNode)
}

export interface BatchDirResult {
  path: string
  children: FileNode[]
}

export async function loadDirectoriesBatch(
  paths: string[],
  showAllFiles?: boolean,
  markdownOnly?: boolean,
): Promise<BatchDirResult[]> {
  const results = await listDirectoriesBatch(paths, showAllFiles, markdownOnly)
  return results.map((r: BackendBatchDirResult) => ({
    path: r.path,
    children: r.children.map(convertFileNode),
  }))
}

export async function loadFileContent(path: string): Promise<string> {
  return await readFile(path)
}

export async function saveFileContent(path: string, content: string): Promise<void> {
  await writeFile(path, content)
}

export async function createNewFile(path: string, isDirectory: boolean): Promise<string> {
  return await createFile(path, isDirectory)
}

export async function removeFile(path: string): Promise<void> {
  await deleteFile(path)
}

export async function renameExistingFile(oldPath: string, newPath: string): Promise<void> {
  await renameFile(oldPath, newPath)
}
