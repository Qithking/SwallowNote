/**
 * Wenyan Toolbar Button — opens the 90vw×90vh typesetting dialog.
 *
 * Renders as a simple icon button in the editor toolbar. Clicking it
 * toggles the dialog open/closed state.
 *
 * Markdown-only: the host passes the lower-cased `activeNoteExt`
 * (without the leading dot) so we can branch on the extension
 * directly. For any non-Markdown file we return `null` so the
 * editor toolbar renders nothing — the icon disappears entirely
 * for `Code` / `Binary` / `MindMap` notes, instead of staying
 * visible in a disabled state.
 */
import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { ToolbarButtonProps } from '@swallow-note/plugin-sdk'
import { WenyanIcon } from './WenyanIcon'
import { WenyanDialog } from './WenyanDialog'

export function WenyanToolbarButton(props: ToolbarButtonProps): ReactNode {
  const {
    size,
    activeNoteContent,
    activeNotePath,
    activeNoteExt,
    store,
    invokeBackend,
    getAllSettings,
  } = props
  const [dialogOpen, setDialogOpen] = useState(false)

  const openDialog = useCallback(() => {
    setDialogOpen(true)
  }, [])
  const closeDialog = useCallback(() => setDialogOpen(false), [])

  // Markdown-only gate: return `null` for anything other than a
  // `.md` / `.markdown` file. The dialog depends on the Markdown
  // content, so the button would be a no-op for other file types
  // and is intentionally hidden from the toolbar entirely.
  if (activeNoteExt !== 'md' && activeNoteExt !== 'markdown') {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
        style={{
          color: dialogOpen ? 'var(--theme-color)' : 'var(--text-primary)',
        }}
        title="文颜排版"
        aria-label="文颜排版"
      >
        <WenyanIcon size={size} />
      </button>
      <WenyanDialog
        open={dialogOpen}
        onClose={closeDialog}
        activeNoteContent={activeNoteContent}
        activeNotePath={activeNotePath}
        store={store}
        invokeBackend={invokeBackend}
        getAllSettings={getAllSettings}
      />
    </>
  )
}
