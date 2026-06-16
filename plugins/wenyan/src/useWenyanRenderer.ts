/**
 * Wenyan Core rendering hook.
 *
 * Manages the async lifecycle of:
 *   1. createWenyanCore() — one-time init
 *   2. handleFrontMatter() — strip YAML front matter
 *   3. renderMarkdown() — markdown → raw HTML
 *   4. applyStylesWithTheme() — inject theme CSS + code highlight
 *
 * Returns { html, loading, error } triples so the UI can show
 * spinners and error states.
 */
import { useEffect, useRef, useState, useCallback } from 'react'

interface WenyanCoreInstance {
  handleFrontMatter: (markdown: string) => Promise<{
    content: string
    title?: string
  }>
  renderMarkdown: (markdown: string) => Promise<string>
  applyStylesWithTheme: (
    element: HTMLElement,
    options: {
      themeId?: string
      hlThemeId?: string
      isMacStyle?: boolean
      isAddFootnote?: boolean
    }
  ) => Promise<string>
}

let wenyanModule: typeof import('@wenyan-md/core') | null = null

async function getWenyanModule() {
  if (!wenyanModule) {
    wenyanModule = await import('@wenyan-md/core')
  }
  return wenyanModule
}

export interface RenderOptions {
  themeId: string
  hlThemeId: string
  isMacStyle: boolean
  isAddFootnote: boolean
}

export function useWenyanRenderer() {
  const wenyanRef = useRef<WenyanCoreInstance | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy-init wenyan core on first render request.
  const ensureWenyan = useCallback(async () => {
    if (wenyanRef.current) return wenyanRef.current
    const mod = await getWenyanModule()
    // Register built-in themes so getAllGzhThemes() etc. work.
    mod.registerAllBuiltInThemes()
    mod.registerBuiltInHlThemes()
    const instance = await mod.createWenyanCore({
      isConvertMathJax: true,
      isWechat: true,
    })
    wenyanRef.current = instance as WenyanCoreInstance
    return wenyanRef.current
  }, [])

  // Create a persistent off-screen container for applyStylesWithTheme.
  const ensureContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current
    const div = document.createElement('div')
    div.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      'transform: translateX(-200vw)',
      'width: 720px',
      'z-index: -1',
      'background: #fff',
      'pointer-events: none',
      'visibility: hidden',
    ].join(';')
    document.body.appendChild(div)
    containerRef.current = div
    return div
  }, [])

  const render = useCallback(
    async (markdown: string, options: RenderOptions) => {
      if (!markdown.trim()) {
        setHtml('')
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const wenyan = await ensureWenyan()
        const fm = await wenyan.handleFrontMatter(markdown)
        const rawHtml = await wenyan.renderMarkdown(fm.content)
        const container = ensureContainer()
        container.innerHTML = rawHtml
        const styledHtml = await wenyan.applyStylesWithTheme(container, {
          themeId: options.themeId,
          hlThemeId: options.hlThemeId,
          isMacStyle: options.isMacStyle,
          isAddFootnote: options.isAddFootnote,
        })
        setHtml(styledHtml)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[wenyan] render failed:', e)
        setError(msg)
        setHtml('')
      } finally {
        setLoading(false)
      }
    },
    [ensureWenyan, ensureContainer]
  )

  // Cleanup container on unmount.
  useEffect(() => {
    return () => {
      if (containerRef.current && containerRef.current.parentNode) {
        containerRef.current.parentNode.removeChild(containerRef.current)
        containerRef.current = null
      }
    }
  }, [])

  return { html, loading, error, render }
}
