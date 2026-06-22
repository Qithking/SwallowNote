/**
 * Clipboard image access.
 *
 * Reads the first image Blob off the system clipboard. Returns
 * `null` when the clipboard contains no image (e.g. plain text,
 * file references, or access is denied by the browser / Tauri
 * sandbox).
 */
export async function readClipboardImage(): Promise<Blob | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== 'function'
  ) {
    return null
  }
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'))
      if (!imageType) continue
      const blob = await item.getType(imageType)
      if (blob) return blob
    }
    return null
  } catch (err) {
    // Most browsers throw a NotAllowedError when the tab is not
    // focused or the user denies the prompt. The caller is
    // expected to surface a friendly toast.
    console.warn('[picgo] readClipboardImage failed:', err)
    return null
  }
}

/** Best-effort filename for a clipboard image (no source name). */
export function clipboardImageName(mime: string): string {
  const ext = mime.includes('png')
    ? 'png'
    : mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('gif')
          ? 'gif'
          : 'png'
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z')
  return `clipboard-${ts}.${ext}`
}
