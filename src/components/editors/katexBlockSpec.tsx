/**
 * Katex Block Spec for BlockNote Editor
 * Creates a custom block spec for rendering KaTeX math formulas.
 *
 * Convention:
 *  - Block math:   ```math\n<LaTeX>\n```
 *  - Inline math:  ```math-inline\n<LaTeX>\n```
 *
 * A code block with the `math` or `math-inline` language is detected on
 * import and transformed into a `katexBlock` so it renders visually.
 */
import { createReactBlockSpec } from '@blocknote/react'
import { KatexBlockEditor } from './KatexBlockEditor'

export const KATEX_BLOCK_TYPE = 'katexBlock'
export const KATEX_INLINE_BLOCK_TYPE = 'katexInlineBlock'

/** Block-level (display) math language identifier */
export const MATH_LANG = 'math'
/** Inline math language identifier */
export const MATH_INLINE_LANG = 'math-inline'

interface KatexParseResult {
  formula: string
  source: string
  display: boolean
}

/**
 * Parse embedded width/height from formula content.
 * Format: <!-- katex-meta:{"width":400,"height":300} -->
 */
function parseEmbeddedDimensions(formula: string): { formula: string; width?: number; height?: number } {
  const metaRegex = /<!--\s*katex-meta:(.*?)\s*-->\s*\n?/
  const match = formula.match(metaRegex)
  if (!match) return { formula }
  
  try {
    const meta = JSON.parse(match[1])
    const cleanFormula = formula.replace(metaRegex, '')
    return {
      formula: cleanFormula,
      width: typeof meta.width === 'number' ? meta.width : undefined,
      height: typeof meta.height === 'number' ? meta.height : undefined,
    }
  } catch {
    return { formula }
  }
}

/**
 * Try to read a code block as a math block.
 * Returns the parsed data if it matches the math/math-inline language,
 * otherwise returns null.
 */
function readMathCodeBlock(block: {
  type: string
  content?: unknown
  props?: Record<string, unknown>
}): (KatexParseResult & { width?: number; height?: number }) | null {
  if (block.type !== 'codeBlock') return null

  const language = String((block.props?.language ?? '')).toLowerCase()
  if (language !== MATH_LANG && language !== MATH_INLINE_LANG) return null

  const content = block.content
  let rawFormula = ''

  if (typeof content === 'string') {
    rawFormula = content
  } else if (Array.isArray(content)) {
    rawFormula = content
      .map((item: unknown) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return (item as { text: string }).text
        }
        return ''
      })
      .join('')
  }

  if (!rawFormula) return null

  // Parse embedded dimensions
  const { formula, width, height } = parseEmbeddedDimensions(rawFormula)

  // Normalize line endings
  const normalized = formula.replace(/\r\n?/g, '\n')
  const display = language === MATH_LANG
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized

  const result: KatexParseResult & { width?: number; height?: number } = {
    formula: trimmed,
    source: `\`\`\`${language}\n${rawFormula}\n\`\`\``,
    display,
  }
  if (width) result.width = width
  if (height) result.height = height
  return result
}

/**
 * Parse a <pre><code class="language-math"> element into katex block props.
 */
function readMathPreElement(element: HTMLElement): KatexParseResult | undefined {
  if (element.tagName !== 'PRE') return undefined
  if (element.childElementCount !== 1 || element.firstElementChild?.tagName !== 'CODE') return undefined

  const code = element.firstElementChild as HTMLElement
  const langClass = code.className || ''
  let language: string | null = null
  if (langClass.includes('language-math-inline')) language = MATH_INLINE_LANG
  else if (langClass.includes('language-math')) language = MATH_LANG
  if (!language) return undefined

  const raw = code.textContent ?? ''
  const normalized = raw.replace(/\r\n?/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!trimmed) return undefined

  return {
    formula: trimmed,
    source: `\`\`\`${language}\n${trimmed}\n\`\`\``,
    display: language === MATH_LANG,
  }
}

export const KatexBlockSpec = createReactBlockSpec(
  {
    type: KATEX_BLOCK_TYPE,
    propSchema: {
      source: { default: '' },
      formula: { default: '' },
      display: { default: true },
      width: { default: 0 },
      height: { default: 0 },
    },
    content: 'none',
  },
  {
    runsBefore: ['codeBlock'],
    parse: readMathPreElement,
    render: ({ block, editor }) => (
      <KatexBlockEditor
        formula={block.props.formula}
        source={block.props.source}
        display={block.props.display}
        width={block.props.width}
        height={block.props.height}
        block={block}
        editor={editor}
      />
    ),
  },
)

/**
 * Convert code blocks whose language is `math` or `math-inline` to katex blocks.
 */
export function transformKatexBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block) => {
    if (typeof block !== 'object' || block === null) return block

    const b = block as {
      type: string
      id?: string
      content?: unknown
      props?: Record<string, unknown>
      children?: unknown[]
    }

    if (b.type === 'codeBlock') {
      const data = readMathCodeBlock(b)
      if (data) {
        const props: Record<string, unknown> = {
          source: data.source,
          formula: data.formula,
          display: data.display,
        }
        // Add width/height if present
        if (data.width) props.width = data.width
        if (data.height) props.height = data.height
        const katexBlock: Record<string, unknown> = {
          type: KATEX_BLOCK_TYPE,
          props,
        }
        if (b.id) katexBlock.id = b.id
        return katexBlock
      }
    }

    if (b.children && Array.isArray(b.children)) {
      return {
        ...b,
        children: transformKatexBlocks(b.children),
      }
    }

    return block
  })
}

/**
 * Serialize a katex block back to a markdown code block.
 */
export function katexBlockToCodeBlock(block: {
  type?: string
  props?: { source?: string; formula?: string; display?: boolean }
}): { type: string; props: { language: string }; content: { type: 'text'; text: string }[] } {
  const props = block.props || {}
  const display = props.display !== false
  const language = display ? MATH_LANG : MATH_INLINE_LANG
  return {
    type: 'codeBlock',
    props: { language },
    content: [{ type: 'text', text: props.formula || '' }],
  }
}
