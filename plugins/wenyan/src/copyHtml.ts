/**
 * Copy styled HTML to the clipboard.
 *
 * Tries the modern ClipboardItem API first (preserves rich text
 * formatting when pasted into the WeChat editor), then falls back
 * to plain text with a user-facing warning.
 */
export async function copyHtmlToClipboard(html: string): Promise<{
  ok: boolean
  method: 'clipboard-html' | 'clipboard-text' | 'none'
  warning?: string
}> {
  // Modern API: write both text/html and text/plain so every
  // target application can pick the format it understands.
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = new Blob([html], { type: 'text/html' })
      const textBlob = new Blob([html.replace(/<[^>]*>/g, '')], { type: 'text/plain' })
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob,
          'text/plain': textBlob,
        }),
      ])
      return { ok: true, method: 'clipboard-html' }
    } catch (e) {
      console.warn('[wenyan] ClipboardItem write failed:', e)
      // Fall through to legacy path.
    }
  }

  // Legacy fallback: writeText (plain text only).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(html)
      return {
        ok: true,
        method: 'clipboard-text',
        warning: '已复制纯文本（当前浏览器不支持富文本剪贴板）',
      }
    } catch (e) {
      console.warn('[wenyan] writeText failed:', e)
    }
  }

  return { ok: false, method: 'none' }
}
