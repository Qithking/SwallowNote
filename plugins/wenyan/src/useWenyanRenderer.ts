/**
 * Wenyan Core rendering hook.
 *
 * Manages the async lifecycle of:
 *   1. createWenyanCore() — one-time init, two instances: wechat + other
 *   2. handleFrontMatter() — strip YAML front matter
 *   3. renderMarkdown() — markdown → raw HTML
 *   4. applyStylesWithTheme() — inject theme CSS + code highlight
 *   5. getContentForXxx() — platform-specific post-processing
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

export type Platform = 'wechat' | 'toutiao' | 'zhihu' | 'juejin' | 'medium'

export const PLATFORMS: ReadonlyArray<{ id: Platform; name: string }> = [
  { id: 'wechat', name: '公众号' },
  { id: 'toutiao', name: '头条' },
  { id: 'zhihu', name: '知乎' },
  { id: 'juejin', name: '掘金' },
  { id: 'medium', name: 'Medium' },
]

export const PLATFORM_DEFAULT_THEME: Record<Platform, string> = {
  wechat: 'default',
  toutiao: 'toutiao_default',
  zhihu: 'zhihu_default',
  juejin: 'juejin_default',
  medium: 'medium_default',
}

export interface ThemeOverrides {
  /** Primary color used for headings, links and footnotes. */
  primaryColor: string
  /** Background color for blockquotes. */
  blockquoteBg: string
  /** Global text color. */
  textColor: string
}

export interface ParagraphOptions {
  /** Base font-size of the article (applied to #wenyan). */
  fontSize: number
  /** Line height. */
  lineHeight: number
  /** Font family: 'sans-serif' | 'serif' | 'monospace'. */
  fontFamily: 'sans-serif' | 'serif' | 'monospace'
  /** Spacing between paragraphs (margin-top + margin-bottom on #wenyan p). */
  paragraphSpacing: 'compact' | 'standard' | 'loose'
  /** Text alignment for paragraphs. */
  textAlign: 'left' | 'center' | 'right' | 'justify'
  /** First line indent. 0 = off, 2 = 2em indent. */
  textIndent: 0 | 2
}

export interface CodeBlockOptions {
  /** Border radius on #wenyan pre. */
  borderRadius: 0 | 5 | 10
  /** Font size for code blocks. */
  fontSize: 11 | 12 | 13 | 14
  /** Box shadow on #wenyan pre. */
  shadow: 'none' | 'light' | 'heavy'
  /** Mac-style traffic-light dots on code blocks. */
  isMacStyle: boolean
}

export interface RenderOptions {
  platform: Platform
  themeId: string
  hlThemeId: string
  /** Footnote auto-generation (WeChat only). */
  isAddFootnote: boolean
  themeOverrides: ThemeOverrides
  paragraphOptions: ParagraphOptions
  codeBlockOptions: CodeBlockOptions
}

const FONT_FAMILY_CSS: Record<ParagraphOptions['fontFamily'], string> = {
  'sans-serif': `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`,
  'serif': `Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif`,
  'monospace': `"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
}

const PARAGRAPH_SPACING_CSS: Record<ParagraphOptions['paragraphSpacing'], string> = {
  compact: '0.3em 0',
  standard: '1em 0',
  loose: '1.6em 0',
}

const SHADOW_CSS: Record<CodeBlockOptions['shadow'], string> = {
  none: 'none',
  light: '0 1px 3px rgba(0,0,0,0.1)',
  heavy: 'rgba(0,0,0,0.55) 0 1px 5px',
}

/** Build a <style> tag string that overrides the article's theme CSS. */
function buildOverrideCss(opts: RenderOptions): string {
  const lines: string[] = []
  // Theme overrides.
  lines.push(`#wenyan { color: ${opts.themeOverrides.textColor}; }`)
  lines.push(
    `#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6 { color: ${opts.themeOverrides.primaryColor}; }`
  )
  lines.push(`#wenyan a, #wenyan .footnote { color: ${opts.themeOverrides.primaryColor}; }`)
  lines.push(`#wenyan blockquote { background-color: ${opts.themeOverrides.blockquoteBg}; }`)

  // Paragraph overrides.
  const p = opts.paragraphOptions
  lines.push(
    `#wenyan { font-size: ${p.fontSize}px !important; line-height: ${p.lineHeight} !important; font-family: ${FONT_FAMILY_CSS[p.fontFamily]} !important; }`
  )
  lines.push(`#wenyan p { margin: ${PARAGRAPH_SPACING_CSS[p.paragraphSpacing]} !important; text-align: ${p.textAlign} !important; text-indent: ${p.textIndent}em !important; }`)

  // Code block overrides.
  const c = opts.codeBlockOptions
  lines.push(
    `#wenyan pre { border-radius: ${c.borderRadius}px !important; font-size: ${c.fontSize}px !important; box-shadow: ${SHADOW_CSS[c.shadow]} !important; }`
  )

  return lines.join('\n')
}

/** Apply user overrides as a <style> tag appended to the article root. */
function applyOverrides(article: HTMLElement, opts: RenderOptions): void {
  // Remove any existing override tag from a previous render to avoid
  // stacking <style> nodes when the user toggles settings quickly.
  const existing = article.querySelector(':scope > style[data-wenyan-overrides]')
  if (existing) existing.remove()
  const style = document.createElement('style')
  style.setAttribute('data-wenyan-overrides', 'true')
  style.textContent = buildOverrideCss(opts)
  article.appendChild(style)
}

export function useWenyanRenderer() {
  // Two cores: one with WeChat post-processing, one neutral for the
  // other platforms. The library captures `isWechat` in closure, so we
  // need a separate instance per setting.
  const wechatCoreRef = useRef<WenyanCoreInstance | null>(null)
  const otherCoreRef = useRef<WenyanCoreInstance | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureCore = useCallback(
    async (isWechat: boolean): Promise<WenyanCoreInstance> => {
      const targetRef = isWechat ? wechatCoreRef : otherCoreRef
      if (targetRef.current) return targetRef.current
      const mod = await getWenyanModule()
      mod.registerAllBuiltInThemes()
      mod.registerBuiltInHlThemes()
      // Enable mermaid using the library's built-in browser renderer.
      const mermaidRenderer = mod.createBrowserMermaidRenderer()
      const instance = await mod.createWenyanCore({
        isConvertMathJax: true,
        isWechat,
        mermaid: { renderer: mermaidRenderer },
      })
      targetRef.current = instance as WenyanCoreInstance
      return targetRef.current
    },
    []
  )

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
        // WeChat platform uses the WeChat core; all other platforms use
        // the neutral core plus their own post-processing function.
        const isWechatPlatform = options.platform === 'wechat'
        const wenyan = await ensureCore(isWechatPlatform)
        const fm = await wenyan.handleFrontMatter(markdown)
        const rawHtml = await wenyan.renderMarkdown(fm.content)
        const article = ensureContainer()
        article.innerHTML = rawHtml
        // applyStylesWithTheme modifies the article in place. The Mac-
        // style flag is sourced from codeBlockOptions so it lives in
        // the same setting group as the other code block controls.
        const styledHtml = await wenyan.applyStylesWithTheme(article, {
          themeId: options.themeId,
          hlThemeId: options.hlThemeId,
          isMacStyle: options.codeBlockOptions.isMacStyle,
          isAddFootnote: options.isAddFootnote,
        })
        // For non-WeChat platforms, run the platform-specific post-
        // processing. It mutates the article in place and returns its
        // outerHTML.
        let finalHtml = styledHtml
        if (!isWechatPlatform) {
          const mod = await getWenyanModule()
          const platformFn =
            options.platform === 'toutiao'
              ? mod.getContentForToutiao
              : options.platform === 'zhihu'
                ? mod.getContentForZhihu
                : options.platform === 'medium'
                  ? mod.getContentForMedium
                  : null
          if (platformFn) {
            finalHtml = platformFn(article)
          }
          // Juejin: no platform-specific function, styledHtml is final.
        }
        // Append user overrides as a <style> tag inside the article so
        // they ride along with the copied HTML.
        applyOverrides(article, options)
        setHtml(article.outerHTML)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[wenyan] render failed:', e)
        setError(msg)
        setHtml('')
      } finally {
        setLoading(false)
      }
    },
    [ensureCore, ensureContainer]
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
