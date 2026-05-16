/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState, useRef } from 'react'
import { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { codeBlock } from '@blocknote/code-block'
import { useUIStore, useEditorSettingsStore } from '@/stores'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  } = useEditorSettingsStore()

  const editorContainerRef = useRef<HTMLDivElement>(null)

  // codeBlock from @blocknote/code-block provides syntax highlighting via Shiki
  // It's passed as the `codeBlock` editor option, NOT as a blockSpec
  const editor = useCreateBlockNote({
    initialContent: blocks,
    codeBlock,
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

  // 编辑器就绪后发送目录数据
  useEffect(() => {
    if (!editor || !editor.document) return

    const headings = editor.document
      .filter(block => block.type.startsWith('heading'))
      .map((block, index) => {
        let text = ''
        const content = block.content as any[]
        if (content && Array.isArray(content)) {
          text = content
            .map(c => typeof c === 'string' ? c : (c as any)?.text || '')
            .join('')
        }
        const levelMatch = block.type.match(/^heading(\d)$/)
        const level = levelMatch ? parseInt(levelMatch[1]) : 1

        return {
          id: block.id,
          text: text || '未命名标题',
          level,
          index,
        }
      })

    window.dispatchEvent(new CustomEvent('block-editor-ready', {
      detail: { headings, isBlockNote: true }
    }))
  }, [editor, editor?.document?.length])

  const handleChange = async () => {
    if (!onChange) return
    const md = await editor.blocksToMarkdownLossy(editor.document)
    onChange(md)
  }

  const blocknoteTheme = theme === 'dark' ? 'dark' : 'light'

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
      <ScrollArea className="flex-1">
        <BlockNoteView
          editor={editor}
          theme={blocknoteTheme}
          onChange={handleChange}
        />
      </ScrollArea>
    </div>
  )
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setInitialBlocks(null)

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
      } catch (e) {
        if (cancelled) return
        console.error('[MarkdownEditor] Failed to parse markdown:', e)
        setError(String(e))
      }
    }

    parseContent()
    return () => { cancelled = true }
  }, [content])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500 p-4">
        <p>加载文件失败: {error}</p>
      </div>
    )
  }

  if (!initialBlocks) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <p>加载中...</p>
      </div>
    )
  }

  return <BlockNoteInner blocks={initialBlocks} onChange={onChange} />
}