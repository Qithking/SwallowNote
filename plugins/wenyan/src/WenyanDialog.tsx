/**
 * Wenyan Typesetting Dialog — 90vw×90vh modal for preview and copy.
 *
 * Layout:
 *   - Left sidebar (240px): theme picker, hl-theme picker, toggles
 *   - Right main area: preview iframe + copy button
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useWenyanRenderer, type RenderOptions } from './useWenyanRenderer'
import { copyHtmlToClipboard } from './copyHtml'

interface WenyanDialogProps {
  open: boolean
  onClose: () => void
  activeNoteContent: string
}

// Default settings.
const DEFAULT_OPTIONS: RenderOptions = {
  themeId: 'default',
  hlThemeId: 'solarized-light',
  isMacStyle: true,
  isAddFootnote: true,
}

// Debounce helper.
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function WenyanDialog(props: WenyanDialogProps): ReactNode {
  const { open, onClose, activeNoteContent } = props
  const { html, loading, error, render } = useWenyanRenderer()
  const [options, setOptions] = useState<RenderOptions>(DEFAULT_OPTIONS)
  const [themes, setThemes] = useState<Array<{ id: string; name: string }>>([])
  const [hlThemes, setHlThemes] = useState<Array<{ id: string; name: string }>>([])
  const [copyBusy, setCopyBusy] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const debouncedContent = useDebounce(activeNoteContent, 300)

  // Load theme lists once.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      const mod = await import('@wenyan-md/core')
      mod.registerAllBuiltInThemes()
      mod.registerBuiltInHlThemes()
      const gzh = mod.getAllGzhThemes()
      const hl = mod.getAllHlThemes()
      if (cancelled) return
      setThemes(gzh.map((t: unknown) => {
        const theme = t as Record<string, unknown>
        const id = String(theme.id ?? '')
        return { id, name: String(theme.name ?? id) }
      }))
      setHlThemes(hl.map((t: unknown) => {
        const theme = t as Record<string, unknown>
        const id = String(theme.id ?? '')
        return { id, name: String(theme.name ?? id) }
      }))
    }
    load()
    return () => { cancelled = true }
  }, [open])

  // Render on content / option changes.
  useEffect(() => {
    if (!open) return
    render(debouncedContent, options)
  }, [open, debouncedContent, options, render])

  // Sync preview DOM with rendered html.
  useEffect(() => {
    if (previewRef.current && html) {
      previewRef.current.innerHTML = html
    }
  }, [html])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleCopy = useCallback(async () => {
    if (copyBusy || !html) return
    setCopyBusy(true)
    try {
      const result = await copyHtmlToClipboard(html)
      if (result.ok) {
        if (result.method === 'clipboard-html') {
          toast.success('已复制到剪贴板（带样式）')
        } else {
          toast.warning(result.warning || '已复制')
        }
      } else {
        toast.error('复制失败，请手动复制')
      }
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`)
    } finally {
      setCopyBusy(false)
    }
  }, [copyBusy, html])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
        }}
      />

      {/* Dialog content */}
      <div
        style={{
          position: 'relative',
          width: '90vw',
          height: '90vh',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>文颜排版预览</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              color: '#6b7280',
              lineHeight: 1,
            }}
            title="关闭"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left sidebar */}
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid #e5e7eb',
              padding: 16,
              overflowY: 'auto',
              background: '#f9fafb',
            }}
          >
            <Section title="文章主题">
              <select
                value={options.themeId}
                onChange={(e) => setOptions((o) => ({ ...o, themeId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111',
                }}
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Section>

            <Section title="代码高亮">
              <select
                value={options.hlThemeId}
                onChange={(e) => setOptions((o) => ({ ...o, hlThemeId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111',
                }}
              >
                {hlThemes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Section>

            <Section title="排版选项">
              <Toggle
                label="macOS 风格"
                checked={options.isMacStyle}
                onChange={(v) => setOptions((o) => ({ ...o, isMacStyle: v }))}
              />
              <Toggle
                label="自动脚注"
                checked={options.isAddFootnote}
                onChange={(v) => setOptions((o) => ({ ...o, isAddFootnote: v }))}
              />
            </Section>

            <div style={{ marginTop: 20 }}>
              <button
                onClick={handleCopy}
                disabled={copyBusy || !html || loading}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: 'none',
                  background: copyBusy || !html || loading ? '#d1d5db' : '#111827',
                  color: '#fff',
                  cursor: copyBusy || !html || loading ? 'not-allowed' : 'pointer',
                }}
              >
                {copyBusy ? '复制中…' : '复制到剪贴板'}
              </button>
            </div>
          </div>

          {/* Right preview */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: '#f3f4f6',
            }}
          >
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  top: 56,
                  right: 24,
                  zIndex: 10,
                  padding: '6px 12px',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                渲染中…
              </div>
            )}

            {error && (
              <div
                style={{
                  margin: 16,
                  padding: 12,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  color: '#b91c1c',
                  fontSize: 13,
                }}
              >
                渲染失败: {error}
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 24,
              }}
            >
              <div
                ref={previewRef}
                style={{
                  maxWidth: 720,
                  margin: '0 auto',
                  background: '#fff',
                  minHeight: '100%',
                  padding: '32px 24px',
                  boxSizing: 'border-box',
                  borderRadius: 4,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          marginBottom: 8,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactNode {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 0',
        cursor: 'pointer',
        fontSize: 13,
        color: '#374151',
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    </label>
  )
}
