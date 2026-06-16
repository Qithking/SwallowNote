/**
 * Editor insert — the bridge between an `UploadResult` and the
 * active note.
 *
 * The SDK exposes `activeNoteContent` (read-only) but does NOT
 * expose the editor's cursor index or a setter. The host does
 * own a `note:save` event that downstream consumers (the host's
 * note-saver) can pick up, but persisting the new content from
 * inside the plugin is not a documented path.
 *
 * For the time being the strategy is "append to the end of the
 * note content". When the host ships a cursor-aware insert API
 * we'll switch the implementation over.
 */
import type { LinkFormat } from '../types'
import type { UploadResult } from '../types'

/** Build the text that should land in the note body. */
export function buildInsertText(
  result: UploadResult,
  format: LinkFormat
): string {
  const alt = (result.filename || 'image').replace(/[\[\]]/g, '')
  switch (format) {
    case 'markdown':
      return `![${alt}](${result.url})`
    case 'html':
      return `<img src="${result.url}" alt="${alt}" />`
    case 'url':
      return result.url
    default:
      return result.url
  }
}

export interface InsertOutcome {
  /** The text that was queued for insertion. */
  text: string
  /** The new full note content, if the plugin could compute it. */
  nextContent: string
  /**
   * `true` when the host SDK supports cursor-aware insert and
   * the text was placed at the cursor. `false` means we fell
   * back to the "append" path.
   */
  cursorInserted: boolean
}

/**
 * Insert `result` into the active note.
 *
 * @param result The upload result to insert.
 * @param format The user's preferred link format.
 * @param activeContent The current active note content from
 *   `props.activeNoteContent`. The SDK does not currently expose
 *   a cursor index, so the text is appended to the end with a
 *   blank line separator. The new full content is returned so
 *   callers (the host's auto-save loop, the plugin's own state)
 *   can persist it.
 *
 * TODO: switch to a cursor-aware insert once the SDK ships one.
 * Keep the function signature stable so the rest of the plugin
 * doesn't have to change.
 */
export function insertIntoNote(
  result: UploadResult,
  format: LinkFormat,
  activeContent: string
): InsertOutcome {
  const text = buildInsertText(result, format)
  const base = typeof activeContent === 'string' ? activeContent : ''
  const sep = base.length === 0 ? '' : base.endsWith('\n') ? '\n' : '\n\n'
  return {
    text,
    nextContent: `${base}${sep}${text}\n`,
    cursorInserted: false,
  }
}
