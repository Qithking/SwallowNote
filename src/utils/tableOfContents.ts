export interface TocItem {
  id: string
  blockId?: string
  level: number
  title: string
  children: TocItem[]
  matchIndex?: number
  /** 1-based line number in the source markdown (Source mode only) */
  lineNumber?: number
}

export interface MarkdownHeading {
  blockId?: string
  level: number
  title: string
  /** 1-based line number in the source markdown */
  lineNumber?: number
}

function headingText(block: { content?: unknown[] }): string {
  const content = block.content
  if (!Array.isArray(content)) return ''
  
  let text = ''
  for (const item of content) {
    if (typeof item === 'string') {
      text += item
    } else if (typeof item === 'object' && item !== null) {
      const contentItem = item as { type?: string; text?: string }
      if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
        text += contentItem.text
      } else if (typeof contentItem.text === 'string') {
        text += contentItem.text
      }
    }
  }
  return text.trim()
}

function isHeadingBlock(block: unknown): block is { id?: string; type?: string; props?: { level?: number }; content?: unknown[] } {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return false
  const b = block as { type?: string; props?: { level?: number } }
  return b.type === 'heading' && b.props?.level !== undefined
}

function normalizeHeadingTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ')
}

function tocLevelForBlock(block: { props?: { level?: number } }): number | null {
  const level = block.props?.level
  if (typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6) {
    return level
  }
  return null
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown
  const delimiter = markdown.indexOf('\n---', 3)
  if (delimiter === -1) return markdown
  const afterDelimiter = markdown.indexOf('\n', delimiter + 4)
  return afterDelimiter === -1 ? '' : markdown.slice(afterDelimiter + 1)
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function parseMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const lines = stripFrontmatter(markdown).split('\n')
  const headings: MarkdownHeading[] = []
  let inCodeBlock = false
  let codeFenceChar = '' // '`' or '~'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect fenced code block boundaries (``` or ~~~)
    // A fence can have up to 3 leading spaces (CommonMark spec).
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0]
      if (!inCodeBlock) {
        // Opening fence
        inCodeBlock = true
        codeFenceChar = fenceChar
      } else if (fenceChar === codeFenceChar) {
        // Closing fence must use the same character
        inCodeBlock = false
        codeFenceChar = ''
      }
      // A different fence character inside a code block is just content
      continue
    }

    // Skip lines inside fenced code blocks — # at the start of a code
    // line is a comment in many languages, not a Markdown heading.
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) {
      const title = stripInlineMarkdown(match[2])
      if (title.length > 0) {
        headings.push({
          level: match[1].length,
          title,
          lineNumber: i + 1, // 1-based
        })
      }
    }
  }

  return headings
}

function nearestParent(stack: TocItem[], level: number): TocItem {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index]
    if (item && item.level < level) return item
  }
  return stack[0]!
}

function appendTocHeading(stack: TocItem[], item: TocItem) {
  const parent = nearestParent(stack, item.level)
  parent.children.push(item)
  Reflect.set(stack, item.level, item)
  stack.length = item.level + 1
}

function shouldSkipDuplicateTitleHeading(entryTitle: string, title: string, level: number, headingIndex: number): boolean {
  if (headingIndex !== 0 || level !== 1) return false
  return normalizeHeadingTitle(title) === normalizeHeadingTitle(entryTitle)
}

export function buildTableOfContents(entryTitle: string, blocks: unknown[]): TocItem {
  const normalizedEntryTitle = normalizeHeadingTitle(entryTitle)
  const root: TocItem = { id: 'toc-title', level: 1, title: normalizedEntryTitle, children: [] }
  const stack: TocItem[] = [root]
  let headingCount = 0

  blocks.forEach((block, index) => {
    if (!isHeadingBlock(block)) return
    const title = headingText(block as { content?: unknown[] })
    if (!title) return

    const level = tocLevelForBlock(block as { props?: { level?: number } })
    if (level === null) return

    const normalizedTitle = normalizeHeadingTitle(title)
    if (shouldSkipDuplicateTitleHeading(normalizedEntryTitle, normalizedTitle, level, headingCount)) {
      root.blockId = block.id
      headingCount += 1
      return
    }

    const item: TocItem = {
      blockId: block.id,
      children: [],
      id: block.id ?? `toc-heading-${index}`,
      level,
      matchIndex: headingCount - (root.blockId ? 1 : 0),
      title: normalizedTitle,
    }
    appendTocHeading(stack, item)
    headingCount += 1
  })

  return root
}

export function buildTableOfContentsFromMarkdown(entryTitle: string, markdown: string): TocItem {
  const normalizedEntryTitle = normalizeHeadingTitle(entryTitle)
  const headings = parseMarkdownHeadings(markdown)

  const root: TocItem = { id: 'toc-title', level: 1, title: normalizedEntryTitle, children: [] }
  const stack: TocItem[] = [root]

  headings.forEach((heading, index) => {
    const normalizedTitle = normalizeHeadingTitle(heading.title)

    if (shouldSkipDuplicateTitleHeading(normalizedEntryTitle, normalizedTitle, heading.level, index)) {
      root.title = normalizedTitle
      return
    }

    const item: TocItem = {
      blockId: heading.blockId,
      children: [],
      id: `toc-heading-${index}`,
      level: heading.level,
      lineNumber: heading.lineNumber,
      matchIndex: index,
      title: normalizedTitle,
    }
    appendTocHeading(stack, item)
  })

  return root
}

export function extractHeadingsFromBlocks(blocks: unknown[]): MarkdownHeading[] {
  const results: MarkdownHeading[] = []
  for (const block of blocks) {
    if (!isHeadingBlock(block)) continue
    const level = tocLevelForBlock(block as { props?: { level?: number } })
    if (level === null) continue
    const title = headingText(block as { content?: unknown[] })
    if (!title) continue
    results.push({
      blockId: block.id,
      level,
      title,
    })
  }
  return results
}

export function flattenToc(toc: TocItem): TocItem[] {
  const result: TocItem[] = []

  function traverse(item: TocItem) {
    const { children, ...rest } = item
    result.push({ ...rest, children: [] })
    for (const child of children) {
      traverse(child)
    }
  }

  traverse(toc)
  return result
}

export function findTocItemByBlockId(toc: TocItem, blockId: string): TocItem | null {
  function traverse(item: TocItem): TocItem | null {
    if (item.blockId === blockId) return item
    for (const child of item.children) {
      const found = traverse(child)
      if (found) return found
    }
    return null
  }

  return traverse(toc)
}

export function findTocItemByTitle(toc: TocItem, title: string): TocItem | null {
  const normalizedTitle = normalizeHeadingTitle(title)

  function traverse(item: TocItem): TocItem | null {
    if (normalizeHeadingTitle(item.title) === normalizedTitle) return item
    for (const child of item.children) {
      const found = traverse(child)
      if (found) return found
    }
    return null
  }

  return traverse(toc)
}