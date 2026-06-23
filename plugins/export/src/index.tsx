/**
 * Export Plugin — External plugin entry
 *
 * Exports the current Markdown document to Word (.docx) or PDF.
 * - DOCX: Uses the plugin backend (JSON-RPC subprocess) with pulldown-cmark
 *   to parse markdown and docx-rs to generate the DOCX file.
 * - PDF: Uses the backend to convert markdown to styled HTML, then renders
 *   the HTML in a hidden iframe and captures it with html2canvas + jsPDF.
 *
 * This plugin is completely self-contained:
 * - Frontend: toolbarButton component with dropdown menu
 * - Backend: Rust binary in src-tauri/ (JSON-RPC over stdin/stdout)
 * - No code in the host application is specific to this plugin
 */
/* eslint-disable react-refresh/only-export-components */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import type { PluginManifest, PluginPanelProps, ToolbarButtonProps } from '@swallow-note/plugin-sdk'
// Re-export setHost so the host can install SDK overrides at runtime.
export { setHost } from '@swallow-note/plugin-sdk'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { jsPDF } from 'jspdf'
import { domToCanvas } from 'modern-screenshot'
import { compactMarkdown } from './markdown-normalize'
import { getStrings } from './i18n'

// ─── Constants ──────────────────────────────────────────────────────────────

/// Width in CSS pixels that matches an A4 page at 96 dpi.
const A4_WIDTH_PX = 794
/// Height of an A4 page in CSS pixels at 96 dpi (297 mm).
const A4_HEIGHT_PX = 1123

/**
 * JSON-RPC application error codes emitted by the backend.
 * Mirrors the `ERR_*` constants in `src-tauri/src/convert.rs` so
 * the frontend can branch on the code (not the message string)
 * when categorising failures. Transport-level codes (-32700
 * parse, -32601 method-not-found) come from the host's Rust
 * layer and never reach this code path; we only list the
 * application codes here.
 */
const ERR_MARKDOWN_TOO_LARGE = 1001
// Note: only `ERR_MARKDOWN_TOO_LARGE` is currently branched on
// (see `runExport` catch block). The other backend codes
// (`ERR_DOCX_GENERATION`, etc.) fall through to the format-
// specific default toast. Add a new constant here and a matching
// `if (code === ...)` branch if you want to surface a more
// specific message for a new error type.

/**
 * Read the user's current locale without depending on
 * `react-i18next`. We prefer the host's globally-injected locale
 * (`window.__SWALLOW_LOCALE__`) when present so we follow the
 * host's language switch in real time; otherwise we fall back to
 * the browser's `navigator.language` and finally to `zh-CN` (the
 * host's primary user base).
 *
 * Subscribing to host locale-change events would require a
 * `useSyncExternalStore` plus an event-bus listener; the current
 * usage only reads the locale at render time and a parent
 * re-render will pick up changes, so we keep this implementation
 * dependency-free.
 */
function readLocale(): string {
  const w = (typeof window !== 'undefined' ? (window as unknown as { __SWALLOW_LOCALE__?: string }) : undefined)
  if (w && typeof w.__SWALLOW_LOCALE__ === 'string' && w.__SWALLOW_LOCALE__.length > 0) {
    return w.__SWALLOW_LOCALE__
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language
  }
  return 'zh-CN'
}

/**
 * Pull a JSON-RPC `code` and human-readable `message` out of an
 * unknown thrown value. The host's `invoke_plugin` wraps the
 * backend's JSON-RPC error response into a JS error whose
 * `message` is exactly the backend's `display_with_code()`
 * output, e.g. `"[ERR_CODE=1001] Markdown too large: 5242880
 * bytes (max 5242880)"`. The host drops the structured `code`
 * field, so the backend has to embed the code in the message
 * string (see `ExportError::display_with_code` in convert.rs).
 *
 * We prefer parsing the `[ERR_CODE=…]` tag over substring
 * matching the human string so the toast stays correct even
 * when translations of the error message change.
 *
 * Returns `code: 0` when the error is not JSON-RPC shaped (e.g.
 * a frontend-only exception from `domToCanvas`); callers fall
 * through to the format-specific default toast in that case.
 */
function extractErrCode(err: unknown): { code: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const codeMatch = raw.match(/^\[ERR_CODE=(-?\d+)\]\s*([\s\S]*)$/)
  if (codeMatch) {
    const code = Number.parseInt(codeMatch[1], 10)
    return {
      code: Number.isFinite(code) ? code : 0,
      message: codeMatch[2].trim(),
    }
  }
  // Fallback: legacy messages without the prefix (frontend-only
  // errors, transport-level errors from the host, etc.).
  return { code: 0, message: raw }
}

// ─── Icon component ──────────────────────────────────────────────────────────

function ExportIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Encode a `Uint8Array` to a base64 string.
 *
 * The naïve `btoa(String.fromCharCode(...bytes))` blows the JS call
 * stack at around 120 KB, and even the chunked variant
 * `String.fromCharCode.apply(null, Array.from(chunk))` repeatedly
 * stacks 32K frames per call — some V8 builds report
 * `RangeError: Maximum call stack size exceeded` for multi-megabyte
 * PDF buffers. We delegate to `FileReader.readAsDataURL`, which
 * copies bytes through the browser's native encoder without
 * touching the JS stack. The `data:*;base64,` prefix is stripped
 * before returning so the result is a pure base64 string the
 * rest of the pipeline can pass to `write_binary_file`.
 */
function uint8ToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    // `Uint8Array<ArrayBufferLike>` (the default for `new
    // Uint8Array(buf)`) is structurally compatible with
    // `BlobPart`, but recent TS DOM lib versions narrowed the
    // type to exclude `SharedArrayBuffer`. The cast satisfies
    // the strictest lib check while the runtime behaviour is
    // identical to passing the bytes directly.
    reader.readAsDataURL(new Blob([bytes as BlobPart]))
  })
}

/// Maximum total size of all embedded images, in bytes. We
/// pre-cap before reading each one so a 100 MB image doesn't
/// OOM the webview on its own. The 50 MB budget is roughly
/// 100 images at 500 KB each — enough for the long documents
/// we already support (the markdown size limit is 5 MB) while
/// leaving headroom for the rest of the export pipeline.
const MAX_EMBEDDED_IMAGE_BYTES = 50 * 1024 * 1024

/**
 * Collect every image referenced by the markdown and read the
 * bytes so the DOCX backend can embed them as real drawings.
 *
 * Strategy:
 *  1. Regex-extract every `![alt](url)` URL.
 *  2. Skip http(s) / data: / asset: URLs (they go through
 *     Tauri's protocol handler at render time and the backend
 *     can't embed remote bytes anyway).
 *  3. For each remaining relative path, resolve against
 *     `notePath`, route through `convertFileSrc` so the host's
 *     asset protocol reads the file, fetch the bytes, and
 *     base64-encode them.
 *  4. Stop adding to the output once the running total
 *     exceeds [`MAX_EMBEDDED_IMAGE_BYTES`]; the per-image
 *     error path is `try/catch` so a single broken image
 *     doesn't fail the whole export.
 *
 * Returns a `url → base64-no-prefix` map keyed by the
 * original markdown URL (NOT the absolute filesystem path)
 * so the backend can look up by the URL it sees in
 * `Inline::Image { url }`.
 */
async function collectImageAssets(
  markdown: string,
  notePath: string,
): Promise<Record<string, string>> {
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const urls = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const url = m[1]
    if (!url) continue
    // Skip absolute / pre-resolved URLs.
    if (/^(https?|data|blob|asset):/i.test(url)) continue
    urls.add(url)
  }
  if (urls.size === 0) return {}

  const out: Record<string, string> = {}
  let totalBytes = 0
  for (const url of urls) {
    if (totalBytes >= MAX_EMBEDDED_IMAGE_BYTES) {
      // Budget exhausted; stop adding more images. The user
      // can still get the rest of the document and the
      // skipped images fall back to the `[图片]` placeholder.
      break
    }
    try {
      const abs = resolveRelativePath(notePath, url)
      const assetUrl = convertFileSrc(abs)
      const resp = await fetch(assetUrl)
      if (!resp.ok) continue
      const blob = await resp.blob()
      if (totalBytes + blob.size > MAX_EMBEDDED_IMAGE_BYTES) continue
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      out[url] = await uint8ToBase64(bytes)
      totalBytes += bytes.byteLength
    } catch (e) {
      // Single-image failures are non-fatal; the rest of the
      // document still exports. We log a warning so the host
      // console can surface the cause if the user reports a
      // problem.
      console.warn('[export] collectImageAssets: skip', url, e)
    }
  }
  return out
}

/**
 * Resolve a relative path against a base path. The base is the
 * absolute filesystem path of the active note; the result is the
 * absolute path of the referenced image. Mirrors the semantics of
 * `path.resolve(baseDir, relative)` from Node, but in a form that
 * works in the Tauri webview.
 */
function resolveRelativePath(baseFile: string, relative: string): string {
  if (relative.startsWith('/')) return relative
  const lastSlash = baseFile.lastIndexOf('/')
  const baseDir = lastSlash >= 0 ? baseFile.slice(0, lastSlash) : ''
  if (baseDir === '') return relative
  // Normalise `..` segments by walking the joined path. We do not
  // need full path normalisation for the typical note-+-image
  // case, but the loop handles the common nested case.
  const segments = (baseDir + '/' + relative).split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return '/' + out.join('/')
}

/**
 * Wait for every `<img>` in the container to either load or error.
 * Uses a **single shared deadline** (8s by default) so a document
 * with N broken remote images still completes in ~8s total — the
 * older per-image 5s timeout scaled linearly with image count in
 * the worst case and was wasteful when the page is otherwise
 * ready.
 */
async function waitForImages(root: HTMLElement, deadlineMs = 8000): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (images.length === 0) return
  const started = Date.now()
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          const done = () => {
            img.removeEventListener('load', done)
            img.removeEventListener('error', done)
            resolve()
          }
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
          // Clamp the per-image timeout to whatever's left of the
          // shared deadline so the total wait is bounded.
          const remaining = Math.max(0, deadlineMs - (Date.now() - started))
          setTimeout(done, remaining)
        }),
    ),
  )
}

/**
 * Rewrite `<img src="…">` references to Tauri's `asset:` protocol
 * so the hidden rendering container can actually load them. We
 * only rewrite relative URLs; absolute `http(s):` and inline
 * `data:` URLs pass through untouched.
 */
function resolveImageSources(root: HTMLElement, notePath: string): void {
  const noteDir = notePath
  if (!noteDir) return
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (!src) continue
    if (
      src.startsWith('http:') ||
      src.startsWith('https:') ||
      src.startsWith('data:') ||
      src.startsWith('asset:') ||
      src.startsWith('blob:')
    ) {
      continue
    }
    const abs = resolveRelativePath(noteDir, src)
    try {
      img.setAttribute('src', convertFileSrc(abs))
    } catch {
      // convertFileSrc only throws for malformed paths; fall back
      // to the original src so the export still completes.
    }
  }
}

// ─── PDF generation helper ───────────────────────────────────────────────────

/**
 * Split a single child element that is taller than one page into
 * multiple page-sized chunks. The caller (the page-grouping
 * algorithm) only invokes this on elements whose height exceeds
 * `maxHeight`, so we know we need at least one split.
 *
 * Supported element types:
 *  - `<pre>` — split by text lines. This is by far the most common
 *    oversized block (a long fenced code block) so we implement
 *    it explicitly. The per-line height is the CSS line-height
 *    applied by the page's `<style>` (font-size 12 × line-height
 *    1.6 ≈ 19.2px); we use that to decide how many lines fit on a
 *    page.
 *  - everything else — fall back to a single-chunk "best effort"
 *    output that the page's `overflow: hidden` will clip. Better
 *    than silently dropping the tail.
 */
function splitOversizedChild(
  child: HTMLElement,
  maxHeight: number,
): HTMLElement[] {
  if (child.tagName === 'PRE') {
    // Approximate per-line height. The rendered line-height in
    // the page stylesheet is `font-size: 12px; line-height: 1.6`
    // which gives ~19.2 px per line. We pad the budget slightly
    // for the wrapper padding/border.
    const lineHeight = 19.2
    const linesPerPage = Math.max(1, Math.floor(maxHeight / lineHeight))
    const sourceText = child.textContent ?? ''
    const allLines = sourceText.split('\n')
    if (allLines.length <= linesPerPage) {
      return [child]
    }
    const out: HTMLElement[] = []
    for (let i = 0; i < allLines.length; i += linesPerPage) {
      const chunk = allLines.slice(i, i + linesPerPage)
      const part = child.cloneNode(false) as HTMLElement
      // Preserve the original tag (PRE) and CSS classes so the
      // page stylesheet still applies; replace the text content
      // with the slice's lines. We don't preserve inner <code>
      // wrapping (the host template flattens to a text node) but
      // a single <pre> child is enough for the visual treatment.
      part.textContent = chunk.join('\n')
      out.push(part)
    }
    return out
  }
  // Unknown oversized child: return as-is. The page-level
  // `overflow: hidden` will clip the tail. Documented as a known
  // limitation in the README; an editor user can split it
  // manually.
  return [child]
}

/**
 * Languages that have a client-side renderer we want to swap into
 * the hidden container before screenshotting. We only post-process
 * the three most common ones; anything else is left as the
 * raw `<pre>` produced by `markdown_to_html`. The list is the
 * contract with the backend's `convert.rs::render_code_block`
 * marker, which appends `"(前端渲染)"` to the same language tags
 * in the DOCX so the reader knows the PDF / HTML pipeline
 * produces a rendered figure.
 */
const CUSTOM_BLOCK_LANGS = ['mermaid', 'katex', 'markmap'] as const

/**
 * 渲染 mermaid/katex/markmap 代码块为 PNG 图片，
 * 返回 `{ assetKey: base64_png_no_prefix }` 映射。
 * assetKey 格式：`__{lang}_{index}__`，与后端 convert.rs 一致。
 *
 * 扫描 markdown 中所有前端渲染类代码块，按出现顺序分配序号，
 * 使用对应的渲染库（mermaid.js / KaTeX / markmap-view）渲染后
 * 通过 `domToCanvas` 截取为 PNG 图片。
 */
async function renderCustomBlocksForDocx(
  markdown: string,
): Promise<Record<string, string>> {
  // 扫描所有前端渲染类代码块，记录语言和序号
  const blockPattern = /```(mermaid|katex|markmap)\n([\s\S]*?)```/g
  const blocks: { lang: string; index: number; source: string }[] = []
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = blockPattern.exec(markdown)) !== null) {
    blocks.push({ lang: match[1], index: idx, source: match[2] })
    idx++
  }
  if (blocks.length === 0) return {}

  // 动态 import 渲染库
  const [mermaid, katex, markmap] = await Promise.all([
    import('mermaid' as any).catch(() => null),
    import('katex' as any).catch(() => null),
    import('markmap-view' as any).catch(() => null),
  ])

  // mermaid 需要初始化
  if (mermaid) {
    try {
      mermaid.default.initialize({ startOnLoad: false, securityLevel: 'loose' })
    } catch { /* 忽略重复初始化错误 */ }
  }

  // 逐块渲染 → Canvas → PNG
  const result: Record<string, string> = {}
  for (const block of blocks) {
    try {
      const pngBase64 = await renderBlockToPng(block, mermaid, katex, markmap)
      if (pngBase64) {
        result[`__${block.lang}_${block.index}__`] = pngBase64
      }
    } catch (e) {
      console.warn(`[export] render ${block.lang} block ${block.index} failed`, e)
    }
  }
  return result
}

/**
 * 将单个代码块渲染为 PNG base64（无 data: 前缀）。
 * 在屏幕外创建临时 DOM 容器，渲染后通过 domToCanvas 截取。
 */
async function renderBlockToPng(
  block: { lang: string; index: number; source: string },
  mermaid: any, katex: any, markmap: any,
): Promise<string | null> {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:0;top:0;transform:translateX(-200vw);background:#fff;padding:16px;z-index:-1;pointer-events:none;'
  document.body.appendChild(container)

  try {
    if (block.lang === 'mermaid' && mermaid) {
      const id = `mermaid-docx-${block.index}-${Math.random().toString(36).slice(2, 6)}`
      const { svg } = await mermaid.default.render(id, block.source)
      container.innerHTML = svg
    } else if (block.lang === 'katex' && katex) {
      const html = katex.default.renderToString(block.source, {
        displayMode: true,
        throwOnError: false,
      })
      container.innerHTML = html
      // KaTeX 渲染需要字体加载，短暂等待
      await new Promise((r) => setTimeout(r, 100))
    } else if (block.lang === 'markmap' && markmap) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.style.width = '720px'
      svg.style.height = '400px'
      const mm = markmap.Markmap.create(svg, undefined, block.source)
      await mm.fit()
      await new Promise((r) => setTimeout(r, 200))
      container.appendChild(svg)
    } else {
      return null
    }

    // DOM → Canvas → PNG
    const canvas = await domToCanvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
    })
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png')
    })
    const buf = await blob.arrayBuffer()
    return await uint8ToBase64(new Uint8Array(buf))
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * Post-process the hidden HTML container so that every
 * `<pre><code class="language-mermaid|katex|markmap">` block is
 * replaced with the corresponding rendered figure (SVG / HTML
 * fragment). The three renderers (`mermaid`, `katex`,
 * `markmap-view`) are loaded via dynamic `import()` from the
 * `devDependencies` declared in `package.json` — they don't
 * end up in the production bundle, only the import shim
 * Vite emits for them. The first call to a renderer triggers
 * module resolution and adds ~200ms to that export; subsequent
 * calls hit the module cache.
 *
 * Failure policy: any single block (or the entire post-process)
 * that throws is logged and the original `<pre>` is kept. The
 * main `generatePdfFromHtml` flow is never blocked by a
 * custom-block failure — a broken diagram should not stop the
 * rest of the document from being exported.
 */
async function renderCustomBlocksForPdf(root: HTMLElement): Promise<void> {
  // Select every fenced code block whose language tag is one of
  // the three we know how to render. The selector intentionally
  // targets `<pre><code>` (not bare `<code>`) so we never touch
  // inline code spans, which can't be rendered as figures.
  const blocks = Array.from(
    root.querySelectorAll<HTMLPreElement>(
      'pre > code.language-mermaid, pre > code.language-katex, pre > code.language-markmap',
    ),
  )
  if (blocks.length === 0) return

  // Dynamic import. The `as any` cast keeps TypeScript happy
  // without forcing us to add `@types/mermaid` etc — these
  // modules don't ship types and the cast is the same shape
  // every other plugin uses. `.catch(() => null)` degrades
  // gracefully when CSP blocks the import: the matching
  // `if (mermaid)` / `if (katex)` / `if (markmap)` guards
  // below then keep the original `<pre>` in place.
  const [mermaid, katex, markmap] = await Promise.all([
    import('mermaid' as any).catch(() => null),
    import('katex' as any).catch(() => null),
    import('markmap-view' as any).catch(() => null),
  ])

  // mermaid needs a one-time `initialize` per webview; we
  // ignore re-init errors (the config is idempotent).
  if (mermaid) {
    try {
      mermaid.default.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
      })
    } catch (e) {
      console.warn('[export] mermaid init failed', e)
    }
  }

  for (const codeEl of blocks) {
    const lang = CUSTOM_BLOCK_LANGS.find((l) =>
      codeEl.classList.contains(`language-${l}`),
    )
    if (!lang) continue
    const source = codeEl.textContent ?? ''
    if (!source.trim()) continue

    try {
      if (lang === 'mermaid' && mermaid) {
        // mermaid needs a unique id per render; we generate a
        // short random suffix to avoid clashes when the same
        // document is exported multiple times in one session.
        const id = `mermaid-export-${Math.random().toString(36).slice(2, 8)}`
        const { svg } = await mermaid.default.render(id, source)
        const wrap = document.createElement('div')
        wrap.className = 'export-mermaid'
        wrap.innerHTML = svg
        codeEl.parentElement?.replaceWith(wrap)
      } else if (lang === 'katex' && katex) {
        // `displayMode: true` so multi-line equations render as
        // a centered block (matches how KaTeX shows them in
        // BlockNote). `throwOnError: false` renders an
        // unsupported macro as the literal source — much
        // friendlier than a runtime crash.
        const html = katex.default.renderToString(source, {
          displayMode: true,
          throwOnError: false,
        })
        const wrap = document.createElement('div')
        wrap.className = 'export-katex'
        wrap.innerHTML = html
        codeEl.parentElement?.replaceWith(wrap)
      } else if (lang === 'markmap' && markmap) {
        // markmap needs an explicit SVG size; without it the
        // node sees `clientWidth = 0` in the hidden container
        // and the layout silently fails. We then `mm.fit()` +
        // a 200ms timer to let markmap's internal d3 transition
        // settle before the canvas snapshot.
        const { Markmap } = markmap
        const svg = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg',
        )
        svg.setAttribute('class', 'export-markmap')
        svg.style.width = '720px'
        svg.style.height = '400px'
        const mm = Markmap.create(svg, undefined, source)
        await mm.fit()
        await new Promise((r) => setTimeout(r, 200))
        const wrap = document.createElement('div')
        wrap.className = 'export-markmap-wrap'
        wrap.appendChild(svg)
        codeEl.parentElement?.replaceWith(wrap)
      }
    } catch (e) {
      // Per-block failure: log and leave the original <pre>.
      // The loop continues with the next block.
      console.warn(`[export] ${lang} render failed`, e)
    }
  }
}

/**
 * Render the HTML produced by the backend into a multi-page PDF
 * buffer. The implementation:
 *
 *  1. Mounts the HTML into a hidden fixed-position container so the
 *     layout is computed without disrupting the editor.
 *  2. Rewrites image references to Tauri's asset protocol (so
 *     `![](relative/path.png)` actually loads).
 *  3. Awaits every `<img>` load (with a single shared 8s deadline)
 *     so the screenshot doesn't capture half-rendered images.
 *  4. Groups the body's direct children into A4-sized pages by
 *     measuring each child's height and breaking when the running
 *     total exceeds one page's content area. Children that are
 *     themselves taller than a page (e.g. a `<pre>` with hundreds
 *     of lines) are split into multiple sub-pages by their own
 *     line-level measurement, so the rendered PDF never silently
 *     drops the tail of an oversized block.
 *  5. Renders **each page separately** to its own canvas via
 *     `modern-screenshot`, then emits one `pdf.addImage` per page.
 *     Bounded-canvas rendering means a 100-page export uses the
 *     same per-canvas memory as a 1-page export — a single-canvas
 *     strategy would OOM the webview on long documents.
 *
 * The function is intentionally side-effect free w.r.t. the
 * editor: every container it creates is removed in `finally`.
 */
async function generatePdfFromHtml(
  htmlContent: string,
  notePath: string,
): Promise<Uint8Array> {
  // Inner content area per page: A4 height minus 20px top + 20px
  // bottom padding. Children that don't fit trigger a page break.
  const PAGE_INNER_HEIGHT = A4_HEIGHT_PX - 40

  // Mount the full HTML into a hidden fixed-position container so
  // the layout is computed without disrupting the editor. The
  // <style> rules in the template's <head> are in scope for the
  // entire document, which is what we want — they style the cloned
  // children we render per page below.
  //
  // **Off-screen strategy (the previous `left: -9999px` was a
  // trap)**: a layout-changing offset like `left: -9999px` makes
  // the browser repaint the page geometry, and Tauri 2.0's
  // `Window::on_window_event` then misidentifies the resulting
  // scroll-area re-layout as a window-resize event, aborting
  // the export with "Application size must not change during
  // operation". We move the container off-screen with a
  // `transform: translateX(-200vw)` instead — transforms are
  // paint-only (no layout reflow, no scroll-area change), so
  // Tauri's resize detection never fires. `visibility: hidden`
  // and `pointer-events: none` are belt-and-braces so the
  // container can't accidentally steal focus or hover events.
  // `getBoundingClientRect` still returns the un-transformed
  // layout rect, so the page-grouping logic below is unaffected.
  const container = document.createElement('div')
  container.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'transform: translateX(-200vw)',
    `width: ${A4_WIDTH_PX}px`,
    'z-index: -1',
    'background: #fff',
    'pointer-events: none',
    'visibility: hidden',
  ].join(';')
  container.innerHTML = htmlContent
  document.body.appendChild(container)

  // Page containers that we need to remove in the finally block.
  const pageContainers: HTMLElement[] = []

  try {
    // Pre-flight: rewrite <img> refs and wait for them to load.
    resolveImageSources(container, notePath)
    // Custom-block post-process: render every mermaid / katex /
    // markmap fenced block into the hidden container so the
    // canvas snapshot picks up the figure instead of the raw
    // source. The renderer libraries are dynamically imported
    // from `devDependencies` (see `renderCustomBlocksForPdf`),
    // so this only pays the module-resolution cost on the
    // first export that contains such a block. The whole call
    // is wrapped in try/catch so a broken diagram never blocks
    // the rest of the PDF — we fall through to the unmodified
    // `<pre>` and let the screenshot capture the source.
    try {
      await renderCustomBlocksForPdf(container)
    } catch (e) {
      console.warn('[export] renderCustomBlocksForPdf failed', e)
    }
    await waitForImages(container)

    // Locate the document body produced by the markdown-to-html
    // template. If absent, fall back to the wrapper itself.
    const body =
      (container.querySelector('body') as HTMLElement | null) || container

    // Group body's direct children into pages by height. Each
    // group of children, when laid out one after the other, must
    // fit within PAGE_INNER_HEIGHT. Children that are themselves
    // taller than a page (e.g. a single huge code block) are
    // sub-split by `splitOversizedChild` so we never silently
    // overflow-clip an entire block.
    const children = Array.from(body.children) as HTMLElement[]
    const pages: HTMLElement[][] = (() => {
      const result: HTMLElement[][] = []
      let current: HTMLElement[] = []
      let currentHeight = 0
      for (const child of children) {
        const h = child.getBoundingClientRect().height
        if (h > PAGE_INNER_HEIGHT) {
          // Flush whatever we were accumulating first so the
          // oversized child starts on its own fresh page.
          if (current.length > 0) {
            result.push(current)
            current = []
            currentHeight = 0
          }
          // Split the oversized child into multi-page chunks.
          for (const part of splitOversizedChild(child, PAGE_INNER_HEIGHT)) {
            result.push([part])
          }
          continue
        }
        if (currentHeight + h > PAGE_INNER_HEIGHT && current.length > 0) {
          result.push(current)
          current = []
          currentHeight = 0
        }
        current.push(child)
        currentHeight += h
      }
      if (current.length > 0) result.push(current)
      return result
    })()

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    for (let i = 0; i < pages.length; i++) {
      // Each page is rendered in its own fixed-position container.
      // The container's height is bounded by A4_HEIGHT_PX so the
      // resulting canvas is also bounded — this is the core of the
      // multi-segment strategy. `overflow: hidden` clips content
      // that doesn't fit, which is what we want for a fixed-size
      // page anyway.
      //
      // Same off-screen strategy as the master container above:
      // `transform: translateX(-200vw)` is paint-only, so the
      // browser's layout / scroll-area stays unchanged and Tauri's
      // resize-event detection can't flag the export.
      const pageEl = document.createElement('div')
      pageEl.style.cssText = [
        'position: fixed',
        'left: 0',
        'top: 0',
        'transform: translateX(-200vw)',
        `width: ${A4_WIDTH_PX}px`,
        `height: ${A4_HEIGHT_PX}px`,
        'background: #fff',
        'padding: 20px',
        'box-sizing: border-box',
        'overflow: hidden',
        'z-index: -1',
        'pointer-events: none',
        'visibility: hidden',
      ].join(';')
      // Deep-clone the children. The CSS rules from the master's
      // <head><style> apply globally to the document, so the
      // cloned children pick up the same fonts/colors/margins
      // they had in the master.
      for (const child of pages[i]) {
        pageEl.appendChild(child.cloneNode(true))
      }
      document.body.appendChild(pageEl)
      pageContainers.push(pageEl)

      // cloneNode(true) creates fresh <img> elements that haven't
      // loaded yet, so we have to re-resolve and re-wait even
      // though the originals have completed loading in the master.
      resolveImageSources(pageEl, notePath)
      await waitForImages(pageEl)

      const canvas = await domToCanvas(pageEl, {
        scale: 2,
        width: A4_WIDTH_PX,
        height: A4_HEIGHT_PX,
        backgroundColor: '#ffffff',
      })
      const imgData = canvas.toDataURL('image/png')
      const imgWidth = pdfWidth
      // The captured canvas is at most A4_HEIGHT_PX * scale tall
      // (because the page container is bounded). We still compute
      // the proportional height and clamp it to pdfHeight in case
      // the captured image is shorter than the page (e.g. trailing
      // whitespace).
      const imgHeight = (canvas.height * pdfWidth) / canvas.width
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, Math.min(imgHeight, pdfHeight))

      if (i < pages.length - 1) {
        pdf.addPage()
      }
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    for (const el of pageContainers) {
      if (el.parentNode) el.parentNode.removeChild(el)
    }
    if (container.parentNode) container.parentNode.removeChild(container)
  }
}

// ─── Toolbar button component (dropdown menu) ────────────────────────────────

function ExportToolbarButton(props: ToolbarButtonProps): ReactNode {
  const {
    size,
    invokeBackend,
    activeNoteContent,
    activeNotePath,
    activeNoteName,
    activeNoteExt,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  // We track the in-flight state via both a ref (for synchronous
  // guard, so double-clicks inside the same microtask don't
  // double-fire) and a state variable (for re-rendering the UI).
  const exportingRef = useRef(false)
  const [isExporting, setIsExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // The plugin reads its own locale (no `react-i18next` runtime
  // needed). `readLocale()` is called at render time so a host
  // re-render that updates `window.__SWALLOW_LOCALE__` will be
  // picked up on the next render.
  const strings = getStrings(readLocale())

  const isMarkdown = activeNoteExt === 'md' || activeNoteExt === 'markdown'

  // Derive note name from path. Falls back to the full path so
  // the user always sees a meaningful filename in the save
  // dialog. Prefers the host-supplied `activeNoteName` so the
  // path-parsing rules stay in one place.
  const noteName = activeNoteName || activeNotePath
    ? activeNotePath.split('/').pop() || activeNotePath
    : 'untitled'

  // The export is only enabled when the active note has content.
  // We compare against the *raw* `activeNoteContent` because the
  // normalisation step (whitespace trimming) happens inside the
  // handlers, and a document with only whitespace is still
  // considered "empty".
  const hasContent = activeNoteContent.trim().length > 0

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  /**
   * Shared scaffolding for the export flows. Centralises the
   * synchronous guard, the toast lifecycle, the save dialog, and
   * the base64 file write. The actual conversion happens inside
   * `produce` so the three formats can share the same UX plumbing.
   * HTML is wired through the same path as DOCX/PDF — the backend
   * already produces a complete HTML document via `markdown_to_html`
   * (the same one the PDF path feeds into `domToCanvas`), so we
   * reuse it for the direct-save variant instead of going through
   * the PDF rasteriser.
   */
  const runExport = useCallback(
    async (
      format: 'docx' | 'pdf' | 'html',
      produce: () => Promise<Uint8Array | string>,
    ) => {
      // Synchronous guard: a second click inside the same
      // microtask (e.g. double-click) is dropped before the
      // async setter has a chance to flip the state.
      if (exportingRef.current) return
      if (!hasContent) {
        toast.info(strings.emptyNote)
        return
      }
      exportingRef.current = true
      setIsExporting(true)
      setMenuOpen(false)
      const toastId = toast.loading(strings.generating)
      try {
        const result = await produce()
        const ext = format
        const fileName =
          (noteName || 'untitled').replace(/\.(md|markdown)$/i, '') +
          `.${ext}`
        const defaultPath = fileName
        const filters =
          format === 'docx'
            ? [{ name: 'Word Document', extensions: ['docx'] }]
            : format === 'pdf'
              ? [{ name: 'PDF Document', extensions: ['pdf'] }]
              : [{ name: 'HTML Document', extensions: ['html', 'htm'] }]
        const selected = await save({ defaultPath, filters })
        if (!selected) {
          // User cancelled the save dialog. The loading toast must
          // be dismissed explicitly — none of the success/error
          // branches below will run, so without this `toastId` is
          // orphaned and "正在生成…" stays on screen forever.
          toast.dismiss(toastId)
          return
        }
        const filePath = (selected as string).replace(/\\/g, '/')
        // DOCX / PDF come back as base64 strings (or Uint8Array for
        // PDF) from the backend. HTML is already a string and is
        // uploaded as-is. `uint8ToBase64` is now async (FileReader)
        // — the previous `String.fromCharCode.apply` path
        // stack-overflowed on multi-megabyte PDF buffers.
        const b64 = typeof result === 'string' ? result : await uint8ToBase64(result)
        await invoke('write_binary_file', { path: filePath, data: b64 })
        toast.success(strings.exportSuccess, { id: toastId })
      } catch (err) {
        // Branch on the JSON-RPC `code` field (extracted from
        // the host's wrapped error) rather than substring
        // matching the human-readable message. The codes are
        // documented in `RPC_ERR_*` and `ERR_*` constants near
        // the top of this file.
        const { code, message } = extractErrCode(err)
        if (code === ERR_MARKDOWN_TOO_LARGE) {
          toast.error(strings.tooLarge, { id: toastId, description: message })
        } else if (format === 'pdf') {
          toast.error(strings.pdfExportFailed, { id: toastId, description: message })
        } else if (format === 'html') {
          toast.error(strings.htmlExportFailed, { id: toastId, description: message })
        } else {
          toast.error(strings.exportFailed, { id: toastId, description: message })
        }
      } finally {
        exportingRef.current = false
        setIsExporting(false)
      }
    },
    [hasContent, noteName, strings],
  )

  const handleExportDocx = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('docx', async () => {
      // 并行收集图片资源和渲染前端渲染类代码块
      const [imageAssets, renderedAssets] = await Promise.all([
        collectImageAssets(markdown, activeNotePath),
        renderCustomBlocksForDocx(markdown),
      ])
      const b64 = (await invokeBackend('markdown_to_docx', {
        markdown,
        imageAssets,
        renderedAssets,
      })) as string
      return b64
    })
  }, [activeNoteContent, activeNotePath, invokeBackend, runExport])

  const handleExportPdf = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('pdf', async () => {
      const html = (await invokeBackend('markdown_to_html', {
        markdown,
      })) as string
      return await generatePdfFromHtml(html, activeNotePath)
    })
  }, [activeNoteContent, activeNotePath, invokeBackend, runExport])

  // HTML export reuses the backend's `markdown_to_html` response
  // (the same one the PDF path uses internally to drive the
  // rasteriser) and saves it directly as a `.html` file. No
  // canvas / pagination logic needed — the file the user opens
  // in a browser will be a pixel-perfect mirror of what the
  // editor previewed (modulo fonts / stylesheet differences on
  // the viewing machine).
  const handleExportHtml = useCallback(async () => {
    const markdown = compactMarkdown(activeNoteContent)
    await runExport('html', async () => {
      return (await invokeBackend('markdown_to_html', {
        markdown,
      })) as string
    })
  }, [activeNoteContent, invokeBackend, runExport])

  // Markdown-only: the backend serialises Markdown to HTML / DOCX /
  // PDF, so the toolbar button only makes sense for Markdown files.
  // The host passes the lower-cased `activeNoteExt` (without the
  // leading dot) so we can branch on the extension directly
  // instead of re-parsing `activeNotePath`. Returning `null` for
  // non-Markdown files hides the entire dropdown (and its icon)
  // from the editor toolbar, which is the desired behaviour for
  // `Code` / `Binary` / `MindMap` notes.
  if (!isMarkdown) {
    return null
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
        style={{ color: menuOpen ? 'var(--theme-color)' : 'var(--text-primary)' }}
        title={strings.tooltip}
        aria-label={strings.tooltip}
      >
        <ExportIcon size={size} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[140px]"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <button
            onClick={handleExportDocx}
            disabled={isExporting || !hasContent}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            style={{
              color: 'var(--text-primary)',
              background: 'transparent',
              border: 'none',
              cursor: isExporting || !hasContent ? 'not-allowed' : 'pointer',
            }}
            aria-busy={isExporting}
          >
            <span style={{ fontSize: 10 }}>W</span>
            {strings.wordMenu}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isExporting || !hasContent}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            style={{
              color: 'var(--text-primary)',
              background: 'transparent',
              border: 'none',
              cursor: isExporting || !hasContent ? 'not-allowed' : 'pointer',
            }}
            aria-busy={isExporting}
          >
            <span style={{ fontSize: 10 }}>P</span>
            {strings.pdfMenu}
          </button>
          <button
            onClick={handleExportHtml}
            disabled={isExporting || !hasContent}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            style={{
              color: 'var(--text-primary)',
              background: 'transparent',
              border: 'none',
              cursor: isExporting || !hasContent ? 'not-allowed' : 'pointer',
            }}
            aria-busy={isExporting}
          >
            <span style={{ fontSize: 10 }}>H</span>
            {strings.htmlMenu}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Placeholder panel ────────────────────────────────────────────────────

function ExportPanel(_props: PluginPanelProps): ReactNode {
  return null
}

// ─── Manifest ─────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: 'com.swallownote.export',
  name: '文档导出',
  description: '将 Markdown 文档导出为 Word (.docx) / PDF / HTML 格式',
  version: '0.2.3',
  author: 'SwallowNote',
  publishedAt: '2026-06-13',
  iconPosition: 'editorToolbar',
  contentPosition: 'editorArea',
  order: 50,
  enabled: true,
  // `hasBackend` is not part of `PluginManifest`; the host fills it
  // in on `PluginDefinition` from the presence of `backend/` in the
  // installed zip. See SDK docs.
  icon: ExportIcon,
  panel: ExportPanel,
  toolbarButton: ExportToolbarButton,
  permissions: ['backend'],
}

export default manifest
