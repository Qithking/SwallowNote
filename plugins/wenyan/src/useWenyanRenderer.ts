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
      themeCss?: string
      hlThemeId?: string
      hlThemeCss?: string
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
  /** Base font-size of the article (applied to #wenyan). 9 steps from 12→20. */
  fontSize: 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  /** Line height ratio (CSS line-height). */
  lineHeight: 1.25 | 1.5 | 1.75 | 2
  /** Additional line spacing in em. Added to lineHeight via CSS calc:
   *  `line-height: calc(<lineHeight> + <lineSpacing>em)`. */
  lineSpacing: 0 | 0.1 | 0.2 | 0.3
  /** Font family: 'sans-serif' | 'serif' | 'monospace'. */
  fontFamily: 'sans-serif' | 'serif' | 'monospace'
  /** Letter spacing. */
  letterSpacing: 'tight' | 'small' | 'normal' | 'loose'
  /** Spacing between paragraphs (margin-top + margin-bottom on #wenyan p). */
  paragraphSpacing: 'compact' | 'small' | 'standard' | 'loose'
  /** Text alignment for paragraphs. */
  textAlign: 'left' | 'center' | 'right' | 'justify'
  /** First line indent. 0 = off, 2 = 2em indent. */
  textIndent: 0 | 2
}

export interface CodeBlockOptions {
  /** Border radius on #wenyan pre. */
  borderRadius: 0 | 5 | 10
  /** Font size for code blocks. 7 steps from 12→18. */
  fontSize: 12 | 13 | 14 | 15 | 16 | 17 | 18
  /** Box shadow on #wenyan pre. */
  shadow: 'none' | 'light' | 'heavy'
  /** Mac-style traffic-light dots on code blocks. */
  isMacStyle: boolean
}

export interface RenderOptions {
  platform: Platform
  themeId: string
  hlThemeId: string
  /** Optional raw CSS for a custom theme. When set, takes precedence over `themeId`. */
  customThemeCss: string | null
  /** Footnote auto-generation (WeChat only). */
  isAddFootnote: boolean
  themeOverrides: ThemeOverrides
  /** When true, theme color overrides (primary / blockquote / text) are
   * skipped and the article follows the colors of the selected theme. */
  themeFollowTheme: boolean
  paragraphOptions: ParagraphOptions
  paragraphFollowTheme: boolean
  codeBlockOptions: CodeBlockOptions
  codeBlockFollowTheme: boolean
}

const FONT_FAMILY_CSS: Record<ParagraphOptions['fontFamily'], string> = {
  'sans-serif': `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`,
  'serif': `Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif`,
  'monospace': `"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
}

const LETTER_SPACING_CSS: Record<ParagraphOptions['letterSpacing'], string> = {
  tight: '-0.02em',
  small: '-0.01em',
  normal: '0',
  loose: '0.05em',
}

const PARAGRAPH_SPACING_CSS: Record<ParagraphOptions['paragraphSpacing'], string> = {
  compact: '0.3em 0',
  small: '0.5em 0',
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
  // Theme color overrides — only applied when the user opts out of
  // "跟随主题". Mirrors the behavior of paragraphFollowTheme /
  // codeBlockFollowTheme so the three setting groups stay consistent.
  if (!opts.themeFollowTheme) {
    const t = opts.themeOverrides
    lines.push(`#wenyan { color: ${t.textColor}; }`)
    lines.push(
      `#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6 { color: ${t.primaryColor}; }`
    )
    lines.push(`#wenyan a, #wenyan .footnote { color: ${t.primaryColor}; }`)
    lines.push(`#wenyan blockquote { background-color: ${t.blockquoteBg}; }`)
  }

  // Paragraph overrides — only when not following theme.
  if (!opts.paragraphFollowTheme) {
    const p = opts.paragraphOptions
    // Combine 行高 (line-height ratio) and 行间距 (extra em) via calc.
    // When lineSpacing is 0 the calc degenerates to the bare ratio,
    // which the browser treats as a unitless line-height.
    const lineHeightCss =
      p.lineSpacing === 0
        ? String(p.lineHeight)
        : `calc(${p.lineHeight} + ${p.lineSpacing}em)`
    lines.push(
      `#wenyan { font-size: ${p.fontSize}px !important; line-height: ${lineHeightCss} !important; font-family: ${FONT_FAMILY_CSS[p.fontFamily]} !important; letter-spacing: ${LETTER_SPACING_CSS[p.letterSpacing]} !important; }`
    )
    lines.push(
      `#wenyan p { margin: ${PARAGRAPH_SPACING_CSS[p.paragraphSpacing]} !important; text-align: ${p.textAlign} !important; text-indent: ${p.textIndent}em !important; }`
    )
  }

  // Code block overrides — only when not following theme.
  if (!opts.codeBlockFollowTheme) {
    const c = opts.codeBlockOptions
    lines.push(
      `#wenyan pre { border-radius: ${c.borderRadius}px !important; font-size: ${c.fontSize}px !important; box-shadow: ${SHADOW_CSS[c.shadow]} !important; }`
    )
  }

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
  // Render ID for cancelling stale async renders. Each call to `render`
  // increments this ref; after each `await` checkpoint the render checks
  // if it's still the latest — if not, it bails out without updating state.
  // This prevents a slow earlier render from overwriting a faster later one.
  const renderIdRef = useRef(0)
  const [html, setHtml] = useState('')
  const [title, setTitle] = useState('')
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
      // Assign a unique ID to this render call. After each `await` we
      // check if a newer render has started; if so, this one is stale
      // and we bail out without touching state.
      // NOTE: This must run BEFORE the empty-markdown early return so
      // that a previous in-progress render is properly cancelled.
      const renderId = ++renderIdRef.current
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
        if (renderId !== renderIdRef.current) return // stale
        const fm = await wenyan.handleFrontMatter(markdown)
        if (renderId !== renderIdRef.current) return // stale
        setTitle(fm.title || '')
        const rawHtml = await wenyan.renderMarkdown(fm.content)
        if (renderId !== renderIdRef.current) return // stale
        const article = ensureContainer()
        article.innerHTML = rawHtml
        // applyStylesWithTheme modifies the article in place. The Mac-
        // style flag is sourced from codeBlockOptions so it lives in
        // the same setting group as the other code block controls.
        // If a custom theme CSS is set, it takes precedence over the
        // built-in themeId lookup.
        const applyOptions: Parameters<WenyanCoreInstance['applyStylesWithTheme']>[1] = {
          themeId: options.customThemeCss ? undefined : options.themeId,
          hlThemeId: options.hlThemeId,
          isMacStyle: options.codeBlockOptions.isMacStyle,
          isAddFootnote: options.isAddFootnote,
        }
        if (options.customThemeCss) {
          applyOptions.themeCss = options.customThemeCss
        }
        await wenyan.applyStylesWithTheme(article, applyOptions)
        if (renderId !== renderIdRef.current) return // stale
        // For non-WeChat platforms, run the platform-specific post-
        // processing. It mutates the article in place and returns its
        // outerHTML.
        if (!isWechatPlatform) {
          const mod = await getWenyanModule()
          if (renderId !== renderIdRef.current) return // stale
          const platformFn =
            options.platform === 'toutiao'
              ? mod.getContentForToutiao
              : options.platform === 'zhihu'
                ? mod.getContentForZhihu
                : options.platform === 'medium'
                  ? mod.getContentForMedium
                  : null
          if (platformFn) {
            platformFn(article)
          }
          // Juejin: no platform-specific function, the article is
          // used as-is after `applyStylesWithTheme` mutates it.
        }
        // Append user overrides as a <style> tag inside the article so
        // they ride along with the copied HTML.
        applyOverrides(article, options)
        if (renderId !== renderIdRef.current) return // stale
        setHtml(article.outerHTML)
      } catch (e) {
        if (renderId !== renderIdRef.current) return // stale
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[wenyan] render failed:', e)
        setError(msg)
        setHtml('')
      } finally {
        // Only clear loading if this is still the latest render;
        // otherwise a newer render is in charge of the loading state.
        if (renderId === renderIdRef.current) {
          setLoading(false)
        }
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

  return { html, title, loading, error, render }
}
