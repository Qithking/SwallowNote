/**
 * ThemeConfig ↔ ElementStyle 桥接函数。
 *
 * 设计原则：
 *  - editCss 是单一来源；ThemeConfig 通过 parseThemeCss(editCss) 派生。
 *  - ElementStyleEditor 的 value 由 ThemeConfig 派生，onChange 触发 updateConfig
 *    写回 configToCss(next, extraCss)。
 *  - 4 个分类（global / heading / paragraph / quote）共享同一套桥接语义：
 *    - map：从 ThemeConfig 派生出当前面板需要的 ElementStyle 子集
 *    - merge：用 ElementStyleEditor 的 onChange 更新 ThemeConfig 中对应分组
 *  - 通用工具 `pickFields` / `applyFields` 负责「只同步 ElementStyle 中
 *    已定义（!== undefined）的字段」，避免把 undefined 覆盖到 config。
 */

import type { ElementStyle } from './components/ElementStyle'
import {
  FONT_FAMILY_CSS,
  type HeadingLevel,
  type HeadingLevelFields,
  type ParagraphConfig,
  type QuoteConfig,
  type ThemeConfig,
  type ThemeTypography,
} from './themeConfig'

/**
 * 从 src 中只挑出 keys 中已定义的字段，返回 partial 对象。
 * - 用于把 ElementStyle 的「已变化字段」聚合后写入 config。
 */
function pickFields<K extends keyof ElementStyle>(
  src: ElementStyle,
  keys: readonly K[]
): Partial<Pick<ElementStyle, K>> {
  const out: Partial<Pick<ElementStyle, K>> = {}
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k]
  }
  return out
}

/** 把 pickFields 结果合并到 dst（dst 字段优先，保持未指定字段不变）。 */
function applyFields<K extends keyof ElementStyle>(
  dst: Partial<Pick<ElementStyle, K>>,
  picked: Partial<Pick<ElementStyle, K>>
): Partial<Pick<ElementStyle, K>> {
  return { ...dst, ...picked }
}

// ─── Global 面板：绑 typography（colors.textColor 不暴露） ─────────────

/** 全局同步的字段集合：fontFamily / fontSize / lineHeight / letterSpacing。 */
const GLOBAL_FIELDS = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing'] as const

export function mapGlobalToElementStyle(config: ThemeConfig): ElementStyle {
  // preset 关键字展开为 ElementStyle 的 CSS 字符串；自定义字体原样输出
  const ff = config.typography.fontFamily
  const isPreset = ff === 'sans-serif' || ff === 'serif' || ff === 'monospace'
  const fontFamilyCss = isPreset
    ? FONT_FAMILY_CSS[ff as keyof typeof FONT_FAMILY_CSS]
    : ff
  return {
    fontFamily: fontFamilyCss,
    fontSize: config.typography.fontSize,
    lineHeight: config.typography.lineHeight,
    letterSpacing: config.typography.letterSpacing,
  }
}

export function mergeGlobalFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  // fontFamily 直接存用户选择的字符串（preset 关键字、preset 全栈、自定义栈、inherit 等）。
  // 不再调用 resolveFontFamily 归一化——之前会吞掉 "SF Mono" 这样的栈选择。
  let fontFamilyValue: string = config.typography.fontFamily
  if (next.fontFamily !== undefined) {
    fontFamilyValue = next.fontFamily
  }
  const picked = pickFields(next, GLOBAL_FIELDS)
  // fontFamily 由上面的特殊逻辑处理，其它字段走 picked
  const { fontFamily: _ignored, ...rest } = picked
  return {
    ...config,
    typography: {
      ...config.typography,
      fontFamily: fontFamilyValue,
      ...(rest as Pick<ThemeTypography, 'fontSize' | 'lineHeight' | 'letterSpacing'>),
    },
  }
}

// ─── Heading 面板：绑 heading（按 level 拆分） ─────────────────────────

/** 单个 heading level 同步的字段集合。 */
const HEADING_LEVEL_FIELDS = [
  'color',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'display',
] as const

export function mapHeadingToElementStyle(
  config: ThemeConfig,
  level: HeadingLevel
): ElementStyle {
  // level 字段优先于 all；缺失字段回退到 all
  const fields: HeadingLevelFields = {
    ...(config.heading.all ?? {}),
    ...(config.heading[level] ?? {}),
  }
  return {
    color: fields.color,
    fontFamily: fields.fontFamily,
    fontSize: fields.fontSize,
    lineHeight: fields.lineHeight,
    letterSpacing: fields.letterSpacing,
    textAlign: fields.textAlign,
    display: fields.display,
  }
}

export function mergeHeadingFromElementStyle(
  config: ThemeConfig,
  level: HeadingLevel,
  next: ElementStyle
): ThemeConfig {
  const picked = pickFields(next, HEADING_LEVEL_FIELDS)
  const updateFields = (
    prev: HeadingLevelFields | undefined
  ): HeadingLevelFields => applyFields(prev ?? {}, picked) as HeadingLevelFields

  if (level === 'all') {
    return {
      ...config,
      heading: {
        ...config.heading,
        all: updateFields(config.heading.all),
      },
    }
  }
  return {
    ...config,
    heading: {
      ...config.heading,
      [level]: updateFields(config.heading[level]),
    },
  }
}

// ─── Paragraph 面板：绑 paragraph ──────────────────────────────────────

/** 段落同步的字段集合（包含 IC-3 补全）。 */
const PARAGRAPH_FIELDS = [
  'fontFamily',
  'fontSize',
  'color',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'padding',
  'margin',
  'backgroundColor',
  'backgroundImage',
  'boxShadow',
  'border',
  'borderRadius',
  'display',
] as const

export function mapParagraphToElementStyle(config: ThemeConfig): ElementStyle {
  const p = config.paragraph
  return {
    fontFamily: p.fontFamily,
    fontSize: p.fontSize,
    color: p.color,
    lineHeight: p.lineHeight,
    letterSpacing: p.letterSpacing,
    textAlign: p.textAlign,
    padding: p.padding,
    margin: p.margin,
    backgroundColor: p.backgroundColor,
    backgroundImage: p.backgroundImage,
    boxShadow: p.boxShadow,
    border: p.border,
    borderRadius: p.borderRadius,
    display: p.display,
  }
}

export function mergeParagraphFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  const picked = pickFields(next, PARAGRAPH_FIELDS)
  return {
    ...config,
    paragraph: applyFields(config.paragraph ?? {}, picked) as ParagraphConfig,
  }
}

// ─── Quote 面板：绑 quote ──────────────────────────────────────────────

/** 引用同步的字段集合（包含 IC-1/IC-4 补全）。 */
const QUOTE_FIELDS = [
  'color',
  'fontFamily',
  'backgroundColor',
  'backgroundImage',
  'borderRadius',
  'padding',
  'margin',
  'border',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'boxShadow',
  'display',
] as const

export function mapQuoteToElementStyle(config: ThemeConfig): ElementStyle {
  const q = config.quote
  return {
    color: q.color,
    fontFamily: q.fontFamily,
    backgroundColor: q.backgroundColor,
    backgroundImage: q.backgroundImage,
    borderRadius: q.borderRadius,
    padding: q.padding,
    margin: q.margin,
    border: q.border,
    fontSize: q.fontSize,
    lineHeight: q.lineHeight,
    letterSpacing: q.letterSpacing,
    textAlign: q.textAlign,
    boxShadow: q.boxShadow,
    display: q.display,
  }
}

export function mergeQuoteFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  const picked = pickFields(next, QUOTE_FIELDS)
  return {
    ...config,
    quote: applyFields(config.quote ?? {}, picked) as QuoteConfig,
  }
}

// ─── 面板字段显示配置（决定 VisualCategory 哪些字段在 UI 上暴露） ──────

/** 各分类面板需要显示的字段集合。null 表示该字段不暴露给用户。 */
export const CATEGORY_FIELD_SHOW = {
  global: {
    fontFamily: true,
    fontSize: true,
    lineHeight: true,
    letterSpacing: true,
    color: false,
  },
  heading: {
    color: true,
    fontFamily: true,
    fontSize: true,
    lineHeight: true,
    letterSpacing: true,
    textAlign: true,
    display: true,
    backgroundColor: false,
    backgroundImage: false,
    boxShadow: false,
    border: false,
    borderRadius: false,
    padding: false,
    margin: false,
  },
  paragraph: {
    fontFamily: true,
    fontSize: true,
    color: true,
    lineHeight: true,
    letterSpacing: true,
    textAlign: true,
    padding: true,
    margin: true,
    backgroundColor: true,
    backgroundImage: true,
    boxShadow: true,
    border: true,
    borderRadius: true,
    display: true,
  },
  quote: {
    color: true,
    fontFamily: true,
    backgroundColor: true,
    backgroundImage: true,
    borderRadius: true,
    padding: true,
    margin: true,
    border: true,
    fontSize: true,
    lineHeight: true,
    letterSpacing: true,
    textAlign: true,
    boxShadow: true,
    display: true,
  },
} as const
