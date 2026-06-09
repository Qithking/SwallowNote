/**
 * Markmap Block Spec for BlockNote Editor
 * Creates a custom block spec for rendering Markmap mindmaps.
 *
 * Convention: code blocks with the `markmap` language are detected on
 * import and transformed into a `markmapBlock` so it renders visually.
 */
import { createReactBlockSpec } from '@blocknote/react'
import { MarkmapBlockEditor } from './MarkmapBlockEditor'

export const MARKMAP_BLOCK_TYPE = 'markmapBlock'

/** Markmap language identifier */
export const MARKMAP_LANG = 'markmap'

interface MarkmapParseResult {
  diagram: string
  source: string
  width: number
  height: number
  scale: number
}

/**
 * Extract markmap-meta from HTML comment in diagram content.
 * Format: <!-- markmap-meta:{"width":600,"height":400,"scale":0.8} -->
 */
function extractMarkmapMeta(content: string): { diagram: string; width: number; height: number; scale: number } {
  const metaRegex = /<!--\s*markmap-meta:(.*?)\s*-->\s*\n?/
  const match = content.match(metaRegex)
  if (!match) return { diagram: content, width: 0, height: 0, scale: 0 }

  try {
    const meta = JSON.parse(match[1])
    const diagram = content.replace(metaRegex, '')
    return {
      diagram,
      width: typeof meta.width === 'number' ? meta.width : 0,
      height: typeof meta.height === 'number' ? meta.height : 0,
      scale: typeof meta.scale === 'number' ? meta.scale : 0,
    }
  } catch {
    return { diagram: content, width: 0, height: 0, scale: 0 }
  }
}

/**
 * Parse a <pre><code class="language-markmap"> element into markmap block props.
 */
function readMarkmapPreElement(element: HTMLElement): MarkmapParseResult | undefined {
  if (element.tagName !== 'PRE') return undefined
  if (element.childElementCount !== 1 || element.firstElementChild?.tagName !== 'CODE') return undefined

  const code = element.firstElementChild as HTMLElement
  const langClass = code.className || ''
  if (!langClass.includes('language-markmap')) return undefined

  const rawDiagram = code.textContent ?? ''
  const { diagram: cleanDiagram, width, height, scale } = extractMarkmapMeta(rawDiagram)
  const diagram = cleanDiagram.endsWith('\n') ? cleanDiagram : `${cleanDiagram}\n`

  return {
    diagram,
    source: `\`\`\`markmap\n${diagram}\`\`\``,
    width,
    height,
    scale,
  }
}

/**
 * Try to read a code block as a markmap block.
 * Returns the parsed data if the language is `markmap` and the content
 * looks like a markmap outline (contains at least one markdown heading).
 */
function readMarkmapCodeBlock(block: {
  type: string
  content?: unknown
  props?: Record<string, unknown>
}): MarkmapParseResult | null {
  if (block.type !== 'codeBlock') return null

  const language = String((block.props?.language ?? '')).toLowerCase()
  if (language !== MARKMAP_LANG) return null

  const content = block.content
  let diagram = ''

  if (typeof content === 'string') {
    diagram = content
  } else if (Array.isArray(content)) {
    diagram = content.map((item: unknown) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) {
        return (item as { text: string }).text
      }
      return ''
    }).join('')
  }

  if (!diagram.trim()) return null

  // Extract metadata (width/height/scale) from HTML comment
  const { diagram: cleanDiagram, width, height, scale } = extractMarkmapMeta(diagram)

  // Verify it looks like a markmap outline (at least one markdown heading)
  if (!/^#{1,6}\s+\S/m.test(cleanDiagram)) return null

  const normalizedDiagram = cleanDiagram.endsWith('\n') ? cleanDiagram : `${cleanDiagram}\n`
  return {
    diagram: normalizedDiagram,
    source: `\`\`\`markmap\n${normalizedDiagram}\`\`\``,
    width,
    height,
    scale,
  }
}

export const MarkmapBlockSpec = createReactBlockSpec(
  {
    type: MARKMAP_BLOCK_TYPE,
    propSchema: {
      source: { default: '' },
      diagram: { default: '' },
      width: { default: 0 },
      height: { default: 0 },
      scale: { default: 0 },
    },
    content: 'none',
  },
  {
    runsBefore: ['codeBlock'],
    parse: readMarkmapPreElement,
    render: ({ block, editor }) => (
      <MarkmapBlockEditor
        diagram={block.props.diagram}
        source={block.props.source}
        width={block.props.width}
        height={block.props.height}
        scale={block.props.scale}
        block={block}
        editor={editor}
      />
    ),
  },
)

/**
 * Convert code blocks whose language is `markmap` to markmap blocks.
 */
export function transformMarkmapBlocks(blocks: unknown[]): unknown[] {
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
      const data = readMarkmapCodeBlock(b)
      if (data) {
        const markmapBlock: Record<string, unknown> = {
          type: MARKMAP_BLOCK_TYPE,
          props: {
            source: data.source,
            diagram: data.diagram,
            width: data.width,
            height: data.height,
            scale: data.scale,
          },
        }
        if (b.id) markmapBlock.id = b.id
        return markmapBlock
      }
    }

    // Recursively transform children
    if (b.children && Array.isArray(b.children)) {
      return {
        ...b,
        children: transformMarkmapBlocks(b.children),
      }
    }

    return block
  })
}

/**
 * Serialize a markmap block back to markdown.
 */
export function markmapBlockToMarkdown(block: { props?: { source?: string; diagram?: string } }): string {
  const props = block.props || {}
  return props.source || `\`\`\`markmap\n${props.diagram || ''}\`\`\``
}
