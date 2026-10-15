/**
 * 编辑器上传与粘贴处理 hook。
 * 从 MarkdownEditor.tsx 抽出：上传目录解析、文件上传、文件 URL 解析、粘贴处理。
 */
import { useCallback } from 'react'
import { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useUIStore, useEditorStore, useWorkspaceStore } from '@/stores'
import { writeBinaryFile, getHomeDir, readClipboardFilePaths, copyFile } from '@/lib/tauri'
import { resolveMarkdownImagePath } from '@/utils/resolveImagePath'
import { logger } from '@/lib/logger'
import { getFileBlockType } from './editorBlockTransforms'

export function useEditorPasteUpload() {
  const uploadPath = useUIStore((state) => state.uploadPath)
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')

  const resolveUploadDir = useCallback(async (): Promise<string> => {
    const filePath = activeTabPath || ''
    const folder = filePath.split(/[\\/]/).slice(0, -1).join('/')
    const root = rootPath || folder
    let userRoot = ''
    try { userRoot = await getHomeDir() } catch { userRoot = folder }

    if (!uploadPath.trim()) return folder

    const resolved = uploadPath
      .replace(/\$folder/g, folder)
      .replace(/\$rootPath/g, root)
      .replace(/\$userRootPath/g, userRoot)

    return resolved
  }, [uploadPath, rootPath, activeTabPath])

  /** 生成上传目标：目标目录（当前文件所在目录）、唯一文件名与完整路径，由两个上传函数共享 */
  const deriveUploadTarget = useCallback(async (extSource: string): Promise<{
    folder: string
    fileName: string
    fullPath: string
  }> => {
    const filePath = activeTabPath || ''
    const folder = filePath.split(/[\\/]/).slice(0, -1).join('/')
    const uploadDir = await resolveUploadDir()
    const ext = extSource.split('.').pop() || 'bin'
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const fileName = `${timestamp}-${random}.${ext}`
    const fullPath = uploadDir ? `${uploadDir}/${fileName}` : fileName
    return { folder, fileName, fullPath }
  }, [resolveUploadDir, activeTabPath])

  /** 按当前文件目录 → rootPath → 绝对路径的优先级，将上传完整路径换算为 Markdown 相对路径 */
  const toRelativeUrl = useCallback((folder: string, fileName: string, fullPath: string): string => {
    const fileDir = folder || rootPath || ''
    if (fileDir && fullPath.startsWith(fileDir + '/')) {
      // Path relative to the current file's directory
      return './' + fullPath.substring(fileDir.length + 1)
    }
    // Fallback: if fullPath is under rootPath but not under fileDir, use rootPath-relative path
    if (rootPath && fullPath.startsWith(rootPath + '/')) {
      return fullPath.substring(rootPath.length + 1)
    }
    if (fullPath.startsWith('/')) {
      return fileName
    }
    return fullPath
  }, [rootPath])

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const { folder, fileName, fullPath } = await deriveUploadTarget(file.name)

    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    // Chunked Base64 encoding to avoid O(n²) string concatenation
    const CHUNK_SIZE = 8192
    let base64 = ''
    for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
      const chunk = uint8Array.subarray(i, i + CHUNK_SIZE)
      base64 += String.fromCharCode.apply(null, Array.from(chunk))
    }
    base64 = btoa(base64)

    await writeBinaryFile(fullPath, base64)

    // Return relative path based on the current file's directory (Markdown relative path semantics)
    return toRelativeUrl(folder, fileName, fullPath)
  }, [deriveUploadTarget, toRelativeUrl])

  const resolveFileUrl = useCallback(async (url: string): Promise<string> => {
    try {
      const absolutePath = resolveMarkdownImagePath(url, activeTabPath || '', rootPath || '')
      // If the URL was a complete URL or absolute path, resolveMarkdownImagePath returns it as-is;
      // only call convertFileSrc when the url changed (i.e., it was resolved to a local absolute path).
      if (absolutePath === url) {
        return url
      }
      return convertFileSrc(absolutePath)
    } catch {
      return url
    }
  }, [activeTabPath, rootPath])

  /**
   * Upload a file from a local path by copying it to the upload directory.
   * Returns the relative URL for the copied file.
   */
  const uploadFileFromPath = useCallback(async (sourcePath: string): Promise<string> => {
    const { folder, fileName, fullPath } = await deriveUploadTarget(sourcePath)

    // Copy the file from source path to upload directory using Tauri backend
    await copyFile(sourcePath, fullPath)

    // Return relative path based on the current file's directory (same logic as uploadFile)
    return toRelativeUrl(folder, fileName, fullPath)
  }, [deriveUploadTarget, toRelativeUrl])

  /**
   * Custom paste handler that supports:
   * 1. Standard clipboard paste (text, HTML, markdown) - delegates to defaultPasteHandler
   * 2. Image paste from screenshots - delegates to defaultPasteHandler (handles Files MIME type)
   * 3. File paste from system file manager (Cmd+C in Finder then Cmd+V in editor)
   *    - Reads file paths from system clipboard via Tauri backend
   *    - Copies files to upload directory and inserts file blocks
   */
  const pasteHandler = useCallback(({
    event,
    editor: bnEditor,
    defaultPasteHandler,
  }: {
    event: ClipboardEvent
    editor: BlockNoteEditor
    defaultPasteHandler: (context?: {
      prioritizeMarkdownOverHTML?: boolean
      plainTextAsMarkdown?: boolean
    }) => boolean | undefined
  }): boolean | undefined => {
    // Check if the WebView clipboard event contains Files (e.g., screenshot paste)
    // If so, let the default handler deal with it
    const hasFiles = event.clipboardData?.types?.includes('Files')

    if (hasFiles) {
      return defaultPasteHandler()
    }

    // Check if clipboard has text content — if so, delegate to default handler immediately
    // and skip the async file-path check to avoid race conditions where both text and file
    // blocks get inserted when the system clipboard contains both file paths and text.
    const hasText = event.clipboardData?.types?.includes('text/plain') ||
                    event.clipboardData?.types?.includes('text/html')
    if (hasText) {
      return defaultPasteHandler()
    }

    // No Files in WebView clipboard — read system clipboard via Tauri.
    readClipboardFilePaths()
      .then(async (filePaths) => {
        if (filePaths.length > 0) {
          // System clipboard has file paths → insert as file blocks
          // 使用 for...of + await 顺序插入，避免 forEach 并发导致顺序逆序（C,B,A）
          for (const sourcePath of filePaths) {
            try {
              const fileBlockType = getFileBlockType(sourcePath)
              const fileName = sourcePath.split('/').pop() || 'file'

              const currentBlock = bnEditor.getTextCursorPosition().block
              const newBlock = {
                type: fileBlockType,
                props: { name: fileName },
              } as PartialBlock

              let insertedBlockId: string | undefined

              if (
                Array.isArray(currentBlock.content) &&
                currentBlock.content.length === 0
              ) {
                insertedBlockId = bnEditor.updateBlock(currentBlock, newBlock).id
              } else {
                insertedBlockId = bnEditor.insertBlocks(
                  [newBlock],
                  currentBlock,
                  'after',
                )[0].id
              }

              // await 上传完成，确保前一个文件插入完成后再处理下一个
              const url = await uploadFileFromPath(sourcePath)
              if (insertedBlockId) {
                bnEditor.updateBlock(insertedBlockId, {
                  props: { url },
                } as PartialBlock)
              }
            } catch (e) {
              logger.error('markdown-editor', 'Failed to paste file from clipboard:', sourcePath, e)
            }
          }
        }
        // If no file paths found, do nothing — nothing to paste
      })
      .catch(() => {})

    // Return undefined to indicate we handled the paste asynchronously (no default paste)
    return undefined
  }, [uploadFileFromPath])

  return { uploadFile, resolveFileUrl, pasteHandler, resolveUploadDir }
}
