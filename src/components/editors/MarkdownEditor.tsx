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

  const handleChange = async () => {
    if (!onChange) return
    const md = await editor.blocksToMarkdownLossy(editor.document)
    onChange(md)
  }

  const blocknoteTheme = theme === 'dark' ? 'dark' : 'light'

  return (
    <div className="blocknote-editor-container">
      <BlockNoteView
        editor={editor}
        theme={blocknoteTheme}
        onChange={handleChange}
      />
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
