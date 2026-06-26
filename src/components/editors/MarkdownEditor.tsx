/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { BlockNoteEditor, PartialBlock, createCodeBlockSpec, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { codeBlockOptions } from '@blocknote/code-block'
import { TextSelection } from 'prosemirror-state'
import { useUIStore, useEditorStore, useEditorSettingsStore, useWorkspaceStore } from '@/stores'
import { registerFlushFn } from '@/lib/editor-flush'
import { ScrollArea } from '@/components/ui/scroll-area'
import { compactMarkdown } from '@/utils/compact-markdown'
import { stripFrontmatter } from '@/lib/utils/frontmatter'
import { buildTableOfContents } from '@/utils/tableOfContents'
import { writeBinaryFile, getHomeDir, readClipboardFilePaths, copyFile } from '@/lib/tauri'
import { downloadCoordinator } from '@/lib/download-coordinator'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Network, Sigma } from 'lucide-react'
import { EditorContextMenu } from './EditorContextMenu'
import { MermaidBlockSpec, transformMermaidBlocks, MERMAID_BLOCK_TYPE } from './mermaidBlockSpec'
import {
  KatexBlockSpec,
  transformKatexBlocks,
  KATEX_BLOCK_TYPE,
} from './katexBlockSpec'
import {
  MarkmapBlockSpec,
  transformMarkmapBlocks,
  MARKMAP_BLOCK_TYPE,
} from './markmapBlockSpec'
import '@blocknote/mantine/style.css'

interface MarkdownEditorProps {
  content: string
  onChange?: (content: string) => void
}

/** Inner editor — mounts only after blocks are parsed. */
function BlockNoteInner({
  blocks,
  onChange,
}: {
  blocks: PartialBlock[]
  onChange?: (content: string) => void
}) {
  const uploadPath = useUIStore((state) => state.uploadPath)
  const { rootPath } = useWorkspaceStore()
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')
  const activeTabName = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.name ?? '')
  const { t } = useTranslation()
  const {
    widePaddingVertical,
    widePaddingHorizontal,
  } = useEditorSettingsStore()
  const noteWidth = useUIStore((state) => state.noteWidth)

  const editorContainerRef = useRef<HTMLDivElement>(null)
  // Cache the last onChange result so getFullContent can return it synchronously
  const lastContentRef = useRef<string>('')

  useEffect(() => {
    if (noteWidth !== 'wide') return
    const apply = () => {
      const container = editorContainerRef.current
      if (!container) return
      const scrollArea = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (!scrollArea) return
      scrollArea.style.paddingTop = `${widePaddingVertical}px`
      scrollArea.style.paddingBottom = `${widePaddingVertical}px`
      scrollArea.style.paddingLeft = `${widePaddingHorizontal}px`
      scrollArea.style.paddingRight = `${widePaddingHorizontal}px`
    }
    const timer = setTimeout(apply, 100)
    return () => clearTimeout(timer)
  }, [noteWidth, widePaddingVertical, widePaddingHorizontal])

  // codeBlock from @blocknote/code-block provides syntax highlighting via Shiki
  // In newer versions, we need to create the code block spec using createCodeBlockSpec
  // Using type assertion to resolve shiki types conflict
  // Memoized via useMemo to avoid recreating on every render
  const codeBlock = useMemo(() => createCodeBlockSpec(codeBlockOptions as any), [])

  // Create a custom schema that includes the default blocks plus the mermaid block
  // Memoized via useMemo to avoid recreating on every render
  const schema = useMemo(() => BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      mermaidBlock: MermaidBlockSpec(),
      katexBlock: KatexBlockSpec(),
      markmapBlock: MarkmapBlockSpec(),
    } as any,
  }), [])

  const resolveUploadDir = async (): Promise<string> => {
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
  }

  const uploadFile = async (file: File): Promise<string> => {
    const filePath = activeTabPath || ''
    const folder = filePath.split(/[\\/]/).slice(0, -1).join('/')
    const uploadDir = await resolveUploadDir()
    const ext = file.name.split('.').pop() || 'bin'
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const fileName = `${timestamp}-${random}.${ext}`
    const fullPath = uploadDir ? `${uploadDir}/${fileName}` : fileName

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
  }
  
  const resolveFileUrl = async (url: string): Promise<string> => {
    try {
      // Skip URLs that are already fully qualified
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('asset://')) {
        return url
      }

      let absolutePath: string

      // If the URL is already an absolute path (starts with / on Unix or drive letter on Windows)
      if (url.startsWith('/') || /^[a-zA-Z]:/.test(url)) {
        absolutePath = url
      } else {
        // Resolve relative path based on the current file's directory
        const filePath = activeTabPath || ''
        const fileDir = filePath.split(/[\\/]/).slice(0, -1).join('/') || rootPath || ''

        if (!fileDir) {
          return url
        }

        // Normalize: remove leading ./ from relative path
        const normalizedUrl = url.replace(/^\.\//, '')

        // Handle ../ by resolving path segments
        const urlParts = normalizedUrl.split('/')
        const dirParts = fileDir.split('/')

        for (const part of urlParts) {
          if (part === '..') {
            dirParts.pop()
          } else if (part && part !== '.') {
            dirParts.push(part)
          }
        }

        absolutePath = dirParts.join('/')
      }

      return convertFileSrc(absolutePath)
    } catch {
      return url
    }
  }

  /**
   * Upload a file from a local path by copying it to the upload directory.
   * Returns the relative URL for the copied file.
   */
  const uploadFileFromPath = async (sourcePath: string): Promise<string> => {
    const filePath = activeTabPath || ''
    const folder = filePath.split(/[\\/]/).slice(0, -1).join('/')
    const uploadDir = await resolveUploadDir()
    const ext = sourcePath.split('.').pop() || 'bin'
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const fileName = `${timestamp}-${random}.${ext}`
    const fullPath = uploadDir ? `${uploadDir}/${fileName}` : fileName

    // Copy the file from source path to upload directory using Tauri backend
    await copyFile(sourcePath, fullPath)

    // Return relative path based on the current file's directory (same logic as uploadFile)
    const fileDir = folder || rootPath || ''
    if (fileDir && fullPath.startsWith(fileDir + '/')) {
      return './' + fullPath.substring(fileDir.length + 1)
    }
    if (rootPath && fullPath.startsWith(rootPath + '/')) {
      return fullPath.substring(rootPath.length + 1)
    }
    if (fullPath.startsWith('/')) {
      return fileName
    }
    return fullPath
  }

  /**
   * Determine the file block type based on file extension/MIME type.
   * Returns 'image' for image files, 'video' for video files, 'audio' for audio files, 'file' otherwise.
   */
  const getFileBlockType = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']
    const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v']
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']

    if (imageExts.includes(ext)) return 'image'
    if (videoExts.includes(ext)) return 'video'
    if (audioExts.includes(ext)) return 'audio'
    return 'file'
  }

  /**
   * Custom paste handler that supports:
   * 1. Standard clipboard paste (text, HTML, markdown) - delegates to defaultPasteHandler
   * 2. Image paste from screenshots - delegates to defaultPasteHandler (handles Files MIME type)
   * 3. File paste from system file manager (Cmd+C in Finder then Cmd+V in editor)
   *    - Reads file paths from system clipboard via Tauri backend
   *    - Copies files to upload directory and inserts file blocks
   */
  const pasteHandler = ({
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
      .then((filePaths) => {
        if (filePaths.length > 0) {
          // System clipboard has file paths → insert as file blocks
          filePaths.forEach((sourcePath) => {
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

              uploadFileFromPath(sourcePath).then((url) => {
                if (insertedBlockId) {
                  bnEditor.updateBlock(insertedBlockId, {
                    props: { url },
                  } as PartialBlock)
                }
              })
            } catch (e) {
              console.error('Failed to paste file from clipboard:', sourcePath, e)
            }
          })
        }
        // If no file paths found, do nothing — nothing to paste
      })
      .catch(() => {})

    // Return undefined to indicate we handled the paste asynchronously (no default paste)
    return undefined
  }

  const editor = useCreateBlockNote({
    initialContent: blocks,
    schema,
    codeBlock,
    uploadFile,
    resolveFileUrl,
    pasteHandler,
  })


  // 滚动到指定行
  const doScrollToLine = (lineNumber: number) => {
    if (!editor) return
    try {
      // 将行号转换为 block 索引（行号从1开始，数组索引从0开始）
      const blockIndex = Math.max(0, Math.min(lineNumber - 1, editor.document.length - 1))
      const block = editor.document[blockIndex]
      if (block) {
        doScrollToBlockId(block.id)
      }
    } catch (e) {
      console.error('Failed to scroll to line:', e)
    }
  }


  // 根据 block ID 滚动到指定位置，可选通过文本内容查找
  const doScrollToBlockId = (blockId: string, fallbackText?: string) => {
    if (!editor) return
    try {
      const editorContainer = document.querySelector('.blocknote-editor-container')
      if (!editorContainer) return

      let targetElement = editorContainer.querySelector(`[data-node-type="blockContainer"][data-id="${blockId}"]`)

      if (!targetElement && fallbackText) {
        const allBlocks = editorContainer.querySelectorAll(`[data-node-type="blockContainer"]`)
        for (const block of allBlocks) {
          const textContent = block.textContent?.trim() || ''
          if (textContent === fallbackText.trim()) {
            targetElement = block as HTMLElement
            break
          }
        }
      }

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        console.warn('Block element not found:', blockId, 'fallback:', fallbackText)
      }
    } catch (e) {
      console.error('Failed to scroll to block:', e)
    }
  }

  // 监听滚动到行事件
  useEffect(() => {
    let cancelled = false
    const handler = (e: Event) => {
      if (cancelled) return
      const line = (e as CustomEvent).detail.line
      doScrollToLine(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => {
      cancelled = true
      window.removeEventListener('scroll-to-line', handler)
    }
  }, [editor])

  // 监听滚动到 block ID 事件
  useEffect(() => {
    let cancelled = false
    const handler = (e: Event) => {
      if (cancelled) return
      const { blockId, fallbackText } = (e as CustomEvent).detail
      doScrollToBlockId(blockId, fallbackText)
    }
    window.addEventListener('scroll-to-block-id', handler)
    return () => {
      cancelled = true
      window.removeEventListener('scroll-to-block-id', handler)
    }
  }, [editor])

  // 监听下载远程图片事件（由 EditorToolbar 派发，带 tabId 防止多 tab 错处理）。
  // 流程：仅当事件的 tabId 匹配当前 activeTab.id 时才处理；遍历 editor.document
  // 收集 image/file blocks 中的 http(s) URL，统一交给全局 downloadCoordinator，
  // 由协调器合并多文件进度并即时替换 block URL。
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      // 事件携带 tabId 时只处理当前 tab；旧版事件无 tabId 时也接受（向后兼容）
      if (detail.tabId && activeTabId && detail.tabId !== activeTabId) return
      if (cancelled || !editor) return
      try {
        // 1. 收集远程图片 block（递归遍历 document，包含嵌套在列表/引用/表格等 children 中的图片）
        const remoteBlocks: { blockId: string; url: string }[] = []
        const collectRemoteImages = (blocks: any[]) => {
          for (const block of blocks) {
            if (!block) continue
            if (block.type === 'image' || block.type === 'file') {
              const url = (block.props as any)?.url
              if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                remoteBlocks.push({ blockId: block.id, url })
              }
            }
            if (Array.isArray(block.children) && block.children.length > 0) {
              collectRemoteImages(block.children)
            }
          }
        }
        collectRemoteImages(editor.document as any[])

        if (remoteBlocks.length === 0) {
          toast.info('当前文档无远程图片')
          return
        }

        // 2. 解析上传目录与文件所在目录
        const targetDir = await resolveUploadDir()
        const filePath = activeTabPath || ''
        const fileDir = filePath.split(/[\\/]/).slice(0, -1).join('/')

        // 3. 对 remoteBlocks 按 URL 去重：同一张远程图片只下载一次，避免重复下载
        //    也避免 urlMap 因 key 冲突导致部分 block 无法替换。
        const seenUrls = new Set<string>()
        const uniqueRemoteBlocks = remoteBlocks.filter((b) => {
          if (seenUrls.has(b.url)) return false
          seenUrls.add(b.url)
          return true
        })

        // 4. 构造 url → { editor, blockId } 映射 + batch items
        const blockContexts = new Map<string, { editor: any; blockId: string }>()
        for (const b of uniqueRemoteBlocks) {
          blockContexts.set(b.url, { editor, blockId: b.blockId })
        }
        const items = uniqueRemoteBlocks.map((b) => ({ url: b.url, blockId: b.blockId }))

        // 5. 交给协调器：合并 toast + 即时替换
        downloadCoordinator.enqueueBatch(items, blockContexts, {
          targetDir,
          fileDir,
          rootPath: rootPath || '',
        })
      } catch (err) {
        console.error('Failed to enqueue download remote images:', err)
        toast.error(`下载远程图片失败：${String(err)}`)
      }
    }
    window.addEventListener('editor:download-remote-images', handler)
    return () => {
      cancelled = true
      window.removeEventListener('editor:download-remote-images', handler)
    }
  }, [editor, activeTabId, activeTabPath, rootPath, uploadPath])

  // Insert text at cursor position in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      if (!text) return
      
      try {
        let blocks: PartialBlock[] = []
        try {
          blocks = await editor.tryParseMarkdownToBlocks(text) as unknown as PartialBlock[]
          // Transform mermaid code blocks to mermaid blocks
          blocks = transformMermaidBlocks(blocks) as PartialBlock[]
          // Transform math code blocks to katex blocks
          blocks = transformKatexBlocks(blocks) as PartialBlock[]
          // Transform markmap code blocks to markmap blocks
          blocks = transformMarkmapBlocks(blocks) as PartialBlock[]
        } catch (parseError) {
          console.warn('[MarkdownEditor] Failed to parse markdown for insert, treating as plain text:', parseError)
          // Fallback: treat as plain text
          const lines = text.split('\n')
          blocks = lines.map((line: string) => ({
            type: 'paragraph' as const,
            content: line || undefined
          }))
        }
        
        if (blocks.length > 0) {
          const currentBlock = editor.getTextCursorPosition().block
          if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
            // Current block is empty, replace it with the first new block and insert the rest after
            editor.replaceBlocks([currentBlock.id], [blocks[0]])
            if (blocks.length > 1) {
              const firstInserted = editor.getTextCursorPosition().block
              editor.insertBlocks(blocks.slice(1), firstInserted.id, 'after')
            }
          } else {
            // Insert all blocks after the current block
            editor.insertBlocks(blocks, currentBlock.id, 'after')
          }
        }
      } catch (err) {
        console.error('Failed to insert at cursor in BlockNote:', err)
      }
    }
    window.addEventListener('insert-at-cursor', handler)
    return () => {
      cancelled = true
      window.removeEventListener('insert-at-cursor', handler)
    }
  }, [editor])

  // Handle Cmd+A / Ctrl+A select all in BlockNote
  // In Tauri WebView, the browser's native selectAll intercepts Cmd+A before
  // ProseMirror's keymap can handle it. We use a direct DOM onkeydown handler
  // on the ProseMirror editor element to ensure it works reliably.
  useEffect(() => {
    if (!editor) return

    const tiptapEditor = (editor as any)?._tiptapEditor
    const editorElement = tiptapEditor?.view?.dom as HTMLElement | undefined
    if (!editorElement) return

    // Use a direct DOM handler instead of addEventListener for maximum reliability
    const originalOnKeyDown = editorElement.onkeydown
    editorElement.onkeydown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        try {
          // Use ProseMirror's TextSelection with document traversal
          // BlockNote's document structure requires positions to be within valid text nodes
          const { state, dispatch } = tiptapEditor.view
          const doc = state.doc

          // Traverse document to find first and last text positions
          let startPos = 1  // Default fallback
          let endPos = Math.max(1, doc.content.size - 1)  // Default fallback

          // Find first text node position
          doc.descendants((node: any, pos: number) => {
            if (node.isText && startPos === 1) {
              startPos = pos
            }
            // Continue traversal to find last position
            if (node.isText) {
              endPos = pos + node.nodeSize
            }
          })

          // Ensure positions are valid
          startPos = Math.max(1, Math.min(startPos, doc.content.size - 1))
          endPos = Math.max(startPos + 1, Math.min(endPos, doc.content.size))

          // Create TextSelection with found positions
          const selection = TextSelection.create(state.doc, startPos, endPos)
          const tr = state.tr.setSelection(selection)
          dispatch(tr)
        } catch (err) {
          console.error('Failed to select all:', err)
        }
        return false
      }
      // Call original handler if exists
      if (originalOnKeyDown) {
        return originalOnKeyDown.call(editorElement, e)
      }
    }

    return () => {
      editorElement.onkeydown = originalOnKeyDown
    }
  }, [editor])

  // Replace selected text or entire content in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      if (!text) return
      
      try {
        let blocks: PartialBlock[] = []
        try {
          blocks = await editor.tryParseMarkdownToBlocks(text) as unknown as PartialBlock[]
          // Transform mermaid code blocks to mermaid blocks
          blocks = transformMermaidBlocks(blocks) as PartialBlock[]
          // Transform math code blocks to katex blocks
          blocks = transformKatexBlocks(blocks) as PartialBlock[]
          // Transform markmap code blocks to markmap blocks
          blocks = transformMarkmapBlocks(blocks) as PartialBlock[]
        } catch (parseError) {
          console.warn('[MarkdownEditor] Failed to parse markdown for replace, treating as plain text:', parseError)
          // Fallback: treat as plain text
          const lines = text.split('\n')
          blocks = lines.map((line: string) => ({
            type: 'paragraph' as const,
            content: line || undefined
          }))
        }
        
        if (blocks.length === 0) return

        const tiptapEditor = (editor as any)._tiptapEditor
        if (tiptapEditor) {
          const { empty } = tiptapEditor.state.selection
          if (!empty) {
            // Replace the blocks that overlap with the current selection
            // Find which blocks are covered by the selection
            const { from, to } = tiptapEditor.state.selection
            const doc = tiptapEditor.state.doc

            // Collect block IDs that are within the selection range
            const blockIdsToRemove: string[] = []
            doc.descendants((node: any, pos: number) => {
              if (node.type.name === 'blockContainer' && node.attrs?.id) {
                const blockStart = pos
                const blockEnd = pos + node.nodeSize
                // Check if this block overlaps with the selection
                if (blockStart < to && blockEnd > from) {
                  blockIdsToRemove.push(node.attrs.id)
                }
              }
            })

            if (blockIdsToRemove.length > 0) {
              editor.replaceBlocks(blockIdsToRemove, blocks)
            } else {
              // Fallback: insert after current block
              const currentBlock = editor.getTextCursorPosition().block
              editor.insertBlocks(blocks, currentBlock.id, 'after')
            }
          } else {
            // Replace entire content
            const allBlockIds = editor.document.map((b: any) => b.id)
            editor.replaceBlocks(allBlockIds, blocks)
          }
        }
      } catch (err) {
        console.error('Failed to replace content in BlockNote:', err)
      }
    }
    window.addEventListener('replace-content', handler)
    return () => {
      cancelled = true
      window.removeEventListener('replace-content', handler)
    }
  }, [editor])

  // Debounce timer ref — delays expensive serialization to avoid
  // blocking the UI on every keystroke.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The actual serialization + notification logic (expensive).
  // Also dispatches the TOC event so DirectoryView updates are debounced too.
  const serializeAndNotify = useCallback(async () => {
    if (!onChange || !editor) return
    try {
      // Custom serialization for mermaid blocks
      const document = (editor.document as any[]).map((block: any) => {
        if (block.type === MERMAID_BLOCK_TYPE) {
          const props = block.props || {}
          const diagram = props.diagram || ''
          // Embed width/height as HTML comment in diagram content for persistence
          const w = props.width || 0
          const h = props.height || 0
          let content = diagram
          if (w > 0 || h > 0) {
            const meta = JSON.stringify({ width: w, height: h })
            // Remove any existing meta comment first
            content = diagram.replace(/<!--\s*mermaid-meta:.*?-->\s*\n?/g, '')
            content = `<!-- mermaid-meta:${meta} -->\n${content}`
          }
          return {
            ...block,
            type: 'codeBlock',
            props: { language: 'mermaid' },
            content: [{ type: 'text', text: content }],
          }
        }
        if (block.type === KATEX_BLOCK_TYPE) {
          const katexProps = block.props as { formula?: string; display?: boolean; width?: number; height?: number }
          // Embed width/height in the formula as HTML comment if set
          let formula = katexProps.formula || ''
          if (katexProps.width && katexProps.height) {
            formula = `<!-- katex-meta:{"width":${katexProps.width},"height":${katexProps.height}} -->\n${formula}`
          }
          return {
            ...block,
            type: 'codeBlock',
            props: { language: katexProps.display !== false ? 'math' : 'math-inline' },
            content: [{ type: 'text', text: formula }],
          }
        }
        if (block.type === MARKMAP_BLOCK_TYPE) {
          const props = block.props || {}
          let diagram = props.diagram || ''
          const w = props.width || 0
          const h = props.height || 0
          const s = props.scale || 0
          if (w > 0 || h > 0 || s > 0) {
            const meta = JSON.stringify({ width: w, height: h, scale: s })
            diagram = diagram.replace(/<!--\s*markmap-meta:.*?-->\s*\n?/g, '')
            diagram = `<!-- markmap-meta:${meta} -->\n${diagram}`
          }
          return {
            ...block,
            type: 'codeBlock',
            props: { language: 'markmap' },
            content: [{ type: 'text', text: diagram }],
          }
        }
        return block
      })
      const rawMd = await editor.blocksToMarkdownLossy(document as typeof editor.document)
      const md = compactMarkdown(rawMd)
      lastContentRef.current = md
      onChange(md)

      // Update TOC (debounced with content change)
      try {
        const entryTitle = activeTabName.replace(/\.md$/i, '') || t('editor.untitled')
        const toc = buildTableOfContents(entryTitle, editor.document)
        window.dispatchEvent(new CustomEvent('block-editor-ready', {
          detail: { toc, isBlockNote: true }
        }))
      } catch (error) {
        console.error('Error building table of contents:', error)
      }
    } catch (e) {
      console.error('[MarkdownEditor] Failed to convert blocks to markdown:', e)
      // Don't propagate error to avoid breaking the editor
    }
  }, [onChange, editor, activeTabName, t])

  // Debounced handleChange — coalesces rapid edits into a single
  // serialization pass every 300ms, keeping the UI responsive.
  const debouncedHandleChange = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      serializeAndNotify()
    }, 300)
  }, [serializeAndNotify])

  // Flush pending content immediately (used before save operations).
  const flushPendingContent = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      await serializeAndNotify()
    }
  }, [serializeAndNotify])

  // Register flush function so save handlers can flush before writing.
  useEffect(() => {
    return registerFlushFn(flushPendingContent)
  }, [flushPendingContent])

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  // Build initial TOC when editor mounts or tab switches.
  // Subsequent TOC updates are handled by the debounced serializeAndNotify.
  useEffect(() => {
    if (!editor || !editor.document) return

    try {
      const entryTitle = activeTabName.replace(/\.md$/i, '') || t('editor.untitled')
      const toc = buildTableOfContents(entryTitle, editor.document)

      window.dispatchEvent(new CustomEvent('block-editor-ready', {
        detail: { toc, isBlockNote: true }
      }))
    } catch (error) {
      console.error('Error building table of contents:', error)
    }
  }, [editor, activeTabName, t])

  const themeSetting = useUIStore((state) => state.theme)
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isAppDark = themeSetting === 'dark' || (themeSetting === 'system' && systemIsDark)
  const blocknoteTheme = isAppDark ? 'dark' as const : 'light' as const


  // Methods for the context menu
  const getSelectedText = useCallback(() => {
    if (!editor) return ''
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (!tiptapEditor) return ''
      const { from, to, empty } = tiptapEditor.state.selection
      if (empty) return ''
      return tiptapEditor.state.doc.textBetween(from, to, '\n')
    } catch {
      return ''
    }
  }, [editor])

  const getSelectionLineRange = useCallback((): [number, number] | null => {
    if (!editor) return null
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (!tiptapEditor) return null
      const { from, to, empty } = tiptapEditor.state.selection
      if (empty) return null
      const textBeforeFrom = tiptapEditor.state.doc.textBetween(0, from, '\n')
      const textBeforeTo = tiptapEditor.state.doc.textBetween(0, to, '\n')
      const startLineNumber = (textBeforeFrom.match(/\n/g) || []).length + 1
      const endLineNumber = (textBeforeTo.match(/\n/g) || []).length + 1
      return [startLineNumber, endLineNumber]
    } catch {
      return null
    }
  }, [editor])

  const getFullContent = useCallback(() => {
    // Return cached content from the last onChange call to avoid expensive re-rendering
    if (lastContentRef.current) return lastContentRef.current
    // Fallback: only compute if we haven't cached yet
    if (!editor) return ''
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (tiptapEditor) {
        return tiptapEditor.state.doc.textContent || ''
      }
    // eslint-disable-next-line no-empty
    } catch {}
    return ''
  }, [editor])

  // Custom slash menu items: default items + Mermaid diagram templates
  const getCustomSlashMenuItems = useCallback(async (query: string) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor)
    
    // Helper to insert a mermaid block
    const insertMermaidBlock = (diagram: string) => {
      const newBlock = {
        type: MERMAID_BLOCK_TYPE,
        props: {
          source: `\`\`\`mermaid\n${diagram}\`\`\``,
          diagram,
        },
      } as any

      const currentBlock = editor.getTextCursorPosition().block
      if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
        editor.updateBlock(currentBlock, newBlock)
      } else {
        editor.insertBlocks([newBlock], currentBlock.id, 'after')
      }
    }

    // Mermaid diagram templates
    const mermaidTemplates = [
      {
        title: 'Mermaid',
        subtext: 'Flowchart diagram',
        aliases: ['mermaid', 'diagram', 'chart', '图表', '流程图'],
        diagram: `graph TD\n    A[Start] --> B{Decision?}\n    B -->|Yes| C[OK]\n    B -->|No| D[Cancel]\n`,
      },
      {
        title: 'Mermaid Sequence',
        subtext: 'Sequence diagram',
        aliases: ['sequence', '时序图', 'sequenceDiagram'],
        diagram: `sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hello Bob!\n    Bob-->>Alice: Hi Alice!\n`,
      },
      {
        title: 'Mermaid Gantt',
        subtext: 'Gantt chart',
        aliases: ['gantt', '甘特图', 'project', 'schedule'],
        diagram: `gantt
    title Project Schedule
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    section Phase 1
    Task 1 :a1, 2024-01-01, 7d
    Task 2 :after a1, 5d
    section Phase 2
    Task 3 :2024-01-15, 10d
`,
      },
      {
        title: 'Mermaid Class',
        subtext: 'Class diagram',
        aliases: ['class', '类图', 'classDiagram', 'oop'],
        diagram: `classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }\n    class Dog {\n        +fetch()\n    }\n    Animal <|-- Dog\n`,
      },
      {
        title: 'Mermaid State',
        subtext: 'State diagram',
        aliases: ['state', '状态图', 'stateDiagram'],
        diagram: `stateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing : submit\n    Processing --> Success : ok\n    Processing --> Error : fail\n    Success --> [*]\n    Error --> Idle : retry\n`,
      },
      {
        title: 'Mermaid ER',
        subtext: 'Entity relationship diagram',
        aliases: ['er', 'erDiagram', '实体关系图', 'database', 'db'],
        diagram: `erDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n    USER {\n        int id\n        string name\n    }\n`,
      },
      {
        title: 'Mermaid Pie',
        subtext: 'Pie chart',
        aliases: ['pie', '饼图', 'pieChart', 'percentage'],
        diagram: `pie title Distribution\n    "Category A" : 40\n    "Category B" : 30\n    "Category C" : 20\n    "Category D" : 10\n`,
      },
      {
        title: 'Mermaid Mindmap',
        subtext: 'Mind map',
        aliases: ['mindmap', '思维导图', 'brainstorm'],
        diagram: `mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B\n      Leaf 3\n      Leaf 4\n`,
      },
      {
        title: 'Mermaid Journey',
        subtext: 'User journey map',
        aliases: ['journey', '用户旅程图', 'userjourney'],
        diagram: `journey\n    title User Journey\n    section Discovery\n      Search for product: 5: Customer\n      Find product page: 4: Customer\n    section Purchase\n      Add to cart: 5: Customer\n      Checkout: 3: Customer\n`,
      },
      {
        title: 'Mermaid Timeline',
        subtext: 'Timeline diagram',
        aliases: ['timeline', '时间线', 'history'],
        diagram: `timeline\n    title History\n    section Period 1\n        2020 : Event A\n        2021 : Event B\n    section Period 2\n        2022 : Event C\n        2023 : Event D\n`,
      },
    ]

    const mermaidItems = mermaidTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Network size={18} />,
      subtext: tpl.subtext,
      group: 'MerMaid',
      aliases: tpl.aliases,
      onItemClick: () => insertMermaidBlock(tpl.diagram),
    }))

    // Helper to insert a katex block
    const insertKatexBlock = (formula: string, display: boolean) => {
      const language = display ? 'math' : 'math-inline'
      const newBlock = {
        type: KATEX_BLOCK_TYPE,
        props: {
          source: `\`\`\`${language}\n${formula}\n\`\`\``,
          formula,
          display,
        },
      } as any

      const currentBlock = editor.getTextCursorPosition().block
      if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
        editor.updateBlock(currentBlock, newBlock)
      } else {
        editor.insertBlocks([newBlock], currentBlock.id, 'after')
      }
    }

    // KaTeX math formula templates
    const katexTemplates = [
      {
        title: 'Math (Block)',
        subtext: 'Block-level LaTeX formula',
        aliases: ['math', 'katex', 'latex', '公式', '数学', '块级公式', 'equation', 'formula'],
        formula: `E = mc^2`,
        display: true,
      },
      {
        title: 'Math (Inline)',
        subtext: 'Inline LaTeX formula',
        aliases: ['math-inline', 'katex-inline', 'latex-inline', '行内公式', 'inline math'],
        formula: `E = mc^2`,
        display: false,
      },
      {
        title: 'Math — Quadratic',
        subtext: 'Quadratic formula',
        aliases: ['quadratic', '一元二次方程', '求根公式'],
        formula: `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`,
        display: true,
      },
      {
        title: 'Math — Sum',
        subtext: 'Summation formula',
        aliases: ['sum', '求和', 'sigma'],
        formula: `\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}`,
        display: true,
      },
      {
        title: 'Math — Integral',
        subtext: 'Definite integral',
        aliases: ['integral', '积分', 'calculus'],
        formula: `\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)`,
        display: true,
      },
      {
        title: 'Math — Matrix',
        subtext: '2x2 matrix',
        aliases: ['matrix', '矩阵', 'linear algebra'],
        formula: `A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}`,
        display: true,
      },
    ]

    const katexItems = katexTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Sigma size={18} />,
      subtext: tpl.subtext,
      group: 'Katex',
      aliases: tpl.aliases,
      onItemClick: () => insertKatexBlock(tpl.formula, tpl.display),
    }))

    // Helper to insert a markmap block
    const insertMarkmapBlock = (diagram: string) => {
      const newBlock = {
        type: MARKMAP_BLOCK_TYPE,
        props: {
          source: `\`\`\`markmap\n${diagram}\`\`\``,
          diagram,
        },
      } as any

      const currentBlock = editor.getTextCursorPosition().block
      if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
        editor.updateBlock(currentBlock, newBlock)
      } else {
        editor.insertBlocks([newBlock], currentBlock.id, 'after')
      }
    }

    // Markmap mindmap templates
    const markmapTemplates = [
      {
        title: 'Markmap',
        subtext: 'Project breakdown mindmap',
        aliases: ['markmap', 'mindmap', '思维导图', '脑图', 'project', 'plan'],
        diagram: `# Project Plan
## Planning
- Goals
- Timeline
- Resources
## Design
- Wireframes
- UI Design
- UX Review
## Development
- Backend
- Frontend
- Testing
## Launch
- Marketing
- Release
- Feedback
`,
      },
      {
        title: 'Markmap — Todo',
        subtext: 'Todo list mindmap',
        aliases: ['markmap-todo', 'todo', '待办', 'task', 'checklist'],
        diagram: `# Tasks
## Today
- [ ] High priority task
- [ ] Review pull requests
- [ ] Reply to emails
## This Week
- [ ] Finish feature A
- [ ] Write documentation
- [ ] Plan next sprint
## Backlog
- [ ] Refactor module B
- [ ] Explore new tech
`,
      },
      {
        title: 'Markmap — Study',
        subtext: 'Study plan mindmap',
        aliases: ['markmap-study', 'study', '学习', '学习计划', 'learn', 'notes'],
        diagram: `# Study Plan
## Foundations
### Concepts
### Principles
## Advanced
### Patterns
### Best Practices
## Practice
### Exercises
### Projects
## Resources
### Books
### Videos
### Articles
`,
      },
    ]

    const markmapItems = markmapTemplates.map(tpl => ({
      title: tpl.title,
      icon: <Network size={18} />,
      subtext: tpl.subtext,
      group: 'Markmap',
      aliases: tpl.aliases,
      onItemClick: () => insertMarkmapBlock(tpl.diagram),
    }))

    const allItems = [...defaultItems, ...mermaidItems, ...katexItems, ...markmapItems]
    
    // Filter items by query
    const lowerQuery = query.toLowerCase()
    return allItems.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(lowerQuery)
      const subtextMatch = item.subtext?.toLowerCase().includes(lowerQuery) ?? false
      const aliasMatch = item.aliases?.some((alias: string) => alias.toLowerCase().includes(lowerQuery)) ?? false
      return titleMatch || subtextMatch || aliasMatch
    })
  }, [editor])

  return (
    <EditorContextMenu
      getSelectedText={getSelectedText}
      getSelectionLineRange={getSelectionLineRange}
      getFullContent={getFullContent}
    >
      <div ref={editorContainerRef} className="blocknote-editor-container flex flex-col h-full">
        <ScrollArea className="flex-1 w-full">
          <div className="w-full">
            <BlockNoteView
              editor={editor}
              theme={blocknoteTheme}
              onChange={debouncedHandleChange}
              slashMenu={false}
            >
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={getCustomSlashMenuItems}
              />
            </BlockNoteView>
          </div>
        </ScrollArea>
      </div>
    </EditorContextMenu>
  )
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null)
  const [blocksKey, setBlocksKey] = useState(0)
  const { t } = useTranslation()
  const prevContentRef = useRef(content)
  const isInternalChange = useRef(false)

  // Track internal changes from the editor's onChange callback
  const handleChangeWrapper = (newContent: string) => {
    isInternalChange.current = true
    onChange?.(newContent)
    // Reset after a microtask to allow the state update to propagate
    queueMicrotask(() => {
      isInternalChange.current = false
    })
  }

  useEffect(() => {
    // Skip re-parsing when the content change originated from the editor itself
    if (isInternalChange.current) {
      prevContentRef.current = content
      return
    }

    let cancelled = false

    const wasEmpty = !prevContentRef.current
    prevContentRef.current = content

    async function parseContent() {
      try {
        // Handle empty content
        if (!content || content.trim() === '') {
          if (!cancelled) {
            setInitialBlocks([{ type: 'paragraph' }])
          }
          return
        }

        // Strip frontmatter defensively: loadTabContent normally stores
        // only the body in tab.content, but some code paths (e.g.
        // resetDirtyTabs, HistoryView) may store the raw file content
        // which includes frontmatter.  Calling stripFrontmatter on an
        // already-stripped body is a no-op, so this is always safe.
        const body = stripFrontmatter(content)

        const tempEditor = BlockNoteEditor.create()
        let blocks: PartialBlock[] = []

        try {
          blocks = await tempEditor.tryParseMarkdownToBlocks(body)
          // Transform mermaid code blocks to mermaid blocks
          blocks = transformMermaidBlocks(blocks) as PartialBlock[]
          // Transform math code blocks to katex blocks
          blocks = transformKatexBlocks(blocks) as PartialBlock[]
          // Transform markmap code blocks to markmap blocks
          blocks = transformMarkmapBlocks(blocks) as PartialBlock[]
        } catch (parseError) {
          console.warn('[MarkdownEditor] Markdown parsing failed, treating as plain text:', parseError)
          // If markdown parsing fails, treat content as plain text
          // Split by newlines and create paragraph blocks
          const lines = body.split('\n')
          blocks = lines.map(line => ({
            type: 'paragraph' as const,
            content: line || undefined
          }))
        }
        
        if (cancelled) return
        
        if (blocks && blocks.length > 0) {
          setInitialBlocks(blocks)
        } else {
          setInitialBlocks([{ type: 'paragraph' }])
        }
        
        if (wasEmpty && content) {
          setBlocksKey((k) => k + 1)
        }
      } catch (e) {
        if (cancelled) return
        console.error('[MarkdownEditor] Failed to parse markdown:', e)
        // Don't show error UI, instead show content as plain text
        const lines = stripFrontmatter(content).split('\n')
        setInitialBlocks(lines.map(line => ({
          type: 'paragraph' as const,
          content: line || undefined
        })))
      }
    }

    setInitialBlocks(null)
    parseContent()
    return () => { cancelled = true }
  }, [content])

  if (!initialBlocks) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <p>{t('editor.loading')}</p>
      </div>
    )
  }

  return <BlockNoteInner key={blocksKey} blocks={initialBlocks} onChange={handleChangeWrapper} />
}