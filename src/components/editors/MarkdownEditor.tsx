/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState } from 'react'
import { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { codeBlock } from '@blocknote/code-block'
import { useUIStore } from '@/stores'
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

  // 编辑器就绪后通知目录面板
  useEffect(() => {
    if (editor && editor.document) {
      // 提取所有标题及其 block ID 和文本内容
      const headings = editor.document
        .filter(block => block.type.startsWith('heading'))
        .map(block => {
          // 从 block 内容中提取文本
          let text = ''
          const content = block.content as any[]
          if (content && Array.isArray(content)) {
            text = content
              .map(c => typeof c === 'string' ? c : (c as any)?.text || '')
              .join('')
          }
          return {
            id: block.id,
            text: text || '未命名标题',
          }
        })
      
      window.dispatchEvent(new CustomEvent('block-editor-ready', {
        detail: { headings, isBlockNote: true }
      }))
    }
  }, [editor, editor?.document?.length])

  const handleChange = async () => {
    if (!onChange) return
    const md = await editor.blocksToMarkdownLossy(editor.document)
    onChange(md)
  }

  const blocknoteTheme = theme === 'dark' ? 'dark' : 'light'

  return (
    <div className="blocknote-editor-container flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <BlockNoteView
          editor={editor}
          theme={blocknoteTheme}
          onChange={handleChange}
        />
      </div>
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
