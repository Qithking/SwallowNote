/**
 * Wenyan Toolbar Button — opens the 90vw×90vh typesetting dialog.
 *
 * Renders as a simple icon button in the editor toolbar. Clicking it
 * toggles the dialog open/closed state.
 *
 * Markdown-only: the host pre-computes `isActiveNoteMarkdown` and
 * we disable the button (and skip opening the dialog) for any other
 * file type. We intentionally do NOT inspect `activeNotePath`
 * ourselves — the host's interpretation is the single source of
 * truth so a future rename of the markdown extension stays
 * transparent to plugins.
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
    isActiveNoteMarkdown,
    activeNoteName,
    store,
    invokeBackend,
    getAllSettings,
  } = props
  const [dialogOpen, setDialogOpen] = useState(false)

  const openDialog = useCallback(() => {
    // Defensive guard: even though the button is disabled in
    // non-markdown contexts, a programmatic open (or a future
    // keyboard shortcut) could still hit this path. Bail out
    // early so the dialog never appears for non-markdown notes.
    if (!isActiveNoteMarkdown) return
    setDialogOpen(true)
  }, [isActiveNoteMarkdown])
  const closeDialog = useCallback(() => setDialogOpen(false), [])

  const disabled = !isActiveNoteMarkdown
  const disabledTitle = activeNoteName
    ? `文颜排版仅支持 Markdown 文件（当前：${activeNoteName}）`
    : '文颜排版仅支持 Markdown 文件'

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={disabled}
        aria-disabled={disabled}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        style={{
          color: dialogOpen ? 'var(--theme-color)' : 'var(--text-primary)',
        }}
        title={disabled ? disabledTitle : '文颜排版'}
        aria-label="文颜排版"
      >
        <WenyanIcon size={size} />
      </button>
      {/* The dialog is only mounted when we actually have a markdown
          note open; the host already gates the toolbar button, so
          this is just a belt-and-suspenders check. */}
      {isActiveNoteMarkdown && (
        <WenyanDialog
          open={dialogOpen}
          onClose={closeDialog}
          activeNoteContent={activeNoteContent}
          store={store}
          invokeBackend={invokeBackend}
          getAllSettings={getAllSettings}
        />
      )}
    </>
  )
}
