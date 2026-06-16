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
    // Enable mermaid rendering using the library's built-in browser
    // renderer. Without a renderer, createWenyanCore throws when it
    // encounters a ```mermaid``` code block.
    const mermaidRenderer = mod.createBrowserMermaidRenderer()
    const instance = await mod.createWenyanCore({
      isConvertMathJax: true,
      isWechat: true,
      mermaid: { renderer: mermaidRenderer },
    })
    wenyanRef.current = instance as WenyanCoreInstance
    return wenyanRef.current
  }, [])

  // Create a persistent off-screen wrapper that contains the article root.
  // The wrapper is hidden; the article inside it is the element the wenyan
  // library processes. This separation matters because the library returns
  // `article.outerHTML` — if we set hidden styles on the article itself,
  // those styles leak into the preview and push the content off-screen.
  const ensureContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current
    const wrapper = document.createElement('div')
    wrapper.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      'width: 720px',
      'z-index: -1',
      'background: #fff',
      'pointer-events: none',
      'visibility: hidden',
    ].join(';')
    const article = document.createElement('div')
    article.id = 'wenyan'
    wrapper.appendChild(article)
    document.body.appendChild(wrapper)
    containerRef.current = article
    return article
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
        // Pass the article root (with id="wenyan") to the library. The
        // returned string is the article's outerHTML — no hidden styles.
        const article = ensureContainer()
        article.innerHTML = rawHtml
        const styledHtml = await wenyan.applyStylesWithTheme(article, {
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

  // Cleanup container on unmount. Remove the wrapper (which holds the
  // article), not the article itself.
  useEffect(() => {
    return () => {
      const article = containerRef.current
      const wrapper = article?.parentNode
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper)
      }
      containerRef.current = null
    }
  }, [])

  return { html, loading, error, render }
}
