/**
 * Floating panel for the typist plugin.
 *
 * Renders inside `editorArea` (a floating card on top of the editor).
 * Layout: top bar with theme picker + action buttons; two-column body
 * with a read-only Markdown source on the left and the rendered
 * themed HTML on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { usePluginStorage } from '@swallow-note/plugin-sdk'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { STATIC_THEMES, DEFAULT_THEME_ID, DEFAULT_PLATFORM } from '../lib/themes'
import { copyToClipboard, type CopyResult } from '../lib/copyToClipboard'
import { sanitizeHtmlForWeChat } from '../lib/htmlSanitizer'
import { CopyIcon, SaveIcon, CloseIcon } from './icons'

export function TypistPanel(panel: PluginPanelProps): ReactNode {
  const { activeNoteContent, activeNotePath, close, invokeBackend } = panel
  const { t } = useTranslation()

  // Persisted user preferences
  const [themeId, setThemeId] = usePluginStorage<string>(panel, 'theme', DEFAULT_THEME_ID)
  const [platform] = usePluginStorage<string>(panel, 'platform', DEFAULT_PLATFORM)

  // Live state
  const [renderedHtml, setRenderedHtml] = useState<string>('')
  const [isRendering, setIsRendering] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [lastRenderMs, setLastRenderMs] = useState<number>(0)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic id assigned to each scheduled render. The async callback
  // ignores its result if a newer render has been queued in the
  // meantime — this is what protects us from race conditions where
  // a slow render for an old note overwrites a fast render for the
  // current one.
  const renderIdRef = useRef(0)

  // Debounced re-render whenever the active note or theme changes.
  // 800ms matches the cadence in mdnice and feels responsive without
  // thrashing the backend for every keystroke.
  useEffect(() => {
    if (!activeNoteContent) {
      setRenderedHtml('')
      return
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    const myId = ++renderIdRef.current
    debounceTimer.current = setTimeout(() => {
      void renderHtml(
        activeNoteContent,
        themeId,
        platform,
        invokeBackend,
        (html, ms) => {
          // Drop the result if a newer render has been scheduled
          // since this one fired. Otherwise the slow render of an
          // old note would clobber the latest preview.
          if (myId !== renderIdRef.current) return
          setRenderedHtml(html)
          setLastRenderMs(ms)
        },
        (rendering) => {
          if (myId !== renderIdRef.current) return
          setIsRendering(rendering)
        },
      )
    }, 800)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [activeNoteContent, themeId, platform, invokeBackend])

  const onCopy = useCallback(async () => {
    if (isCopying || !renderedHtml) return
    setIsCopying(true)
    try {
      const safe = sanitizeHtmlForWeChat(renderedHtml)
      const result: CopyResult = await copyToClipboard(safe, previewRef.current)
      if (result.ok) {
        if (result.method === 'clipboard-html') {
          toast.success('已复制到剪贴板（带样式）')
        } else if (result.method === 'clipboard-text') {
          toast.warning(result.warning)
        } else {
          // Image fallback: hand the data URL to a save dialog
          await saveImageDataUrl(result.dataUrl, deriveBaseName(activeNotePath))
          toast.success('已保存为 PNG，请拖入公众号编辑器')
        }
      } else {
        toast.error(result.error)
      }
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`)
    } finally {
      setIsCopying(false)
    }
  }, [isCopying, renderedHtml, activeNotePath])

  const onSaveHtml = useCallback(async () => {
    if (!renderedHtml) return
    try {
      const baseName = deriveBaseName(activeNotePath)
      const fullDoc = wrapStandaloneHtml(renderedHtml, themeId)
      const target = await save({
        defaultPath: `${baseName}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (!target) return
      const path = (typeof target === 'string' ? target : target).replace(/\\/g, '/')
      await invoke('write_text_file', { path, content: fullDoc })
      toast.success('已保存为 HTML')
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`)
    }
  }, [renderedHtml, activeNotePath, themeId])

  const wordCount = useMemo(() => countWords(activeNoteContent), [activeNoteContent])
  const codeBlocks = useMemo(() => (activeNoteContent.match(/```/g)?.length ?? 0) / 2, [activeNoteContent])
  const imageCount = useMemo(() => (activeNoteContent.match(/!\[[^\]]*\]\([^)]+\)/g)?.length ?? 0), [activeNoteContent])
  // Sanitize before injecting into the preview DOM. The backend already
  // inlines styles and drops raw HTML, but defense-in-depth: a future
  // backend regression or a malicious note must not be able to inject
  // <script> via the preview. The cost is one regex pass per render
  // — negligible against the 800ms render budget.
  const safePreviewHtml = useMemo(
    () => (renderedHtml ? sanitizeHtmlForWeChat(renderedHtml) : ''),
    [renderedHtml],
  )

  return (
    <div
      style={{
        width: 'min(960px, 92vw)',
        maxHeight: '80vh',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        fontSize: 12,
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>排版</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          平台: 公众号
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          主题
          <select
            value={themeId}
            onChange={(e) => setThemeId(e.target.value)}
            style={{
              fontSize: 11,
              padding: '2px 4px',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
            }}
          >
            {STATIC_THEMES.map((th) => (
              <option key={th.id} value={th.id}>
                {th.name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {lastRenderMs > 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {lastRenderMs}ms
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          disabled={isCopying || !renderedHtml}
          style={actionBtnStyle}
        >
          <CopyIcon size={12} />
          复制到公众号
        </button>
        <button type="button" onClick={onSaveHtml} disabled={!renderedHtml} style={actionBtnStyle}>
          <SaveIcon size={12} />
          保存 HTML
        </button>
        <button type="button" onClick={close} style={actionBtnStyle} title="关闭">
          <CloseIcon size={12} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1,
          background: 'var(--border-color)',
          minHeight: 320,
          flex: 1,
        }}
      >
        <div
          style={{
            background: 'var(--bg-primary)',
            padding: 12,
            overflow: 'auto',
            fontFamily: 'SF Mono, Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-secondary)',
          }}
        >
          {activeNoteContent || (
            <span style={{ color: 'var(--text-muted)' }}>（当前笔记为空）</span>
          )}
        </div>
        <div
          ref={previewRef}
          style={{
            background: '#ffffff',
            padding: '20px 24px',
            overflow: 'auto',
            color: '#000',
            fontSize: 14,
            lineHeight: 1.75,
          }}
        >
          {isRendering && !renderedHtml ? (
            <div style={{ color: '#999' }}>渲染中…</div>
          ) : renderedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: safePreviewHtml }} />
          ) : (
            <div style={{ color: '#999' }}>预览将出现在这里</div>
          )}
        </div>
      </div>

      {/* Footer stats */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '6px 12px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          fontSize: 10,
          color: 'var(--text-muted)',
        }}
      >
        <span>字数: {wordCount.toLocaleString()}</span>
        <span>代码块: {codeBlocks}</span>
        <span>图片: {imageCount}</span>
      </div>
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

async function renderHtml(
  markdown: string,
  themeId: string,
  platform: string,
  invokeBackend: PluginPanelProps['invokeBackend'],
  onResult: (html: string, ms: number) => void,
  onRendering: (b: boolean) => void,
): Promise<void> {
  onRendering(true)
  const t0 = performance.now()
  try {
    const html = (await invokeBackend('markdown_to_themed_html', {
      markdown,
      theme: themeId,
      platform,
    })) as string
    onResult(html, Math.round(performance.now() - t0))
  } catch (e) {
    console.error('[typist] render failed:', e)
    onResult(`<p style="color:#c00">渲染失败: ${String(e)}</p>`, 0)
  } finally {
    onRendering(false)
  }
}

function countWords(s: string): number {
  // Same heuristic as the rest of the app: CJK = 1 per char, latin
  // = 1 per whitespace-separated word.
  return s.replace(/\s+/g, '').length
}

function deriveBaseName(path: string): string {
  if (!path) return 'untitled'
  const name = path.split('/').pop() || path
  return name.replace(/\.(md|markdown)$/i, '') || 'untitled'
}

function wrapStandaloneHtml(fragment: string, themeId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${themeId} export</title>
<style>
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
       max-width: 720px; margin: 40px auto; padding: 0 16px; color: #333; }
</style>
</head>
<body>
${fragment}
</body>
</html>`
}

async function saveImageDataUrl(dataUrl: string, baseName: string): Promise<void> {
  const target = await save({
    defaultPath: `${baseName}.png`,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (!target) return
  const path = (typeof target === 'string' ? target : target).replace(/\\/g, '/')
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  await invoke('write_binary_file', { path, data: b64 })
}
