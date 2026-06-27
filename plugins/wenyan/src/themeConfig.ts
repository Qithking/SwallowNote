/**
 * ThemeConfig —— 自定义主题的可视化数据模型。
 *
 * 设计原则（单一来源）：
 * - CustomTheme 仍然以 `css: string` 作为持久化字段。
 * - ThemeConfig 仅为派生视图：`cssToConfig(css)` 解析得到，
 *   `configToCss(config)` 反向生成。
 * - 编辑区永远只写 `editCss`；ThemeConfig 永远通过 cssToConfig 重新派生。
 *
 * 历史结构：最初只包含 `colors` / `typography` 两组，对应「全局」面板。
 * 当前结构：在保留 `colors` / `typography` 的基础上，新增 `heading` /
 * `paragraph` / `quote` 三个分组，对应 ElementStyleEditor 的 4 个分类面板。
 * 旧字段保留是为了向后兼容历史 CSS 数据（cssToConfig 仍会从旧选择器回填）。
 */
import type { BorderSpec, BoxSpacing, Display, TextAlign } from './components/ElementStyle'

export type FontFamily = 'sans-serif' | 'serif' | 'monospace' | (string & {})

/** FONT_FAMILY_CSS 中预设的 3 种关键字常量。 */
const PRESET_FONT_KEYS: readonly FontFamily[] = ['sans-serif', 'serif', 'monospace']

/**
 * 把 font-family 字符串归一化为 FontFamily 关键字。
 * - 命中「3 个 preset 关键字」或「对应的 FONT_FAMILY_CSS 全串」时返回该关键字
 *   （大小写不敏感、首尾空白容忍），这样 roundtrip 不会丢用户的栈选择。
 * - 命中 'system-ui' / 'inherit' 这类未注册关键字、或自定义栈（如
 *   '"Helvetica Neue", sans-serif'）时返回 null，调用方原样保留用户字符串。
 */
export function resolveFontFamily(raw: string | undefined): FontFamily | null {
  if (!raw) return 'sans-serif'
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  // 1. preset 关键字（精确匹配）
  for (const key of PRESET_FONT_KEYS) {
    if (key === lower) return key
  }
  // 2. preset 全串匹配（大小写不敏感）：用户选了 SF Mono 栈时
  //    在 cssToConfig 中归一化为 'monospace'，由 configToCss 还原成 FONT_FAMILY_CSS
  for (const key of PRESET_FONT_KEYS) {
    if (FONT_FAMILY_CSS[key as keyof typeof FONT_FAMILY_CSS].toLowerCase() === lower) {
      return key
    }
  }
  // 3. 未识别的字符串（自定义栈、system-ui、inherit 等）—— 原样保留
  return null
}

export interface ThemeColors {
  /** #wenyan { color: ... } —— 全文默认文字色 */
  textColor: string
  /** #wenyan h1..h6 { color: ... } —— 标题色（heading 面板的兜底） */
  headingColor: string
  /** #wenyan a { color: ... } —— 链接色 */
  linkColor: string
  /** #wenyan blockquote { background: ... } —— 引用块背景色（quote 面板的兜底） */
  blockquoteBg: string
  /** #wenyan blockquote { border-left: 4px solid ... } —— 引用块左边框色 */
  blockquoteBorderColor: string
  /** #wenyan blockquote { color: ... } —— 引用块文字色（quote 面板的兜底） */
  blockquoteTextColor: string
}

export interface ThemeTypography {
  /**
   * 字体族。可以是 3 个 preset 关键字（sans-serif/serif/monospace），
   * 也可以是任意 CSS 字符串（如 '"Helvetica Neue", sans-serif'），
   * 序列化为 CSS 时会原样输出（除非是 preset 关键字，此时走 FONT_FAMILY_CSS）。
   */
  fontFamily: FontFamily
  /** #wenyan { font-size: ... px } —— 正文字号 */
  fontSize: number
  /** #wenyan { line-height: ... } —— 行高（无单位，乘以字号） */
  lineHeight: number
  /** #wenyan { letter-spacing: ... px } —— 字间距，单位 px */
  letterSpacing: number
  /** #wenyan p { margin: ... } —— 段间距（保留为旧值映射） */
  paragraphSpacing: 'compact' | 'small' | 'standard' | 'loose'
  /** #wenyan p { text-align: ... } —— 段落对齐（paragraph 面板的兜底） */
  textAlign: 'left' | 'center' | 'right' | 'justify'
  /** #wenyan p { text-indent: ... em } —— 首行缩进（em 单位） */
  textIndent: 0 | 2
  /** #wenyan h1..h6 { font-weight: ... } —— 标题字重 */
  headingWeight: 'normal' | 'bold'
}

/**
 * 标题级别。`all` 表示 h1..h6 的公共基线（仅当 h1..h6 都未单独设置时
 * 才会输出为合并规则 `#wenyan h1..h6`；一旦任一 level 单独设置，则该
 * level 用独立选择器 `#wenyan h1 { ... }` 覆盖，`all` 仍作为兜底输出）。
 */
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'all'

/** 单个 heading level 可配置的字段（与 ElementStyle 兼容） */
export interface HeadingLevelFields {
  color?: string
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: TextAlign
  display?: Display
}

/**
 * 标题分组：按 level 划分，level 字段优先级高于 `all`。
 * - 仅 `all` 有值（其它 level 留空）→ 输出 `#wenyan h1..h6 { ... }` 合并规则
 * - 任一 h1..h6 有值 → 该 level 独立输出 `#wenyan h1 { ... }`，`all` 作为公共基线
 */
export type HeadingConfig = Partial<Record<HeadingLevel, HeadingLevelFields>>

/** 段落分组：#wenyan p 规则 */
export interface ParagraphConfig {
  fontFamily?: string
  fontSize?: number
  color?: string
  lineHeight?: number
  letterSpacing?: number
  textAlign?: TextAlign
  padding?: BoxSpacing
  margin?: BoxSpacing
  backgroundColor?: string
  backgroundImage?: string
  boxShadow?: 'none' | 'sm' | 'md' | 'lg'
  border?: BorderSpec
  borderRadius?: number
  display?: Display
}

/** 引用块分组：#wenyan blockquote 规则 */
export interface QuoteConfig {
  color?: string
  fontFamily?: string
  backgroundColor?: string
  backgroundImage?: string
  borderRadius?: number
  padding?: BoxSpacing
  margin?: BoxSpacing
  border?: BorderSpec
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: TextAlign
  boxShadow?: 'none' | 'sm' | 'md' | 'lg'
  display?: Display
}

export interface ThemeConfig {
  /** 旧字段，保留以兼容历史 CSS 数据 */
  colors: ThemeColors
  /** 旧字段，保留以兼容历史 CSS 数据；驱动「全局」面板 */
  typography: ThemeTypography
  /** 标题分组：对应「标题」面板（#wenyan h1..h6） */
  heading: HeadingConfig
  /** 段落分组：对应「段落」面板（#wenyan p） */
  paragraph: ParagraphConfig
  /** 引用分组：对应「引用」面板（#wenyan blockquote） */
  quote: QuoteConfig
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────

/** 段间距 → CSS margin 映射 */
const PARAGRAPH_SPACING_MARGIN: Record<ThemeTypography['paragraphSpacing'], string> = {
  compact: '0.3em 0',
  small: '0.5em 0',
  standard: '1em 0',
  loose: '1.6em 0',
}

/** 阴影档位 → CSS box-shadow 映射（与 ElementStyle/BoxShadowField 一致） */
const BOX_SHADOW_TO_CSS: Record<'none' | 'sm' | 'md' | 'lg', string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
}

/** 把 CSS box-shadow 字符串反匹配为档位 key。匹配失败返回 undefined。 */
function mapBoxShadowKey(value: string): 'none' | 'sm' | 'md' | 'lg' | undefined {
  const v = value.trim()
  if (/^none$/i.test(v)) return 'none'
  // 简单按位数匹配（与 BOX_SHADOW_TO_CSS 的输出对齐）
  if (/^0 1px 2px/.test(v)) return 'sm'
  if (/^0 4px 6px/.test(v)) return 'md'
  if (/^0 10px 15px/.test(v)) return 'lg'
  return undefined
}

/** 字体族 → CSS font-family 映射（与 WenyanDialog 的内置映射保持视觉一致） */
export const FONT_FAMILY_CSS: Record<FontFamily, string> = {
  'sans-serif':
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  'serif':
    'Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif',
  'monospace':
    '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
}

/** 默认值：与 EXAMPLE_CUSTOM_CSS 视觉一致。 */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  colors: {
    textColor: '#3f3f3f',
    headingColor: '#2c3e50',
    linkColor: '#1aad19',
    blockquoteBg: '#f5f5f5',
    blockquoteBorderColor: '#dfe2e5',
    blockquoteTextColor: '#6a737d',
  },
  typography: {
    fontFamily: 'sans-serif',
    fontSize: 16,
    lineHeight: 1.75,
    letterSpacing: 0,
    paragraphSpacing: 'standard',
    textAlign: 'left',
    textIndent: 0,
    headingWeight: 'bold',
  },
  heading: {
    all: { color: '#2c3e50' },
  },
  paragraph: {
    fontFamily: undefined,
    fontSize: undefined,
    color: '#3f3f3f',
    lineHeight: undefined,
    letterSpacing: undefined,
    textAlign: undefined,
    padding: undefined,
    margin: undefined,
  },
  quote: {
    color: '#6a737d',
    backgroundColor: '#f5f5f5',
    borderRadius: undefined,
    padding: undefined,
    border: { width: 0, style: 'none', color: '#dfe2e5' },
    fontSize: undefined,
    display: undefined,
  },
}

// ─── 4 边序列化/反序列化（单位：px） ────────────────────────────

function formatBox(value: BoxSpacing): string {
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

function parseBox(value: string): BoxSpacing | null {
  // 解析 4 个值；接受 px / em / 无单位。em 按 1em = 16px 转换为 px
  // （兼容旧版以 em 为单位的 CSS 数据）。
  const m = value.trim().match(/(-?\d+(?:\.\d+)?)\s*(px|em)?/gi)
  if (!m || m.length < 4) return null
  const toPx = (token: string): number => {
    const emMatch = /(-?\d+(?:\.\d+)?)\s*em/i.exec(token)
    if (emMatch) return Math.round(parseFloat(emMatch[1]) * 16)
    const pxMatch = /(-?\d+(?:\.\d+)?)\s*px/i.exec(token)
    if (pxMatch) return parseFloat(pxMatch[1])
    const rawMatch = /(-?\d+(?:\.\d+)?)/.exec(token)
    return rawMatch ? parseFloat(rawMatch[1]) : 0
  }
  return {
    top: toPx(m[0]),
    right: toPx(m[1]),
    bottom: toPx(m[2]),
    left: toPx(m[3]),
  }
}

/** 边框解析（border 简写 / border-left 旧形式） ──────────────────────── */

function parseBorder(value: string): BorderSpec | null {
  const v = value.trim()
  if (/^none$/i.test(v)) return { width: 0, style: 'none', color: 'transparent' }
  const m = /(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+(.+)$/i.exec(v)
  if (m) {
    return {
      width: parseFloat(m[1]),
      style: m[2].toLowerCase() as BorderSpec['style'],
      color: m[3].trim(),
    }
  }
  return null
}

// ─── 通用：从 CSS 文本中按选择器与属性提取值 ───────────────────────────

/** CSS 块（selector + declarations） */
export interface CssBlock {
  /** 完整选择器字符串（含 `,` 分割的多选择器） */
  selector: string
  /** 块内声明（不含外层大括号） */
  body: string
}

/**
 * Single-pass CSS 切分：把所有 selector { ... } 块抽成数组。
 * - 正确处理嵌套大括号（伪类等）
 * - 跳过 CSS 注释
 * - 保留原始空白 / 缩进
 *
 * 与多次 indexOf + extractBlock 相比，复杂度从 O(n×k) 降到 O(n)。
 */
export function parseAllBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = []
  let i = 0
  const len = css.length
  while (i < len) {
    // 跳过 CSS 注释
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? len : end + 2
      continue
    }
    // 找下一个 '{'
    const braceStart = css.indexOf('{', i)
    if (braceStart === -1) break
    // 提取 selector（去除前后空白与注释行）
    const selectorRaw = css.slice(i, braceStart)
    const selector = selectorRaw.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    // 配对 '}'（考虑嵌套）
    let depth = 1
    let j = braceStart + 1
    while (j < len && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      if (depth === 0) break
      j++
    }
    if (depth !== 0) break
    const body = css.slice(braceStart + 1, j)
    if (selector) blocks.push({ selector, body })
    i = j + 1
  }
  return blocks
}

/**
 * 在 css 中查找指定选择器块的起始位置，返回从 `{` 到匹配 `}` 的内容。
 * 保留供 cssToConfig 内部按指定 selector 提取属性。
 */
function extractBlock(css: string, selector: string): string | null {
  const idx = css.indexOf(selector)
  if (idx === -1) return null
  const braceStart = css.indexOf('{', idx)
  if (braceStart === -1) return null
  let depth = 1
  for (let i = braceStart + 1; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(braceStart + 1, i)
    }
  }
  return null
}

function extractValueFromSelector(
  css: string,
  selector: string,
  prop: string
): string | null {
  const block = extractBlock(css, selector)
  if (!block) return null
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[\\s;{])${escaped}\\s*:\\s*([^;]+?)\\s*(;|$)`, 'i')
  const m = re.exec(block)
  if (!m) return null
  return m[2].trim()
}

function extractColorFromSelector(
  css: string,
  selector: string,
  prop: string
): string | null {
  const raw = extractValueFromSelector(css, selector, prop)
  if (!raw) return null
  if (/^(#|rgb\()/i.test(raw.trim())) return raw.trim()
  return null
}

// ─── 数字解析辅助 ─────────────────────────────────────────────────────

function parsePxNumber(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim())
  if (m) return parseFloat(m[1])
  const m2 = /^(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (m2) return parseFloat(m2[1])
  return null
}

function parseEmNumber(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)em$/i.exec(value.trim())
  if (m) return parseFloat(m[1])
  return parsePxNumber(value)
}

function parseUnitless(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (m) return parseFloat(m[1])
  return null
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// ─── configToCss：ThemeConfig → CSS 字符串 ─────────────────────────────

/**
 * 将 ThemeConfig 序列化为 CSS 字符串。
 * 输出的选择器覆盖 #wenyan 及其下属常见元素。
 *
 * @param extraCss 未被识别的额外 CSS 段（来自 parseThemeCss）。
 *                 拼接在末尾以保留手写属性（list-style / transition / transform 等）。
 */
export function configToCss(config: ThemeConfig, extraCss: string = ''): string {
  const { colors, typography, heading, paragraph, quote } = config
  // 字体族：preset 关键字走预设长串，custom 字符串原样输出
  const fontFamilyCss = PRESET_FONT_KEYS.includes(typography.fontFamily)
    ? FONT_FAMILY_CSS[typography.fontFamily as keyof typeof FONT_FAMILY_CSS]
    : typography.fontFamily
  const paragraphMargin = PARAGRAPH_SPACING_MARGIN[typography.paragraphSpacing]
  const headingWeight = typography.headingWeight === 'bold' ? 700 : 400
  const letterSpacing = `${typography.letterSpacing}px`
  const textIndent = `${typography.textIndent}em`

  const blocks: string[] = []

  // #wenyan —— 全局文字 / 字体
  const rootDecls = [
    `  color: ${colors.textColor};`,
    `  font-size: ${typography.fontSize}px;`,
    `  line-height: ${typography.lineHeight};`,
    `  font-family: ${fontFamilyCss};`,
    `  letter-spacing: ${letterSpacing};`,
  ]
  blocks.push(`/* @category:global */\n#wenyan {\n${rootDecls.join('\n')}\n}`)

  // #wenyan h1..h6 —— 标题
  // 输出规则：
  //   1. 任一 h1..h6 单独设置 → 各自独立 selector；`all` 作为公共基线继续输出
  //   2. 仅 `all` 有内容 → 沿用合并规则 `#wenyan h1..h6 { ... }`（向后兼容）
  const allHeadingFields = heading.all ?? {}
  const individualLevels: Array<Exclude<HeadingLevel, 'all'>> = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  const individualWithFields = individualLevels.filter(
    (lv) => heading[lv] && Object.keys(heading[lv] as object).length > 0
  )

  // 字段 → CSS 声明（用于单个 level 块）
  const buildHeadingDecls = (fields: HeadingLevelFields): string[] => {
    const decls: string[] = []
    const color = fields.color ?? colors.headingColor
    decls.push(`  color: ${color};`)
    decls.push(`  font-weight: ${headingWeight};`)
    if (fields.fontFamily !== undefined) {
      const familyCss =
        fields.fontFamily in FONT_FAMILY_CSS
          ? FONT_FAMILY_CSS[fields.fontFamily as FontFamily]
          : fields.fontFamily
      decls.push(`  font-family: ${familyCss};`)
    }
    if (fields.fontSize !== undefined) decls.push(`  font-size: ${fields.fontSize}px;`)
    if (fields.lineHeight !== undefined) decls.push(`  line-height: ${fields.lineHeight};`)
    if (fields.letterSpacing !== undefined)
      decls.push(`  letter-spacing: ${fields.letterSpacing}px;`)
    if (fields.textAlign !== undefined) decls.push(`  text-align: ${fields.textAlign};`)
    if (fields.display !== undefined) decls.push(`  display: ${fields.display};`)
    return decls
  }

  if (individualWithFields.length === 0) {
    // 仅有 `all`（或全空）→ 输出合并规则
    blocks.push(
      `#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6 {\n${buildHeadingDecls(allHeadingFields).join(
        '\n'
      )}\n}`
    )
  } else {
    // 任一 level 单独设置 → `all` 作为公共基线
    if (Object.keys(allHeadingFields).length > 0) {
      blocks.push(
        `#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6 {\n${buildHeadingDecls(allHeadingFields).join(
          '\n'
        )}\n}`
      )
    }
    for (const lv of individualWithFields) {
      const merged: HeadingLevelFields = { ...allHeadingFields, ...(heading[lv] ?? {}) }
      blocks.push(`#wenyan ${lv} {\n${buildHeadingDecls(merged).join('\n')}\n}`)
    }
  }

  // #wenyan a —— 链接
  blocks.push(`#wenyan a {\n  color: ${colors.linkColor};\n}`)

  // #wenyan p —— 段落
  const paragraphDecls: string[] = []
  const paragraphColor = paragraph.color ?? colors.textColor
  paragraphDecls.push(`  color: ${paragraphColor};`)
  if (paragraph.fontFamily !== undefined) {
    const familyCss =
      paragraph.fontFamily in FONT_FAMILY_CSS
        ? FONT_FAMILY_CSS[paragraph.fontFamily as FontFamily]
        : paragraph.fontFamily
    paragraphDecls.push(`  font-family: ${familyCss};`)
  }
  if (paragraph.fontSize !== undefined)
    paragraphDecls.push(`  font-size: ${paragraph.fontSize}px;`)
  if (paragraph.lineHeight !== undefined)
    paragraphDecls.push(`  line-height: ${paragraph.lineHeight};`)
  if (paragraph.letterSpacing !== undefined)
    paragraphDecls.push(`  letter-spacing: ${paragraph.letterSpacing}px;`)
  const paragraphTextAlign = paragraph.textAlign ?? typography.textAlign
  paragraphDecls.push(`  text-align: ${paragraphTextAlign};`)
  if (paragraph.backgroundColor !== undefined)
    paragraphDecls.push(`  background-color: ${paragraph.backgroundColor};`)
  if (paragraph.backgroundImage !== undefined)
    paragraphDecls.push(`  background-image: ${paragraph.backgroundImage};`)
  if (paragraph.boxShadow !== undefined)
    paragraphDecls.push(`  box-shadow: ${BOX_SHADOW_TO_CSS[paragraph.boxShadow]};`)
  if (paragraph.border !== undefined) {
    if (paragraph.border.width > 0 && paragraph.border.style !== 'none') {
      paragraphDecls.push(
        `  border: ${paragraph.border.width}px ${paragraph.border.style} ${paragraph.border.color};`
      )
    } else {
      paragraphDecls.push(`  border: none;`)
    }
  }
  if (paragraph.borderRadius !== undefined)
    paragraphDecls.push(`  border-radius: ${paragraph.borderRadius}px;`)
  if (paragraph.display !== undefined) paragraphDecls.push(`  display: ${paragraph.display};`)
  if (paragraph.padding !== undefined) {
    paragraphDecls.push(`  padding: ${formatBox(paragraph.padding)};`)
  }
  // textIndent 与 padding 在 CSS 中是独立属性，二者并存即可
  paragraphDecls.push(`  text-indent: ${textIndent};`)
  if (paragraph.margin !== undefined) {
    paragraphDecls.push(`  margin: ${formatBox(paragraph.margin)};`)
  } else {
    paragraphDecls.push(`  margin: ${paragraphMargin};`)
  }
  blocks.push(`/* @category:paragraph */\n#wenyan p {\n${paragraphDecls.join('\n')}\n}`)

  // #wenyan blockquote —— 引用
  const quoteDecls: string[] = []
  const quoteColor = quote.color ?? colors.blockquoteTextColor
  quoteDecls.push(`  color: ${quoteColor};`)
  if (quote.fontFamily !== undefined) {
    const familyCss =
      quote.fontFamily in FONT_FAMILY_CSS
        ? FONT_FAMILY_CSS[quote.fontFamily as FontFamily]
        : quote.fontFamily
    quoteDecls.push(`  font-family: ${familyCss};`)
  }
  if (quote.backgroundColor !== undefined) {
    quoteDecls.push(`  background: ${quote.backgroundColor};`)
  } else {
    quoteDecls.push(`  background: ${colors.blockquoteBg};`)
  }
  if (quote.backgroundImage !== undefined)
    quoteDecls.push(`  background-image: ${quote.backgroundImage};`)
  // 优先使用新 border 字段；否则回退到旧的 border-left 形式
  if (quote.border !== undefined) {
    if (quote.border.width > 0 && quote.border.style !== 'none') {
      // 把 4 边相同的 border 转写为旧版的 border-left（保持最小视觉差异）
      quoteDecls.push(
        `  border-left: ${quote.border.width}px ${quote.border.style} ${quote.border.color};`
      )
    }
  } else {
    quoteDecls.push(`  border-left: 4px solid ${colors.blockquoteBorderColor};`)
  }
  if (quote.fontSize !== undefined) quoteDecls.push(`  font-size: ${quote.fontSize}px;`)
  if (quote.lineHeight !== undefined) quoteDecls.push(`  line-height: ${quote.lineHeight};`)
  if (quote.letterSpacing !== undefined)
    quoteDecls.push(`  letter-spacing: ${quote.letterSpacing}px;`)
  if (quote.textAlign !== undefined) quoteDecls.push(`  text-align: ${quote.textAlign};`)
  if (quote.boxShadow !== undefined)
    quoteDecls.push(`  box-shadow: ${BOX_SHADOW_TO_CSS[quote.boxShadow]};`)
  if (quote.padding !== undefined) quoteDecls.push(`  padding: ${formatBox(quote.padding)};`)
  if (quote.margin !== undefined) quoteDecls.push(`  margin: ${formatBox(quote.margin)};`)
  if (quote.borderRadius !== undefined)
    quoteDecls.push(`  border-radius: ${quote.borderRadius}px;`)
  if (quote.display !== undefined) quoteDecls.push(`  display: ${quote.display};`)
  blocks.push(`#wenyan blockquote {\n${quoteDecls.join('\n')}\n}`)

  // 末尾追加未被识别的 CSS（手写 list-style / transition / transform 等），
  // 避免 visual 编辑时把额外规则 roundtrip 丢失
  const trimmedExtra = extraCss.trim()
  if (trimmedExtra) blocks.push(`/* @category:extra */\n${trimmedExtra}`)

  return blocks.join('\n')
}

// ─── cssToConfig：CSS 字符串 → ThemeConfig（best-effort） ──────────────

function marginTopToSpacing(margin: string): ThemeTypography['paragraphSpacing'] | undefined {
  const m = /(-?\d+(?:\.\d+)?)\s*(em)?/i.exec(margin.trim())
  if (!m) return undefined
  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return undefined
  if (num <= 0.3) return 'compact'
  if (num <= 0.5) return 'small'
  if (num <= 1) return 'standard'
  return 'loose'
}

/** 解析结果：ThemeConfig + 未识别的 CSS（保留在原始 editCss 中的额外规则） */
export interface ParsedThemeCss {
  config: ThemeConfig
  /**
   * 未被任何已知选择器 / 字段覆盖的 CSS 段。
   * 写入 editCss 时由 configToCss 末尾追加，避免 roundtrip 时丢失手写属性
   * （如 list-style / transform / transition / filter 等）。
   */
  extraCss: string
}

/** ThemeConfig 能识别的 selector 集合。其它 selector 块进入 extraCss。 */
const KNOWN_SELECTORS: ReadonlySet<string> = new Set([
  '#wenyan',
  '#wenyan a',
  '#wenyan p',
  '#wenyan blockquote',
  '#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6',
  '#wenyan h1',
  '#wenyan h2',
  '#wenyan h3',
  '#wenyan h4',
  '#wenyan h5',
  '#wenyan h6',
])

/**
 * 把 css 拆为 { config, extraCss }。
 * - 已知 selector 走原 cssToConfig 解析；
 * - 未知 selector 块保留为 extraCss，由 configToCss 末尾追加。
 */
export function parseThemeCss(css: string): ParsedThemeCss {
  const config = cssToConfig(css)
  const allBlocks = parseAllBlocks(css)
  const extraLines: string[] = []
  for (const block of allBlocks) {
    if (!KNOWN_SELECTORS.has(block.selector)) {
      extraLines.push(`${block.selector} {\n${block.body}\n}`)
    }
  }
  return { config, extraCss: extraLines.join('\n\n') }
}

/**
 * 从 CSS 字符串 best-effort 解析为 ThemeConfig。
 * - 任何未匹配到的字段回退到 DEFAULT_THEME_CONFIG。
 * - 若想保留手写 CSS 额外规则，请改用 parseThemeCss() 拿到 extraCss。
 */
export function cssToConfig(css: string): ThemeConfig {
  const config: ThemeConfig = JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG))

  // ── #wenyan 全局 ────────────────────────────────────────────────────
  const textColor = extractColorFromSelector(css, '#wenyan {', 'color')
  if (textColor) config.colors.textColor = textColor

  const fontSizeMatch = extractValueFromSelector(css, '#wenyan {', 'font-size')
  if (fontSizeMatch) {
    const num = parsePxNumber(fontSizeMatch)
    if (num !== null) {
      config.typography.fontSize = clampNumber(Math.round(num), 8, 72)
    }
  }

  const lineHeightMatch = extractValueFromSelector(css, '#wenyan {', 'line-height')
  if (lineHeightMatch) {
    const num = parseUnitless(lineHeightMatch)
    if (num !== null) {
      config.typography.lineHeight = clampNumber(Math.round(num * 100) / 100, 0.8, 3)
    }
  }

  const fontFamilyRaw = extractValueFromSelector(css, '#wenyan {', 'font-family')
  if (fontFamilyRaw) {
    const resolved = resolveFontFamily(fontFamilyRaw)
    if (resolved !== null && PRESET_FONT_KEYS.includes(resolved)) {
      config.typography.fontFamily = resolved
    } else {
      // 非 preset 字符串（含 Helvetica Neue / PingFang 等自定义字体或 stack）
      // 原样保留，避免 roundtrip 失真
      config.typography.fontFamily = fontFamilyRaw
    }
  }

  const letterSpacingMatch = extractValueFromSelector(css, '#wenyan {', 'letter-spacing')
  if (letterSpacingMatch) {
    // 兼容旧版 em 数据：1em ≈ 16px
    const num = parseEmNumber(letterSpacingMatch) ?? parsePxNumber(letterSpacingMatch)
    if (num !== null) {
      config.typography.letterSpacing = clampNumber(Math.round(num), -10, 50)
    }
  }

  // ── #wenyan h1..h6 标题 ─────────────────────────────────────────────
  // 解析逻辑：
  //   - 先解析合并规则 `#wenyan h1..h6`（旧数据）→ 写回 `heading.all`
  //   - 再逐个解析独立 selector `#wenyan h1` / `#wenyan h2` / ... → 写回对应 level
  const HEADING_GROUP_SELECTOR =
    '#wenyan h1, #wenyan h2, #wenyan h3, #wenyan h4, #wenyan h5, #wenyan h6'

  type LevelKey = HeadingLevel
  const INDIVIDUAL_LEVELS: Exclude<HeadingLevel, 'all'>[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

  /**
   * 把单选 level 解析结果合并到 config.heading[level]。
   *
   * 注意：cssBlock 是已提取的块内容（不含选择器和大括号），
   * 因此不能用 extractValueFromSelector（它内部调 extractBlock
   * 搜索 selector + '{'）。这里直接用正则从块内容提取属性值。
   */
  const applyLevel = (level: LevelKey, cssBlock: string | null) => {
    if (!cssBlock) return
    const fields: HeadingLevelFields = {}

    /** 从已提取的块内容中按属性名提取值（正则匹配，不依赖 selector + '{'） */
    const extractProp = (block: string, prop: string): string | null => {
      // 先移除 CSS 注释，避免注释中的属性被错误提取
      const cleaned = block.replace(/\/\*[\s\S]*?\*\//g, '')
      const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[\\s;{])${escaped}\\s*:\\s*([^;]+?)\\s*(;|$)`, 'i')
      const m = re.exec(cleaned)
      return m ? m[2].trim() : null
    }

    const c = extractProp(cssBlock, 'color')
    if (c && /^(#|rgb\()/i.test(c)) fields.color = c
    const ff = extractProp(cssBlock, 'font-family')
    if (ff) fields.fontFamily = ff
    const fs = extractProp(cssBlock, 'font-size')
    if (fs) {
      const n = parsePxNumber(fs)
      if (n !== null) fields.fontSize = clampNumber(Math.round(n), 8, 72)
    }
    const lh = extractProp(cssBlock, 'line-height')
    if (lh) {
      const n = parseUnitless(lh)
      if (n !== null) fields.lineHeight = clampNumber(Math.round(n * 100) / 100, 0.8, 3)
    }
    const ls = extractProp(cssBlock, 'letter-spacing')
    if (ls) {
      const n = parseEmNumber(ls) ?? parsePxNumber(ls)
      if (n !== null) fields.letterSpacing = clampNumber(Math.round(n), -10, 50)
    }
    const ta = extractProp(cssBlock, 'text-align')
    if (ta && /^(left|center|right|justify)$/i.test(ta.trim())) {
      fields.textAlign = ta.trim().toLowerCase() as TextAlign
    }
    const d = extractProp(cssBlock, 'display')
    if (d) {
      const v = d.trim().toLowerCase()
      if (
        v === 'block' ||
        v === 'inline-block' ||
        v === 'inline' ||
        v === 'flex' ||
        v === 'grid' ||
        v === 'inline-flex' ||
        v === 'none'
      ) {
        fields.display = v as Display
      }
    }
    if (Object.keys(fields).length > 0) {
      config.heading[level] = { ...config.heading[level], ...fields }
    }
  }

  // 用 parseAllBlocks 做精确选择器匹配，避免 indexOf 子串匹配问题
  // （例如 '#wenyan h1' 会匹配合并选择器 '#wenyan h1, #wenyan h2, ...' 中的子串）
  const allBlocks = parseAllBlocks(css)
  const findBlock = (selector: string): string | null =>
    allBlocks.find((b) => b.selector === selector)?.body ?? null

  // 1. 合并规则 → all
  const allBlock = findBlock(HEADING_GROUP_SELECTOR) ?? extractBlock(css, HEADING_GROUP_SELECTOR)
  applyLevel('all', allBlock)
  // 兼容旧数据中只设置 #wenyan h1 的情况：把 h1 的字段也作为 all 的兜底
  if (!config.heading.all || Object.keys(config.heading.all).length === 0) {
    const h1Block = findBlock('#wenyan h1')
    applyLevel('all', h1Block)
  }

  // 2. 逐个独立 level 解析（覆盖 all 中的对应字段）
  for (const lv of INDIVIDUAL_LEVELS) {
    applyLevel(lv, findBlock(`#wenyan ${lv}`))
  }

  // heading 兜底色（colors.headingColor）：从 all.color 或 h1.color 中取
  const headingAllColor = config.heading.all?.color
  if (headingAllColor) {
    config.colors.headingColor = headingAllColor
  } else {
    const h1Color = config.heading.h1?.color
    if (h1Color) config.colors.headingColor = h1Color
  }

  // font-weight: 优先从合并规则块中提取，回退到独立 #wenyan h1 块。
  // 使用 findBlock 做精确选择器匹配，避免 indexOf 子串匹配问题。
  const headingWeightBlock = findBlock(HEADING_GROUP_SELECTOR) ?? findBlock('#wenyan h1')
  let headingWeightMatch: string | null = null
  if (headingWeightBlock) {
    // 移除 CSS 注释后再提取，避免注释中的 font-weight 被错误匹配
    const cleaned = headingWeightBlock.replace(/\/\*[\s\S]*?\*\//g, '')
    const m = /(^|[\s;{])font-weight\s*:\s*([^;]+?)\s*(;|$)/i.exec(cleaned)
    if (m) headingWeightMatch = m[2].trim()
  }
  if (headingWeightMatch) {
    const w = parseInt(headingWeightMatch, 10)
    if (Number.isFinite(w)) {
      config.typography.headingWeight = w >= 600 ? 'bold' : 'normal'
    } else if (/bold/i.test(headingWeightMatch)) {
      config.typography.headingWeight = 'bold'
    } else {
      config.typography.headingWeight = 'normal'
    }
  }

  // ── #wenyan a 链接 ──────────────────────────────────────────────────
  const linkColor = extractColorFromSelector(css, '#wenyan a', 'color')
  if (linkColor) config.colors.linkColor = linkColor

  // ── #wenyan p 段落 ──────────────────────────────────────────────────
  const paragraphColor = extractColorFromSelector(css, '#wenyan p', 'color')
  if (paragraphColor) {
    config.paragraph.color = paragraphColor
  }
  const paragraphFontSize = extractValueFromSelector(css, '#wenyan p', 'font-size')
  if (paragraphFontSize) {
    const num = parsePxNumber(paragraphFontSize)
    if (num !== null) config.paragraph.fontSize = clampNumber(Math.round(num), 8, 72)
  }
  const paragraphLineHeight = extractValueFromSelector(css, '#wenyan p', 'line-height')
  if (paragraphLineHeight) {
    const num = parseUnitless(paragraphLineHeight)
    if (num !== null) {
      config.paragraph.lineHeight = clampNumber(Math.round(num * 100) / 100, 0.8, 3)
    }
  }
  const paragraphLetterSpacing = extractValueFromSelector(css, '#wenyan p', 'letter-spacing')
  if (paragraphLetterSpacing) {
    const num = parseEmNumber(paragraphLetterSpacing) ?? parsePxNumber(paragraphLetterSpacing)
    if (num !== null) {
      config.paragraph.letterSpacing = clampNumber(Math.round(num), -10, 50)
    }
  }
  const paragraphFontFamily = extractValueFromSelector(css, '#wenyan p', 'font-family')
  if (paragraphFontFamily) {
    config.paragraph.fontFamily = paragraphFontFamily
  }
  const paragraphPadding = extractValueFromSelector(css, '#wenyan p', 'padding')
  if (paragraphPadding) {
    const bs = parseBox(paragraphPadding)
    if (bs) config.paragraph.padding = bs
  }
  const paragraphMargin = extractValueFromSelector(css, '#wenyan p', 'margin')
  if (paragraphMargin) {
    const bs = parseBox(paragraphMargin)
    if (bs) {
      config.paragraph.margin = bs
    }
    const spacing = marginTopToSpacing(paragraphMargin)
    if (spacing) config.typography.paragraphSpacing = spacing
  }
  const textAlign = extractValueFromSelector(css, '#wenyan p', 'text-align')
  if (textAlign && /^(left|center|right|justify)$/i.test(textAlign.trim())) {
    const t = textAlign.trim().toLowerCase() as TextAlign
    config.paragraph.textAlign = t
    config.typography.textAlign = t
  }
  const textIndent = extractValueFromSelector(css, '#wenyan p', 'text-indent')
  if (textIndent) {
    const num = parseEmNumber(textIndent)
    if (num !== null) config.typography.textIndent = num >= 1 ? 2 : 0
  }
  // 段落新字段：backgroundColor / backgroundImage / boxShadow / border / borderRadius / display
  const paragraphBgColor = extractColorFromSelector(css, '#wenyan p', 'background-color')
  if (paragraphBgColor) config.paragraph.backgroundColor = paragraphBgColor
  const paragraphBgImage = extractValueFromSelector(css, '#wenyan p', 'background-image')
  if (paragraphBgImage) config.paragraph.backgroundImage = paragraphBgImage
  const paragraphBoxShadow = extractValueFromSelector(css, '#wenyan p', 'box-shadow')
  if (paragraphBoxShadow) {
    const k = mapBoxShadowKey(paragraphBoxShadow)
    if (k) config.paragraph.boxShadow = k
  }
  const paragraphBorder = extractValueFromSelector(css, '#wenyan p', 'border')
  if (paragraphBorder) {
    const parsed = parseBorder(paragraphBorder)
    if (parsed) config.paragraph.border = parsed
  }
  const paragraphBorderRadius = extractValueFromSelector(css, '#wenyan p', 'border-radius')
  if (paragraphBorderRadius) {
    const num = parsePxNumber(paragraphBorderRadius)
    if (num !== null) config.paragraph.borderRadius = clampNumber(num, 0, 50)
  }
  const paragraphDisplay = extractValueFromSelector(css, '#wenyan p', 'display')
  if (paragraphDisplay) {
    const v = paragraphDisplay.trim().toLowerCase()
    if (
      v === 'block' ||
      v === 'inline-block' ||
      v === 'inline' ||
      v === 'flex' ||
      v === 'grid' ||
      v === 'inline-flex' ||
      v === 'none'
    ) {
      config.paragraph.display = v as Display
    }
  }

  // ── #wenyan blockquote 引用 ─────────────────────────────────────────
  const blockquoteText = extractColorFromSelector(css, '#wenyan blockquote', 'color')
  if (blockquoteText) {
    config.colors.blockquoteTextColor = blockquoteText
    config.quote.color = blockquoteText
  }
  const blockquoteBg = extractColorFromSelector(css, '#wenyan blockquote', 'background')
  if (blockquoteBg) {
    config.colors.blockquoteBg = blockquoteBg
    config.quote.backgroundColor = blockquoteBg
  }
  const blockquoteBgImage = extractValueFromSelector(css, '#wenyan blockquote', 'background-image')
  if (blockquoteBgImage) config.quote.backgroundImage = blockquoteBgImage
  const blockquoteFontSize = extractValueFromSelector(css, '#wenyan blockquote', 'font-size')
  if (blockquoteFontSize) {
    const num = parsePxNumber(blockquoteFontSize)
    if (num !== null) config.quote.fontSize = clampNumber(Math.round(num), 8, 72)
  }
  const blockquoteLineHeight = extractValueFromSelector(css, '#wenyan blockquote', 'line-height')
  if (blockquoteLineHeight) {
    const num = parseUnitless(blockquoteLineHeight)
    if (num !== null) config.quote.lineHeight = clampNumber(Math.round(num * 100) / 100, 0.8, 3)
  }
  const blockquoteLetterSpacing = extractValueFromSelector(
    css,
    '#wenyan blockquote',
    'letter-spacing'
  )
  if (blockquoteLetterSpacing) {
    const num = parseEmNumber(blockquoteLetterSpacing) ?? parsePxNumber(blockquoteLetterSpacing)
    if (num !== null) config.quote.letterSpacing = clampNumber(Math.round(num), -10, 50)
  }
  const blockquoteTextAlign = extractValueFromSelector(css, '#wenyan blockquote', 'text-align')
  if (blockquoteTextAlign && /^(left|center|right|justify)$/i.test(blockquoteTextAlign.trim())) {
    config.quote.textAlign = blockquoteTextAlign.trim().toLowerCase() as TextAlign
  }
  const blockquoteFontFamily = extractValueFromSelector(
    css,
    '#wenyan blockquote',
    'font-family'
  )
  if (blockquoteFontFamily) config.quote.fontFamily = blockquoteFontFamily
  const blockquoteMargin = extractValueFromSelector(css, '#wenyan blockquote', 'margin')
  if (blockquoteMargin) {
    const bs = parseBox(blockquoteMargin)
    if (bs) config.quote.margin = bs
  }
  const blockquoteBoxShadow = extractValueFromSelector(css, '#wenyan blockquote', 'box-shadow')
  if (blockquoteBoxShadow) {
    const k = mapBoxShadowKey(blockquoteBoxShadow)
    if (k) config.quote.boxShadow = k
  }
  const blockquoteBorderRadius = extractValueFromSelector(
    css,
    '#wenyan blockquote',
    'border-radius'
  )
  if (blockquoteBorderRadius) {
    const num = parsePxNumber(blockquoteBorderRadius)
    if (num !== null) config.quote.borderRadius = clampNumber(num, 0, 50)
  }
  const blockquotePadding = extractValueFromSelector(css, '#wenyan blockquote', 'padding')
  if (blockquotePadding) {
    const bs = parseBox(blockquotePadding)
    if (bs) config.quote.padding = bs
  }
  const blockquoteDisplay = extractValueFromSelector(css, '#wenyan blockquote', 'display')
  if (blockquoteDisplay) {
    const d = blockquoteDisplay.trim().toLowerCase()
    if (
      d === 'block' ||
      d === 'inline-block' ||
      d === 'inline' ||
      d === 'flex' ||
      d === 'grid' ||
      d === 'inline-flex' ||
      d === 'none'
    ) {
      config.quote.display = d as Display
    }
  }
  // 旧形式 border-left: 4px solid #xxx
  const blockquoteBorder = extractBorderLeftColor(css)
  if (blockquoteBorder) {
    config.colors.blockquoteBorderColor = blockquoteBorder
    config.quote.border = {
      width: 4,
      style: 'solid',
      color: blockquoteBorder,
    }
  }

  return config
}

/** 提取 #wenyan blockquote { border-left: 4px solid #xxx } 中的颜色与宽度 */
function extractBorderLeftColor(css: string): string | null {
  const block = extractBlock(css, '#wenyan blockquote')
  if (!block) return null
  const m = /border-left\s*:\s*([^;]+?)\s*(;|$)/i.exec(block)
  if (!m) return null
  const spec = m[1].trim()
  const parsed = parseBorder(spec)
  if (parsed && parsed.style !== 'none') return parsed.color
  return null
}

// ─── CSS 选择器 ↔ VisualCategory 互转工具 ──────────────────────
//
// 用于"可视化设计 ↔ 手写 CSS"双向分类切换：
//  - CSS 编辑器光标移动 → categoryAtLine(css, line) → setVisualCategory()
//  - visual 字段点击 → categorySelector(cat) + findSelectorLine() → 滚动定位

/** 内部视觉分类 ID（与 CustomThemeDialog 中 VisualCategory 对齐） */
export type CSSCategory = 'global' | 'heading' | 'paragraph' | 'quote'

/** CSS 注释前缀：configToCss 在每个选择器块前输出此注释 */
export const CATEGORY_COMMENT_PREFIX = '/* @category:'

/** 分类 → 对应 CSS 选择器（用于「visual → CSS」跳转定位） */
export function categorySelector(cat: CSSCategory): string {
  switch (cat) {
    case 'global':
      return '#wenyan {'
    case 'heading':
      // heading 可能在合并规则或独立 level 块
      return '#wenyan h1'
    case 'paragraph':
      return '#wenyan p {'
    case 'quote':
      return '#wenyan blockquote {'
  }
}

/** CSS 选择器 → 分类 */
export function selectorToCategory(selector: string): CSSCategory | null {
  const s = selector.trim().toLowerCase()
  if (s === '#wenyan' || s === '#wenyan {') return 'global'
  if (/^#wenyan\s+h[1-6]/.test(s) || /^#wenyan\s+h[1-6],/.test(s) || s.includes('h1, #wenyan h2')) return 'heading'
  if (/^#wenyan\s+p/.test(s)) return 'paragraph'
  if (/^#wenyan\s+blockquote/.test(s)) return 'quote'
  return null
}

/** 找指定选择器在 CSS 字符串中的 1-based 行号 */
export function findSelectorLine(css: string, selector: string): number | null {
  // 优先匹配带 @category 注释的行（configToCss 输出格式）
  const lines = css.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(selector)) {
      return i + 1
    }
  }
  return null
}

/** 通过 1-based 行号定位所在分类（向上找最近的 @category 注释） */
export function categoryAtLine(css: string, line: number): CSSCategory | null {
  const lines = css.split('\n')
  if (line < 1 || line > lines.length) return null
  // 向上扫描 50 行找最近的 @category 注释
  const start = Math.max(0, line - 50)
  for (let i = line - 1; i >= start; i--) {
    const m = /\/\*\s*@category:\s*(\w+)\s*\*\//.exec(lines[i])
    if (m) {
      const cat = m[1] as CSSCategory
      if (['global', 'heading', 'paragraph', 'quote'].includes(cat)) return cat
    }
  }
  return null
}
