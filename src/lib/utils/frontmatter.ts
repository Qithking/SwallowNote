import * as yaml from 'js-yaml'
import type { NoteFrontmatter, FrontmatterParseResult } from '@/lib/types/frontmatter'

const FRONTMATTER_DELIMITER = '---'

/**
 * Parse frontmatter from Markdown content.
 * Expects the frontmatter block to start at the very first character.
 */
export function parseFrontmatter(content: string): FrontmatterParseResult {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1)
  }

  // Normalize CRLF to LF
  content = content.replace(/\r\n/g, '\n')

  if (!content.startsWith(FRONTMATTER_DELIMITER)) {
    return { data: {}, body: content, raw: '' }
  }

  const firstDelimiterEnd = content.indexOf('\n', 0)
  if (firstDelimiterEnd === -1) {
    return { data: {}, body: content, raw: '' }
  }

  // Search for the closing delimiter that sits at the start of a line.
  // A `---` appearing inside a YAML value must not be treated as the closer.
  let searchFrom = firstDelimiterEnd + 1
  let closingIndex = -1
  while (true) {
    const idx = content.indexOf(FRONTMATTER_DELIMITER, searchFrom)
    if (idx === -1) break
    if (content[idx - 1] === '\n') {
      closingIndex = idx
      break
    }
    searchFrom = idx + 1
  }
  if (closingIndex === -1) {
    return { data: {}, body: content, raw: '' }
  }

  const raw = content.slice(0, closingIndex + FRONTMATTER_DELIMITER.length)
  const yamlStr = content.slice(firstDelimiterEnd + 1, closingIndex - 1)
  let body = content.slice(closingIndex + FRONTMATTER_DELIMITER.length)

  // Remove leading newline from body
  if (body.startsWith('\n')) {
    body = body.slice(1)
  }

  let data: NoteFrontmatter = {}
  if (yamlStr.trim().length > 0) {
    const parsed = yaml.load(yamlStr)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      data = parsed as NoteFrontmatter
    }
  }

  return { data, body, raw }
}

/**
 * Serialize frontmatter data and body into a complete Markdown string.
 * If data is empty, returns body directly without a frontmatter block.
 */
export function serializeFrontmatter(data: NoteFrontmatter, body: string): string {
  if (Object.keys(data).length === 0) {
    return body
  }

  const yamlStr = yaml.dump(data, {
    lineWidth: -1,
    quoteStyle: 'double',
  })

  return `${FRONTMATTER_DELIMITER}\n${yamlStr}${FRONTMATTER_DELIMITER}\n${body}`
}

/**
 * Strip frontmatter block from Markdown content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body
}

/**
 * Generate a Markdown file with default frontmatter.
 * Default fields: title (from filename without .md) and created (current ISO time).
 */
export function injectDefaultFrontmatter(fileName: string): string {
  const title = fileName.replace(/\.md$/, '')
  const data: NoteFrontmatter = {
    title,
    created: new Date().toISOString(),
  }
  return serializeFrontmatter(data, '')
}
