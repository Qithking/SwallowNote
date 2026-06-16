/**
 * Wenyan Toolbar Button — opens the 90vw×90vh typesetting dialog.
 *
 * Renders as a simple icon button in the editor toolbar. Clicking it
 * toggles the dialog open/closed state.
 */
import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { ToolbarButtonProps } from '@swallow-note/plugin-sdk'
import { WenyanIcon } from './WenyanIcon'
import { WenyanDialog } from './WenyanDialog'

export function WenyanToolbarButton(props: ToolbarButtonProps): ReactNode {
  const { size, activeNoteContent, store } = props
  const [dialogOpen, setDialogOpen] = useState(false)

  const openDialog = useCallback(() => setDialogOpen(true), [])
  const closeDialog = useCallback(() => setDialogOpen(false), [])

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
        store={store}
      />
    </>
  )
}
