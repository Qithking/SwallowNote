/**
 * elementStyleToCss / cssToElementStyle —— ElementStyle 与单条 CSS 规则
 * 的双向转换。
 *
 * 设计原则：
 *  - elementStyleToCss 只输出已定义的字段；undefined 字段不输出声明
 *  - cssToElementStyle best-effort 解析：未识别的属性按 `${prop}: ${value};`
 *    原始声明形式收集到 extraCss（selector-scoped）
 *  - 单方向只支持"一个 selector + 一组 declarations"，不做多规则合并
 */

import type { BorderSpec, BoxSpacing, ElementStyle } from './types'

/** 阴影档位 → CSS box-shadow 字符串 */
const BOX_SHADOW_MAP: Record<NonNullable<ElementStyle['boxShadow']>, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
}

/** 把 4 边 px 数值格式化为 `<top>px <right>px <bottom>px <left>px` */
function formatBox(value: BoxSpacing): string {
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

/** 把 BorderSpec 格式化为 CSS border 简写 */
function formatBorder(value: BorderSpec): string {
  if (value.width === 0 || value.style === 'none') return 'none'
  return `${value.width}px ${value.style} ${value.color}`
}

/**
 * 把 ElementStyle 转成 `selector { prop: value; ... }` 形式的单条 CSS 规则。
 * undefined 字段会被跳过。
 */
export function elementStyleToCss(value: ElementStyle, selector: string): string {
  const decls: string[] = []
  if (value.fontFamily !== undefined) decls.push(`font-family: ${value.fontFamily};`)
  if (value.fontSize !== undefined) decls.push(`font-size: ${value.fontSize}px;`)
  if (value.color !== undefined) decls.push(`color: ${value.color};`)
  if (value.backgroundColor !== undefined)
    decls.push(`background-color: ${value.backgroundColor};`)
  if (value.backgroundImage !== undefined)
    decls.push(`background-image: ${value.backgroundImage};`)
  if (value.boxShadow !== undefined) decls.push(`box-shadow: ${BOX_SHADOW_MAP[value.boxShadow]};`)
  if (value.border !== undefined) decls.push(`border: ${formatBorder(value.border)};`)
  if (value.padding !== undefined) decls.push(`padding: ${formatBox(value.padding)};`)
  if (value.margin !== undefined) decls.push(`margin: ${formatBox(value.margin)};`)
  if (value.borderRadius !== undefined)
    decls.push(`border-radius: ${value.borderRadius}px;`)
  if (value.lineHeight !== undefined) decls.push(`line-height: ${value.lineHeight};`)
  if (value.letterSpacing !== undefined)
    decls.push(`letter-spacing: ${value.letterSpacing}px;`)
  if (value.textAlign !== undefined) decls.push(`text-align: ${value.textAlign};`)
  if (value.display !== undefined) decls.push(`display: ${value.display};`)

  if (decls.length === 0) return `${selector} { }`
  return `${selector} {\n  ${decls.join('\n  ')}\n}`
}

// ─── 解析：CSS → ElementStyle + extraCss ─────────────────────────────

/**
 * 在 css 中查找指定选择器块的 `{ ... }` 内容（不含外层大括号）。
 * 失败返回 null。用大括号配对计数避免嵌套干扰。
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

/**
 * 在 css block 中按 `prop: value;` 解析出所有声明。
 * 返回值是 [{ prop, value }]，顺序与 CSS 出现顺序一致。
 * 引号 / 注释 / 多行声明都尽量宽松处理。
 */
function parseDeclarations(block: string): Array<{ prop: string; value: string }> {
  const out: Array<{ prop: string; value: string }> = []
  // 去掉 CSS 注释
  const cleaned = block.replace(/\/\*[\s\S]*?\*\//g, '')
  // 按 `;` 切分（不去掉空段）
  const parts = cleaned.split(';')
  for (const part of parts) {
    const colonIdx = part.indexOf(':')
    if (colonIdx === -1) continue
    const prop = part.slice(0, colonIdx).trim()
    const value = part.slice(colonIdx + 1).trim()
    if (!prop || !value) continue
    out.push({ prop: prop.toLowerCase(), value })
  }
  return out
}

/** 解析 `12px` / `12` / `0.5em` 之类数字，失败返回 null */
function parsePxNumber(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim())
  if (m) return parseFloat(m[1])
  const m2 = /^(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (m2) return parseFloat(m2[1])
  return null
}

/** 解析 em 数值 */
function parseEmNumber(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)em$/i.exec(value.trim())
  if (m) return parseFloat(m[1])
  return parsePxNumber(value)
}

/** 解析无单位行高 */
function parseUnitless(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)$/.exec(value.trim())
  if (m) return parseFloat(m[1])
  return null
}

/** 解析 4 段 em 序列 `1em 2em 3em 4em` */
function parseBoxSpacing(value: string): BoxSpacing | null {
  const m = value.trim().match(/(-?\d+(?:\.\d+)?)\s*(em)?/gi)
  if (!m || m.length < 4) return null
  return {
    top: parseFloat(m[0]),
    right: parseFloat(m[1]),
    bottom: parseFloat(m[2]),
    left: parseFloat(m[3]),
  }
}

/**
 * 解析 border 简写。覆盖以下形式：
 *  - `none` → 0/none/transparent
 *  - `<width> <style> <color?>`：color 缺省时按 currentColor 兜底
 *  - `solid`/`dashed`/`dotted`/`double` 是合法 style
 *
 * 颜色未指定时用 'currentColor'，避免用 #000000 让用户编辑时看到错误颜色。
 */
function parseBorder(value: string): BorderSpec | null {
  const v = value.trim()
  if (/^none$/i.test(v)) {
    return { width: 0, style: 'none', color: 'transparent' }
  }
  // 找宽度 + 样式 + (可选) 颜色
  // 颜色可省略，省略时用 currentColor；可取 #hex / rgb() / rgba() / named color
  const m = /(\d+(?:\.\d+)?)(?:px)?\s+(solid|dashed|dotted|double)(?:\s+(.+))?$/i.exec(v)
  if (m) {
    return {
      width: parseFloat(m[1]),
      style: m[2].toLowerCase() as BorderSpec['style'],
      color: (m[3] ?? 'currentColor').trim(),
    }
  }
  return null
}

/**
 * 解析 box-shadow 档位。
 * 用模糊半径（box-shadow 第 3 个长度值）粗略反推档位，比之前的「10px 15px 字符串
 * 匹配」更鲁棒，能识别自定义 shadow 值。档位边界：
 *  - sm: 模糊半径 ≤ 3
 *  - md: 3 < 模糊半径 ≤ 8
 *  - lg: 模糊半径 > 8
 * 多层 box-shadow（逗号分隔）取第一个（最外层）。
 */
function parseBoxShadow(value: string): ElementStyle['boxShadow'] {
  const v = value.trim().toLowerCase()
  if (v === 'none') return 'none'
  // 取第一层（按逗号切分的第一段），避免多层 shadow 误判
  const first = v.split(',')[0]?.trim() ?? v
  // box-shadow 至少含 offset-x, offset-y, blur（blur 缺省时为 0）
  // 提取所有长度 token：<num>(px|em|rem)
  const lengthTokens = first.match(/-?\d+(?:\.\d+)?(?:px|em|rem)?/g)
  if (!lengthTokens || lengthTokens.length < 2) return undefined
  // 第 3 个长度是 blur（offset-x / offset-y / blur / spread）
  const blurToken = lengthTokens[2] ?? '0'
  const num = parseFloat(blurToken)
  if (!isFinite(num) || num <= 0) return 'sm' // 极小或无 blur 视为 sm
  if (num <= 3) return 'sm'
  if (num <= 8) return 'md'
  return 'lg'
}

const KNOWN_PROPS = new Set([
  'font-family',
  'font-size',
  'color',
  'background-color',
  'background-image',
  'box-shadow',
  'border',
  'padding',
  'margin',
  'border-radius',
  'line-height',
  'letter-spacing',
  'text-align',
  'display',
])

/**
 * 从 CSS 字符串中按 selector 提取 ElementStyle 字段；未识别的属性
 * 按 `${prop}: ${value};` 形式收集到 extraCss（selector-scoped）。
 */
export function cssToElementStyle(
  css: string,
  selector: string
): { value: ElementStyle; extraCss: string } {
  const value: ElementStyle = {}
  const block = extractBlock(css, selector)
  if (!block) return { value, extraCss: '' }

  const decls = parseDeclarations(block)
  const unknownDecls: string[] = []
  for (const { prop, value: v } of decls) {
    switch (prop) {
      case 'font-family':
        value.fontFamily = v
        break
      case 'font-size': {
        const n = parsePxNumber(v)
        if (n !== null) value.fontSize = n
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'color':
        value.color = v
        break
      case 'background-color':
        value.backgroundColor = v
        break
      case 'background-image':
        value.backgroundImage = v
        break
      case 'box-shadow': {
        const bs = parseBoxShadow(v)
        if (bs) value.boxShadow = bs
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'border': {
        const b = parseBorder(v)
        if (b) value.border = b
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'padding': {
        const bs = parseBoxSpacing(v)
        if (bs) value.padding = bs
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'margin': {
        const bs = parseBoxSpacing(v)
        if (bs) value.margin = bs
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'border-radius': {
        const n = parsePxNumber(v)
        if (n !== null) value.borderRadius = n
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'line-height': {
        const n = parseUnitless(v)
        if (n !== null) value.lineHeight = n
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'letter-spacing': {
        const n = parseEmNumber(v)
        if (n !== null) value.letterSpacing = n
        else unknownDecls.push(`${prop}: ${v};`)
        break
      }
      case 'text-align': {
        const t = v.trim().toLowerCase()
        if (t === 'left' || t === 'center' || t === 'right' || t === 'justify') {
          value.textAlign = t
        } else {
          unknownDecls.push(`${prop}: ${v};`)
        }
        break
      }
      case 'display': {
        const d = v.trim().toLowerCase()
        if (
          d === 'block' ||
          d === 'inline-block' ||
          d === 'inline' ||
          d === 'flex' ||
          d === 'grid' ||
          d === 'inline-flex' ||
          d === 'none'
        ) {
          value.display = d
        } else {
          unknownDecls.push(`${prop}: ${v};`)
        }
        break
      }
      default:
        if (!KNOWN_PROPS.has(prop)) unknownDecls.push(`${prop}: ${v};`)
        break
    }
  }

  const extraCss =
    unknownDecls.length === 0 ? '' : `${selector} {\n  ${unknownDecls.join('\n  ')}\n}`

  return { value, extraCss }
}
