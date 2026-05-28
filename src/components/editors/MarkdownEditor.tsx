/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { BlockNoteEditor, PartialBlock, createCodeBlockSpec } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { codeBlockOptions } from '@blocknote/code-block'
import { useUIStore, useEditorStore, useEditorSettingsStore, useWorkspaceStore } from '@/stores'
import { ScrollArea } from '@/components/ui/scroll-area'
import { compactMarkdown } from '@/utils/compact-markdown'
import { buildTableOfContents } from '@/utils/tableOfContents'
import { writeBinaryFile, getHomeDir, readClipboardFilePaths, copyFile } from '@/lib/tauri'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { EditorContextMenu } from './EditorContextMenu'
import '@blocknote/mantine/style.css'

interface MarkdownEditorProps {
  content: string
  onChange?: (content: string) => void
}

/**
 * Inner editor that only mounts after blocks are parsed.
 * This ensures useCreateBlockNote receives initialContent on its first call,
 * avoiding the empty-editor problem.
 */
function BlockNoteInner({
  blocks,
  onChange,
}: {
  blocks: PartialBlock[]
  onChange?: (content: string) => void
}) {
  const theme = useUIStore((state) => state.theme)
  const uploadPath = useUIStore((state) => state.uploadPath)
  const { rootPath } = useWorkspaceStore()
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const { tabs, activeTabId } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
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
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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
  const codeBlock = createCodeBlockSpec(codeBlockOptions as any)

  const resolveUploadDir = async (): Promise<string> => {
    const filePath = activeTab?.path || ''
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
    const filePath = activeTab?.path || ''
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
        const filePath = activeTab?.path || ''
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
    const filePath = activeTab?.path || ''
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

    // Try reading system clipboard file paths asynchronously.
    // This handles the case where user copies a file in Finder (Cmd+C) and pastes here (Cmd+V).
    // The WebView clipboard won't contain Files type for cross-app file copy on macOS,
    // so we need to ask the Tauri backend to read the system clipboard directly.
    readClipboardFilePaths()
      .then((filePaths) => {
        if (filePaths.length > 0) {
          // System clipboard has file paths → insert as file blocks (suppress default text paste)
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
        // If no file paths found, do nothing — defaultPasteHandler was already called below
      })
      .catch(() => {})

    // Always delegate to defaultPasteHandler for normal text/HTML/markdown paste.
    // The async file-path check above only inserts additional blocks when files are detected;
    // it does not interfere with standard paste behavior.
    return defaultPasteHandler()
  }

  const editor = useCreateBlockNote({
    initialContent: blocks,
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

  // Insert text at cursor position in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(text)
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
  // ProseMirror's keymap can handle it, so BlockNote's built-in selectAll never fires.
  // We intercept it in the capture phase and delegate to TipTap's selectAll command.
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    const handleSelectAll = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        try {
          const tiptapEditor = (editor as any)?._tiptapEditor
          if (tiptapEditor) {
            tiptapEditor.chain().focus().selectAll().run()
          }
        } catch (err) {
          console.error('Failed to select all in BlockNote:', err)
        }
      }
    }

    container.addEventListener('keydown', handleSelectAll, true) // capture phase
    return () => container.removeEventListener('keydown', handleSelectAll, true)
  }, [editor])

  // Replace selected text or entire content in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(text)
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

  // 编辑器就绪后发送目录数据
  useEffect(() => {
    if (!editor || !editor.document) return

    try {
      const entryTitle = activeTab?.name.replace(/\.md$/i, '') || t('editor.untitled')
      const toc = buildTableOfContents(entryTitle, editor.document)

      window.dispatchEvent(new CustomEvent('block-editor-ready', {
        detail: { toc, isBlockNote: true }
      }))
    } catch (error) {
      console.error('Error building table of contents:', error)
    }
  }, [editor, editor?.document?.length])

  const handleChange = async () => {
    if (!onChange) return
    const rawMd = await editor.blocksToMarkdownLossy(editor.document)
    const md = compactMarkdown(rawMd)
    lastContentRef.current = md
    onChange(md)
  }

  const blocknoteTheme = theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'


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
    } catch {}
    return ''
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
              onChange={handleChange}
            />
          </div>
        </ScrollArea>
      </div>
    </EditorContextMenu>
  )
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null)
  const [blocksKey, setBlocksKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
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
    setError(null)

    const wasEmpty = !prevContentRef.current
    prevContentRef.current = content

    async function parseContent() {
      try {
        const tempEditor = BlockNoteEditor.create()
        const blocks = await tempEditor.tryParseMarkdownToBlocks(content)
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
        setError(String(e))
      }
    }

    setInitialBlocks(null)
    parseContent()
    return () => { cancelled = true }
  }, [content])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500 p-4">
        <p>{t('editor.loadFailed', { error })}</p>
      </div>
    )
  }

  if (!initialBlocks) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <p>{t('editor.loading')}</p>
      </div>
    )
  }

  return <BlockNoteInner key={blocksKey} blocks={initialBlocks} onChange={handleChangeWrapper} />
}