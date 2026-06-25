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

export type FontFamily = 'sans-serif' | 'serif' | 'monospace'

/** FONT_FAMILY_CSS 中预设的 3 种关键字常量。 */
const PRESET_FONT_KEYS: readonly FontFamily[] = ['sans-serif', 'serif', 'monospace']

/** 把 font-family 字符串归一化为 FontFamily 关键字；不能识别则返回原值。 */
export function resolveFontFamily(raw: string | undefined): string {
  if (!raw) return 'sans-serif'
  const lower = raw.toLowerCase()
  if (/monospace/i.test(lower)) return 'monospace'
  if (/serif/i.test(lower) && !/sans-serif/i.test(lower)) return 'serif'
  if (/sans-serif/i.test(lower) || /system/i.test(lower)) return 'sans-serif'
  return raw
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
}

/** 引用块分组：#wenyan blockquote 规则 */
export interface QuoteConfig {
  color?: string
  backgroundColor?: string
  borderRadius?: number
  padding?: BoxSpacing
  border?: BorderSpec
  fontSize?: number
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
  if (/^none$/i.test(v)) return { width: 0, style: 'none', color: '#000000' }
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

/**
 * 在 css 中查找指定选择器块的起始位置，返回从 `{` 到匹配 `}` 的内容。
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
 */
export function configToCss(config: ThemeConfig): string {
  const { colors, typography, heading, paragraph, quote } = config
  const fontFamilyCss = FONT_FAMILY_CSS[typography.fontFamily]
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
  if (paragraph.padding !== undefined) {
    paragraphDecls.push(`  padding: ${formatBox(paragraph.padding)};`)
  } else {
    paragraphDecls.push(`  text-indent: ${textIndent};`)
  }
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
  if (quote.backgroundColor !== undefined) {
    quoteDecls.push(`  background: ${quote.backgroundColor};`)
  } else {
    quoteDecls.push(`  background: ${colors.blockquoteBg};`)
  }
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
  if (quote.padding !== undefined) quoteDecls.push(`  padding: ${formatBox(quote.padding)};`)
  if (quote.borderRadius !== undefined)
    quoteDecls.push(`  border-radius: ${quote.borderRadius}px;`)
  if (quote.display !== undefined) quoteDecls.push(`  display: ${quote.display};`)
  blocks.push(`#wenyan blockquote {\n${quoteDecls.join('\n')}\n}`)

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

/**
 * 从 CSS 字符串 best-effort 解析为 ThemeConfig。
 * - 任何无法识别的规则被忽略（手写 CSS 的额外规则保留在原始 editCss 中）。
 * - 任何未匹配到的字段回退到 DEFAULT_THEME_CONFIG。
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
    if (PRESET_FONT_KEYS.includes(resolved as FontFamily)) {
      config.typography.fontFamily = resolved as FontFamily
    } else {
      config.typography.fontFamily = 'sans-serif'
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

  /** 把单选 level 解析结果合并到 config.heading[level] */
  const applyLevel = (level: LevelKey, cssBlock: string | null) => {
    if (!cssBlock) return
    const fields: HeadingLevelFields = {}
    const c = extractColorFromSelector(cssBlock, '{', 'color')
    if (c) fields.color = c
    const fs = extractValueFromSelector(cssBlock, '{', 'font-size')
    if (fs) {
      const n = parsePxNumber(fs)
      if (n !== null) fields.fontSize = clampNumber(Math.round(n), 8, 72)
    }
    const lh = extractValueFromSelector(cssBlock, '{', 'line-height')
    if (lh) {
      const n = parseUnitless(lh)
      if (n !== null) fields.lineHeight = clampNumber(Math.round(n * 100) / 100, 0.8, 3)
    }
    const ls = extractValueFromSelector(cssBlock, '{', 'letter-spacing')
    if (ls) {
      const n = parseEmNumber(ls) ?? parsePxNumber(ls)
      if (n !== null) fields.letterSpacing = clampNumber(Math.round(n), -10, 50)
    }
    const ta = extractValueFromSelector(cssBlock, '{', 'text-align')
    if (ta && /^(left|center|right|justify)$/i.test(ta.trim())) {
      fields.textAlign = ta.trim().toLowerCase() as TextAlign
    }
    const d = extractValueFromSelector(cssBlock, '{', 'display')
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

  // 1. 合并规则 → all
  const allBlock = extractBlock(css, HEADING_GROUP_SELECTOR)
  applyLevel('all', allBlock)
  // 兼容旧数据中只设置 #wenyan h1 的情况：把 h1 的字段也作为 all 的兜底
  if (!config.heading.all || Object.keys(config.heading.all).length === 0) {
    const h1Block = extractBlock(css, '#wenyan h1')
    applyLevel('all', h1Block)
  }

  // 2. 逐个独立 level 解析（覆盖 all 中的对应字段）
  for (const lv of INDIVIDUAL_LEVELS) {
    applyLevel(lv, extractBlock(css, `#wenyan ${lv}`))
  }

  // heading 兜底色（colors.headingColor）：从 all.color 或 h1.color 中取
  const headingAllColor = config.heading.all?.color
  if (headingAllColor) {
    config.colors.headingColor = headingAllColor
  } else {
    const h1Color = config.heading.h1?.color
    if (h1Color) config.colors.headingColor = h1Color
  }

  const headingWeightMatch = extractValueFromSelector(
    css,
    HEADING_GROUP_SELECTOR,
    'font-weight'
  ) ?? extractValueFromSelector(css, '#wenyan h1', 'font-weight')
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
  const blockquoteFontSize = extractValueFromSelector(css, '#wenyan blockquote', 'font-size')
  if (blockquoteFontSize) {
    const num = parsePxNumber(blockquoteFontSize)
    if (num !== null) config.quote.fontSize = clampNumber(Math.round(num), 8, 72)
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
