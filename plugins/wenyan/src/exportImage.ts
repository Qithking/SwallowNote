/**
 * DOM → PNG export.
 *
 * Flow:
 *   1. Convert the preview DOM to a PNG canvas via html2canvas
 *   2. Ask the user to pick a directory (native folder picker)
 *   3. Write the PNG to `<picked-dir>/<auto-filename>.png` via the
 *      host's `write_binary_file` custom command
 *
 * The filename is auto-generated (`wenyan-<platform>-<timestamp>.png`)
 * so the user only has to pick a location, not type a name.
 *
 * html2canvas + @tauri-apps/plugin-dialog + @tauri-apps/api/core are
 * bundled into the plugin so the host plugin loader's import-rewriter
 * doesn't need to know about them. The bundled Tauri code talks to
 * the webview's native `__TAURI_INTERNALS__` runtime directly.
 */
import html2canvas from 'html2canvas'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

export interface ExportOptions {
  /** Filename (without extension). Defaults to "wenyan-<timestamp>". */
  filename?: string
  /** Pixel ratio multiplier. 2 = retina-style long image. */
  scale?: number
  /** Background color of the canvas. */
  backgroundColor?: string
}

export interface ExportResult {
  ok: boolean
  /** Final absolute path when the file was written. */
  path?: string
  /** Error message when ok=false. */
  error?: string
  /** True when the user cancelled the directory picker. */
  cancelled?: boolean
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function timestamp(): string {
  const d = new Date()
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * Convert a DOM node to a PNG canvas. Pure DOM-to-canvas, no I/O.
 */
export async function renderToCanvas(
  element: HTMLElement,
  options: ExportOptions = {}
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2
  const backgroundColor = options.backgroundColor ?? '#ffffff'
  return html2canvas(element, {
    scale,
    backgroundColor,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('canvas.toBlob 返回 null'))
    }, 'image/png')
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Chunked encode to avoid call-stack overflow on large PNGs.
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as number[]
    )
  }
  return btoa(binary)
}

/** Show a native directory picker. */
export async function pickExportDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false })
  if (!selected || Array.isArray(selected)) return null
  return selected
}

/**
 * Step 1: pick a directory.
 * Step 2: render DOM → canvas.
 * Step 3: write PNG to `<dir>/<filename>.png`.
 *
 * Returns:
 *   - { ok: true, path }                on success
 *   - { ok: false, cancelled: true }    if the user cancelled
 *   - { ok: false, error }              on any other failure
 */
export async function exportHtmlToPng(
  element: HTMLElement,
  options: { filename?: string; scale?: number; backgroundColor?: string } = {}
): Promise<ExportResult> {
  if (!element) {
    return { ok: false, error: '没有可导出的内容' }
  }
  try {
    // 1. Pick directory
    const directory = await pickExportDirectory()
    if (!directory) return { ok: false, cancelled: true }

    // 2. Render
    const canvas = await renderToCanvas(element, options)

    // 3. Build the full path
    const baseName = options.filename ?? `wenyan-${timestamp()}`
    const sep = directory.endsWith('/') ? '' : '/'
    const fullPath = `${directory}${sep}${baseName}.png`

    // 4. Write via the host's `write_binary_file` custom command
    // (the @tauri-apps/plugin-fs scope isn't granted to plugin code).
    const blob = await canvasToBlob(canvas)
    const buffer = await blob.arrayBuffer()
    const base64 = arrayBufferToBase64(buffer)
    await invoke('write_binary_file', { path: fullPath, data: base64 })
    return { ok: true, path: fullPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
