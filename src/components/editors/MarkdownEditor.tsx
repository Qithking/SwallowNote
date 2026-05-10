/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useRef, useState } from 'react'
import { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
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
  const editor = useCreateBlockNote({
    initialContent: blocks,
  })

  const handleChange = async () => {
    if (!onChange) return
    const md = await editor.blocksToMarkdownLossy(editor.document)
    onChange(md)
  }

  // Determine BlockNote theme: use 'dark' or 'light' based on app theme
  // For 'system', default to 'light' (BlockNote will use system preference)
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
  const initialized = useRef(false)

  // Only parse content once per mount to avoid circular updates:
  // editor onChange → parent setContent → content prop change → re-parse → editor rebuild → cursor jump
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function parseContent() {
      const tempEditor = BlockNoteEditor.create()
      const blocks = await tempEditor.tryParseMarkdownToBlocks(content)
      setInitialBlocks(blocks)
    }
    parseContent()
  }, [content])

  if (!initialBlocks) return null

  return <BlockNoteInner blocks={initialBlocks} onChange={onChange} />
}
