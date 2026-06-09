/**
 * Mermaid Block Spec for BlockNote Editor
 * Creates a custom block spec for rendering Mermaid diagrams.
 */
import { createReactBlockSpec } from '@blocknote/react'
import { MermaidBlockEditor } from './MermaidBlockEditor'

export const MERMAID_BLOCK_TYPE = 'mermaidBlock'

interface MermaidParseResult {
  diagram: string
  source: string
  width: number
  height: number
}

/**
 * Extract mermaid-meta from HTML comment in diagram content.
 * Format: <!-- mermaid-meta:{"width":600,"height":400} -->
 */
function extractMermaidMeta(content: string): { diagram: string; width: number; height: number } {
  const metaRegex = /<!--\s*mermaid-meta:(.*?)\s*-->\s*\n?/
  const match = content.match(metaRegex)
  if (!match) return { diagram: content, width: 0, height: 0 }
  
  try {
    const meta = JSON.parse(match[1])
    const diagram = content.replace(metaRegex, '')
    return {
      diagram,
      width: typeof meta.width === 'number' ? meta.width : 0,
      height: typeof meta.height === 'number' ? meta.height : 0,
    }
  } catch {
    return { diagram: content, width: 0, height: 0 }
  }
}

/**
 * Parse a <pre><code class="language-mermaid"> element into mermaid block props.
 */
function readMermaidPreElement(element: HTMLElement): MermaidParseResult | undefined {
  if (element.tagName !== 'PRE') return undefined
  if (element.childElementCount !== 1 || element.firstElementChild?.tagName !== 'CODE') return undefined

  const code = element.firstElementChild as HTMLElement
  const langClass = code.className || ''
  if (!langClass.includes('language-mermaid')) return undefined

  const rawDiagram = code.textContent ?? ''
  const { diagram: cleanDiagram, width, height } = extractMermaidMeta(rawDiagram)
  const diagram = cleanDiagram.endsWith('\n') ? cleanDiagram : `${cleanDiagram}\n`

  return {
    diagram,
    source: `\`\`\`mermaid\n${diagram}\`\`\``,
    width,
    height,
  }
}

/**
 * All Mermaid diagram type keywords.
 * @see https://mermaid.js.org/intro/
 */
const MERMAID_DIAGRAM_TYPES = [
  // Flowcharts & Graphs
  'flowchart', 'graph',
  // Sequence & Interaction
  'sequenceDiagram',
  // Class & State
  'classDiagram', 'stateDiagram', 'stateDiagram-v2', 'erDiagram',
  // Business & Project
  'gantt', 'journey', 'timeline', 'mindmap', 'quadrantChart',
  // Software Engineering
  'requirementDiagram', 'gitGraph', 'architecture', 'packet', 'block',
  'xychart-beta', 'xychart', 'sankey', 'sankey-beta',
  // C4 Model
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
  // Other
  'pie', 'kanban', 'zenuml', 'radar', 'lookml',
] as const

/**
 * Check if a code block looks like a Mermaid diagram based on its first statement.
 */
function looksLikeMermaidDiagram(diagram: string): boolean {
  const firstStatement = diagram
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('%%'))

  if (typeof firstStatement !== 'string') return false
  const escaped = MERMAID_DIAGRAM_TYPES.map(t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')
  return new RegExp(`^(?:${escaped})\\b`).test(firstStatement)
}

/**
 * Try to read a code block as a mermaid block.
 */
function readMermaidCodeBlock(block: { type: string; content?: unknown; props?: Record<string, unknown> }): MermaidParseResult | null {
  if (block.type !== 'codeBlock') return null

  // Get the code content from the block
  const content = block.content
  let diagram = ''

  if (typeof content === 'string') {
    diagram = content
  } else if (Array.isArray(content)) {
    // BlockNote stores inline content as an array
    diagram = content.map((item: unknown) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) {
        return (item as { text: string }).text
      }
      return ''
    }).join('')
  }

  if (!diagram) return null

  // Extract metadata (width/height) from HTML comment
  const { diagram: cleanDiagram, width, height } = extractMermaidMeta(diagram)

  // Check if it looks like a mermaid diagram (skip meta comments)
  if (!looksLikeMermaidDiagram(cleanDiagram)) return null

  const normalizedDiagram = cleanDiagram.endsWith('\n') ? cleanDiagram : `${cleanDiagram}\n`
  return {
    diagram: normalizedDiagram,
    source: `\`\`\`mermaid\n${normalizedDiagram}\`\`\``,
    width,
    height,
  }
}

export const MermaidBlockSpec = createReactBlockSpec(
  {
    type: MERMAID_BLOCK_TYPE,
    propSchema: {
      source: { default: '' },
      diagram: { default: '' },
      width: { default: 0 },
      height: { default: 0 },
    },
    content: 'none',
  },
  {
    runsBefore: ['codeBlock'],
    parse: readMermaidPreElement,
    render: ({ block, editor }) => (
      <MermaidBlockEditor
        diagram={block.props.diagram}
        source={block.props.source}
        width={block.props.width}
        height={block.props.height}
        block={block}
        editor={editor}
      />
    ),
  },
)

/**
 * Convert code blocks that look like Mermaid diagrams to Mermaid blocks.
 */
export function transformMermaidBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block) => {
    if (typeof block !== 'object' || block === null) return block

    const b = block as { 
      type: string; 
      id?: string;
      content?: unknown; 
      props?: Record<string, unknown>; 
      children?: unknown[] 
    }

    // Try to convert codeBlock to mermaidBlock
    if (b.type === 'codeBlock') {
      const mermaidData = readMermaidCodeBlock(b)
      if (mermaidData) {
        // Return a clean mermaid block structure
        const mermaidBlock: Record<string, unknown> = {
          type: MERMAID_BLOCK_TYPE,
          props: {
            source: mermaidData.source,
            diagram: mermaidData.diagram,
            width: mermaidData.width,
            height: mermaidData.height,
          },
        }
        // Preserve id if it exists
        if (b.id) {
          mermaidBlock.id = b.id
        }
        return mermaidBlock
      }
    }

    // Recursively transform children
    if (b.children && Array.isArray(b.children)) {
      return {
        ...b,
        children: transformMermaidBlocks(b.children),
      }
    }

    return block
  })
}

/**
 * Serialize a mermaid block back to markdown.
 */
export function mermaidBlockToMarkdown(block: { props?: { source?: string; diagram?: string } }): string {
  const props = block.props || {}
  return props.source || `\`\`\`mermaid\n${props.diagram || ''}\`\`\``
}
