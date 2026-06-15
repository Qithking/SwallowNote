/**
 * Multi-strategy clipboard writer for the typist plugin.
 *
 * Strategy ladder (best → worst):
 *   1. `navigator.clipboard.write([ClipboardItem({ 'text/html', 'text/plain' })])`
 *      — the WeChat backend is a Chromium-based webview so this works
 *        in the host. WeChat editor's "paste" action then receives a
 *        rich text clipboard event and inserts the styled HTML.
 *   2. `navigator.clipboard.writeText(plainText)` — strips the HTML
 *      entirely. Still better than nothing because the user can
 *      re-paste in a text context.
 *   3. `domToCanvas(previewEl)` — render the visible preview into a
 *      PNG and hand the data URL back to the caller, who can prompt
 *      the user to save the image and drag it into the editor.
 *
 * The third strategy is intentionally client-side: we already render
 * the preview in the panel, so capturing it costs zero extra render
 * work. This mirrors the export plugin's PDF flow.
 */
import { domToCanvas } from 'modern-screenshot'
import { htmlToPlainText } from './htmlSanitizer'

export type CopyResult =
  | { ok: true; method: 'clipboard-html' }
  | { ok: true; method: 'clipboard-text'; warning: string }
  | { ok: true; method: 'image'; dataUrl: string }
  | { ok: false; error: string }

export async function copyToClipboard(
  html: string,
  previewEl: HTMLElement | null
): Promise<CopyResult> {
  // Strategy 1: modern Clipboard API with rich HTML payload.
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const htmlBlob = new Blob([html], { type: 'text/html' })
      const textBlob = new Blob([htmlToPlainText(html)], { type: 'text/plain' })
      // eslint-disable-next-line no-undef
      const item = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      })
      await navigator.clipboard.write([item])
      return { ok: true, method: 'clipboard-html' }
    }
  } catch (e) {
    console.warn('[typist] ClipboardItem.write failed:', e)
  }

  // Strategy 2: plain-text writeText fallback.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(htmlToPlainText(html))
      return {
        ok: true,
        method: 'clipboard-text',
        warning: '当前环境不支持富文本剪贴板，已写入纯文本。请在公众号编辑器中先用纯文本模式粘贴，再用格式刷修复样式。',
      }
    }
  } catch (e) {
    console.warn('[typist] clipboard.writeText failed:', e)
  }

  // Strategy 3: render the visible preview to a PNG and return the data URL.
  if (previewEl) {
    try {
      const canvas = await domToCanvas(previewEl, {
        scale: 2,
        backgroundColor: '#ffffff',
      })
      const dataUrl = canvas.toDataURL('image/png')
      return { ok: true, method: 'image', dataUrl }
    } catch (e) {
      console.warn('[typist] domToCanvas failed:', e)
    }
  }

  return {
    ok: false,
    error: '所有复制方式均不可用：请检查浏览器权限或尝试保存为 HTML 文件。',
  }
}
