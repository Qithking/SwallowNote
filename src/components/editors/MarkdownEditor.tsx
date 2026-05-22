/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState, useRef } from 'react'
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
    h1Size,
    h2Size,
    h3Size,
    h4Size,
    h5Size,
    bodySize,
    lineHeight,
    letterSpacing,
    normalPaddingVertical,
    normalPaddingHorizontal,
    widePaddingVertical,
    widePaddingHorizontal,
  } = useEditorSettingsStore()
  const noteWidth = useUIStore((state) => state.noteWidth)

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

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
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)

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
  const pasteHandler = async ({
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
  }): Promise<boolean | undefined> => {
    // Check if the WebView clipboard event contains Files (e.g., screenshot paste)
    // If so, let the default handler deal with it
    const hasFiles = event.clipboardData?.types?.includes('Files')

    if (hasFiles) {
      return defaultPasteHandler()
    }

    // No Files in WebView clipboard - try reading system clipboard file paths
    // This handles the case where user copied files in Finder/Explorer
    try {
      const filePaths = await readClipboardFilePaths()

      if (filePaths.length > 0) {
        // Process each file from the system clipboard
        for (const sourcePath of filePaths) {
          // Skip directories
          try {
            // We can't easily check if it's a directory from the frontend,
            // but the copy will fail for directories anyway
            const fileBlockType = getFileBlockType(sourcePath)
            const fileName = sourcePath.split('/').pop() || 'file'

            // Create a placeholder block
            const currentBlock = bnEditor.getTextCursorPosition().block
            const newBlock = {
              type: fileBlockType,
              props: {
                name: fileName,
              },
            } as PartialBlock

            let insertedBlockId: string | undefined

            // Insert or update block
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

            // Upload file (copy to upload directory) and update block with URL
            const url = await uploadFileFromPath(sourcePath)
            bnEditor.updateBlock(insertedBlockId, {
              props: { url },
            } as PartialBlock)
          } catch (e) {
            console.error('Failed to paste file from clipboard:', sourcePath, e)
          }
        }
        return true
      }
    } catch (e) {
      // Failed to read clipboard file paths - fall through to default handler
      console.debug('Failed to read clipboard file paths:', e)
    }

    // Default: let the default paste handler handle it (text, HTML, markdown)
    return defaultPasteHandler()
  }

  const editor = useCreateBlockNote({
    initialContent: blocks,
    codeBlock,
    uploadFile,
    resolveFileUrl,
    pasteHandler,
  })

  // 监听容器宽度变化，触发重新渲染以适应宽度变化
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width
        if (width !== containerWidth) {
          setContainerWidth(width)
        }
      }
    })

    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
    }
  }, [containerWidth])

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
    onChange(md)
  }

  const blocknoteTheme = theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'

  // Apply typography settings by injecting a style element into the container
  useEffect(() => {
    if (!editorContainerRef.current) return

    const container = editorContainerRef.current

    // Remove existing style element if present
    const existingStyle = container.querySelector('[data-typography-style]')
    if (existingStyle) {
      existingStyle.remove()
    }

    // Create new style element with typography settings
    const styleElement = document.createElement('style')
    styleElement.setAttribute('data-typography-style', 'true')
    styleElement.textContent = `
      /* 标题样式 - 使用正确的选择器 */
      .bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type="heading"] {
        font-size: ${h1Size}px !important;
        line-height: ${h1Size * 1.4}px !important;
        letter-spacing: ${letterSpacing}px !important;
      }
      .bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type="heading"][data-level="2"] {
        font-size: ${h2Size}px !important;
        line-height: ${h2Size * 1.4}px !important;
        letter-spacing: ${letterSpacing}px !important;
      }
      .bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type="heading"][data-level="3"] {
        font-size: ${h3Size}px !important;
        line-height: ${h3Size * 1.4}px !important;
        letter-spacing: ${letterSpacing}px !important;
      }
      .bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type="heading"][data-level="4"] {
        font-size: ${h4Size}px !important;
        line-height: ${h4Size * 1.4}px !important;
        letter-spacing: ${letterSpacing}px !important;
      }
      .bn-block-outer:not([data-prev-type]) > .bn-block > .bn-block-content[data-content-type="heading"][data-level="5"] {
        font-size: ${h5Size}px !important;
        line-height: ${h5Size * 1.4}px !important;
        letter-spacing: ${letterSpacing}px !important;
      }
      /* 段落样式 */
      .bn-default-styles {
        font-size: ${bodySize}px !important;
        line-height: ${lineHeight} !important;
        letter-spacing: ${letterSpacing}px !important;
      }      
    `

    container.appendChild(styleElement)

    // Cleanup
    return () => {
      styleElement.remove()
    }
  }, [h1Size, h2Size, h3Size, h4Size, h5Size, bodySize, lineHeight, letterSpacing,
    normalPaddingVertical, normalPaddingHorizontal])

  return (
    <div ref={editorContainerRef} className="blocknote-editor-container flex flex-col h-full">
      <ScrollArea className="flex-1 w-full">
        <div className="w-full">
          <BlockNoteView
            key={containerWidth}
            editor={editor}
            theme={blocknoteTheme}
            onChange={handleChange}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null)
  const [blocksKey, setBlocksKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const prevContentRef = useRef(content)

  useEffect(() => {
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

  return <BlockNoteInner key={blocksKey} blocks={initialBlocks} onChange={onChange} />
}