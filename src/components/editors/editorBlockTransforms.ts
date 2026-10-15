/**
 * Markdown ↔ BlockNote blocks 转换的纯函数集合。
 * 从 MarkdownEditor.tsx 抽出，便于独立维护与测试。
 */
import { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { transformMermaidBlocks, MERMAID_BLOCK_TYPE } from './mermaidBlockSpec'
import { transformKatexBlocks, KATEX_BLOCK_TYPE } from './katexBlockSpec'
import { transformMarkmapBlocks, MARKMAP_BLOCK_TYPE } from './markmapBlockSpec'
import { logger } from '@/lib/logger'

/** Check if a URL is an external protocol (http, https, mailto, etc.) */
export function isExternalUrl(url: string): boolean {
  return /^(https?:|ftp:|mailto:|tel:|callto:|sms:)/i.test(url)
}

/** Resolve a relative URL to an absolute file path based on the current file's directory */
export function resolveFilePath(url: string, currentFilePath: string): string {
  // Already an absolute path (Unix-style or Windows drive letter)
  if (url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url)) {
    return url
  }
  const fileDir = currentFilePath.split(/[\\/]/).slice(0, -1).join('/') || ''
  // 统一将反斜杠转为正斜杠，兼容 Windows 路径写法
  const normalizedUrl = url.replace(/^\.\//, '').replace(/\\/g, '/')
  const urlParts = normalizedUrl.split('/')
  const dirParts = fileDir.split('/')
  for (const part of urlParts) {
    if (part === '..') {
      dirParts.pop()
    } else if (part && part !== '.') {
      dirParts.push(part)
    }
  }
  return dirParts.join('/')
}

/**
 * 递归遍历 blocks（包括嵌套的 block.children），对每个 block 调用 visitor。
 * - visitor 返回非 undefined 值时，用返回值替换原 block（用于 block 转换）
 * - visitor 返回 undefined 时，保留原 block（用于副作用收集，如收集符合条件的 block）
 * 返回新数组（不修改原数组），children 也会被递归遍历。
 */
export function walkBlocks(blocks: any[], visitor: (block: any) => any): any[] {
  const result: any[] = []
  for (const block of blocks) {
    if (!block) {
      result.push(block)
      continue
    }
    const visited = visitor(block)
    const current = visited !== undefined ? visited : block
    if (Array.isArray(current.children) && current.children.length > 0) {
      // 递归遍历 children，创建新对象避免修改原 block
      result.push({ ...current, children: walkBlocks(current.children, visitor) })
    } else {
      result.push(current)
    }
  }
  return result
}

/**
 * 序列化前的 block 转换：将 mermaid/katex/markmap 特殊 block 还原为 codeBlock，
 * 宽高元数据以 HTML 注释形式嵌入内容中持久化。其他 block 原样保留。
 */
export function serializeBlocksForMarkdown(blocks: any[]): any[] {
  return walkBlocks(blocks, (block: any) => {
    if (block.type === MERMAID_BLOCK_TYPE) {
      const props = block.props || {}
      const diagram = props.diagram || ''
      // Embed width/height as HTML comment in diagram content for persistence
      const w = props.width || 0
      const h = props.height || 0
      let content = diagram
      if (w > 0 || h > 0) {
        const meta = JSON.stringify({ width: w, height: h })
        // Remove any existing meta comment first
        content = diagram.replace(/<!--\s*mermaid-meta:.*?-->\s*\n?/g, '')
        content = `<!-- mermaid-meta:${meta} -->\n${content}`
      }
      return {
        ...block,
        type: 'codeBlock',
        props: { language: 'mermaid' },
        content: [{ type: 'text', text: content }],
      }
    }
    if (block.type === KATEX_BLOCK_TYPE) {
      const katexProps = block.props as { formula?: string; display?: boolean; width?: number; height?: number }
      // Embed width/height in the formula as HTML comment if set
      let formula = katexProps.formula || ''
      if (katexProps.width && katexProps.height) {
        formula = `<!-- katex-meta:{"width":${katexProps.width},"height":${katexProps.height}} -->\n${formula}`
      }
      return {
        ...block,
        type: 'codeBlock',
        props: { language: katexProps.display !== false ? 'math' : 'math-inline' },
        content: [{ type: 'text', text: formula }],
      }
    }
    if (block.type === MARKMAP_BLOCK_TYPE) {
      const props = block.props || {}
      let diagram = props.diagram || ''
      const w = props.width || 0
      const h = props.height || 0
      const s = props.scale || 0
      if (w > 0 || h > 0 || s > 0) {
        const meta = JSON.stringify({ width: w, height: h, scale: s })
        diagram = diagram.replace(/<!--\s*markmap-meta:.*?-->\s*\n?/g, '')
        diagram = `<!-- markmap-meta:${meta} -->\n${diagram}`
      }
      return {
        ...block,
        type: 'codeBlock',
        props: { language: 'markmap' },
        content: [{ type: 'text', text: diagram }],
      }
    }
    // 返回 undefined，保留原 block（walkBlocks 会继续递归其 children）
  })
}

// 模块级单例，避免每次 parseContent 都创建新实例
let _sharedParseEditor: ReturnType<typeof BlockNoteEditor.create> | null = null
export function getSharedParseEditor() {
  if (!_sharedParseEditor) {
    _sharedParseEditor = BlockNoteEditor.create()
  }
  return _sharedParseEditor
}

/** Markdown 解析失败时的兜底：按行拆为段落 block */
function plainTextBlocks(text: string): PartialBlock[] {
  return text.split('\n').map((line: string) => ({
    type: 'paragraph' as const,
    content: line || undefined
  }))
}

/**
 * 解析 Markdown 为 BlockNote blocks，并应用 mermaid/katex/markmap 代码块转换。
 * 解析失败时降级为纯文本段落并记录 warn 日志（warnLabel 用于区分调用场景）。
 */
export async function parseMarkdownToBlocks(
  editor: BlockNoteEditor<any, any, any>,
  markdown: string,
  warnLabel = 'Markdown parsing failed',
): Promise<PartialBlock[]> {
  let blocks: PartialBlock[] = []
  try {
    blocks = await editor.tryParseMarkdownToBlocks(markdown) as unknown as PartialBlock[]
    blocks = transformMermaidBlocks(blocks) as PartialBlock[]
    blocks = transformKatexBlocks(blocks) as PartialBlock[]
    blocks = transformMarkmapBlocks(blocks) as PartialBlock[]
  } catch (parseError) {
    logger.warn('markdown-editor', `${warnLabel}, treating as plain text:`, parseError)
    blocks = plainTextBlocks(markdown)
  }
  return blocks
}

/**
 * Determine the file block type based on file extension/MIME type.
 * Returns 'image' for image files, 'video' for video files, 'audio' for audio files, 'file' otherwise.
 */
export function getFileBlockType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']
  const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v']
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']

  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  return 'file'
}
