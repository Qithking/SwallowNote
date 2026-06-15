/**
 * Markdown post-processor — simplified copy of the host's
 * `src/utils/compact-markdown.ts`.
 *
 * The plugin is shipped as a self-contained package and must not
 * `import` from the host. This file mirrors the same normalisations
 * the editor runs before saving so the export sees the same string
 * the user sees in the preview. Keep changes in sync with
 * [`compact-markdown.ts`](file:///Users/thking/code/codeBuddy/SwallowNote/src/utils/compact-markdown.ts).
 *
 * SYNC_VERSION: 2026-06-14
 *
 * Bump this version whenever the normalisations drift from the
 * host (e.g. host adds a new rule, or you add one here to match).
 * The version is checked manually during code review — there is
 * no automatic diff runner, so the date stamp is the only audit
 * trail. A future improvement could be a pre-commit hook that
 * diffs the two files and refuses to commit if the version
 * doesn't match.
 *
 * The two implementations have deliberately diverged in one place:
 * the host version's HTML-entity decoder is not reproduced here
 * because by the time the export pipeline runs, the content has
 * already been decoded by the editor.
 */

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s/
const HARD_BREAK_ONLY_RE = /^\\+$/
const TRAILING_INLINE_CLOSERS_RE = /(?:[*_~`]+)$/
const STRONG_RE = /\*\*([^*\n]*?)\*\*/g
const BULLET_RE = /^(\s*)\*(\s)/

interface MarkdownDocument {
  lines: string[]
}

interface LinePosition {
  doc: MarkdownDocument
  idx: number
}

interface MarkdownLineValue {
  line: string
}

interface NormalizedLinePosition extends LinePosition {
  line: string
}

interface ProcessMarkdownLineArgs extends LinePosition {
  inCodeBlock: boolean
}

interface ProcessMarkdownLineResult {
  inCodeBlock: boolean
  line: string | null
}

/**
 * Post-process markdown to produce standard-convention output:
 *  - Tight lists (no blank lines between consecutive list items)
 *  - Bullet list markers normalized to `-`
 *  - Leading/trailing inline whitespace moved outside bold markers
 *  - Stray hard-break-only lines removed after a markdown hard break
 *  - No runs of 3+ blank lines (collapsed to one blank line)
 *  - No trailing blank lines
 *  - Code block content is never modified
 */
export function compactMarkdown(md: string): string {
  if (!md) return md

  const source: MarkdownDocument = { lines: md.split('\n') }
  const result: MarkdownDocument = { lines: [] }
  let inCodeBlock = false

  for (let i = 0; i < source.lines.length; i++) {
    const next = processMarkdownLine({ doc: source, idx: i, inCodeBlock })
    inCodeBlock = next.inCodeBlock
    if (next.line !== null) {
      result.lines.push(next.line)
    }
  }

  return finalizeMarkdown(result)
}

function processMarkdownLine({ doc, idx, inCodeBlock }: ProcessMarkdownLineArgs): ProcessMarkdownLineResult {
  const rawLine = doc.lines.at(idx) ?? ''

  if (isFenceDelimiter({ line: rawLine })) {
    return { inCodeBlock: !inCodeBlock, line: rawLine }
  }

  if (inCodeBlock) {
    return { inCodeBlock, line: rawLine }
  }

  const line = normalizeMarkdownLine({ line: rawLine })
  if (shouldSkipLine({ doc, idx, line })) {
    return { inCodeBlock, line: null }
  }

  return { inCodeBlock, line }
}

function isFenceDelimiter({ line }: MarkdownLineValue): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('```') || trimmed.startsWith('~~~')
}

function normalizeMarkdownLine({ line }: MarkdownLineValue): string {
  const normalizedBullets = normalizeBulletMarker({ line })
  return normalizeStrongWhitespace({ line: normalizedBullets })
}

function shouldSkipLine({ doc, idx, line }: NormalizedLinePosition): boolean {
  if (line.trim() === '') {
    return isBlankBetweenListItems({ doc, idx }) || isExcessiveBlankLine({ doc, idx })
  }
  return isRedundantHardBreakLine({ doc, idx, line })
}

function isBlankBetweenListItems({ doc, idx }: LinePosition): boolean {
  const prev = findPrevNonBlank({ doc, idx })
  const next = findNextNonBlank({ doc, idx })
  if (prev === null || next === null) return false
  return LIST_RE.test(doc.lines.at(prev) ?? '') && LIST_RE.test(doc.lines.at(next) ?? '')
}

function isExcessiveBlankLine({ doc, idx }: LinePosition): boolean {
  if (idx > 0 && (doc.lines.at(idx - 1) ?? '').trim() === '') return true
  return false
}

function findPrevNonBlank({ doc, idx }: LinePosition): number | null {
  for (let i = idx - 1; i >= 0; i--) {
    if ((doc.lines.at(i) ?? '').trim() !== '') return i
  }
  return null
}

function findNextNonBlank({ doc, idx }: LinePosition): number | null {
  for (let i = idx + 1; i < doc.lines.length; i++) {
    if ((doc.lines.at(i) ?? '').trim() !== '') return i
  }
  return null
}

function isRedundantHardBreakLine({ doc, idx, line }: NormalizedLinePosition): boolean {
  if (!isHardBreakOnlyLine({ line })) return false
  const prev = findPrevNonBlank({ doc, idx })
  if (prev === null) return false
  const prevLine = normalizeMarkdownLine({ line: doc.lines.at(prev) ?? '' })
  return isHardBreakOnlyLine({ line: prevLine }) || endsWithHardBreakMarker({ line: prevLine })
}

function isHardBreakOnlyLine({ line }: MarkdownLineValue): boolean {
  return HARD_BREAK_ONLY_RE.test(line.trim())
}

function endsWithHardBreakMarker({ line }: MarkdownLineValue): boolean {
  const trimmed = line.trimEnd()
  if (trimmed.endsWith('\\\\')) return true
  return trimmed.replace(TRAILING_INLINE_CLOSERS_RE, '').endsWith('\\\\')
}

function normalizeBulletMarker({ line }: MarkdownLineValue): string {
  return line.replace(BULLET_RE, '$1-$2')
}

function normalizeStrongWhitespace({ line }: MarkdownLineValue): string {
  return line.replace(STRONG_RE, (match, content: string) => {
    const leadingWhitespace = content.match(/^\s+/)?.[0] ?? ''
    const trailingWhitespace = content.match(/\s+$/)?.[0] ?? ''
    if (!leadingWhitespace && !trailingWhitespace) {
      return match
    }
    const strongContent = content.slice(
      leadingWhitespace.length,
      content.length - trailingWhitespace.length,
    )
    if (!strongContent) {
      return match
    }
    return `${leadingWhitespace}**${strongContent}**${trailingWhitespace}`
  })
}

function finalizeMarkdown(doc: MarkdownDocument): string {
  while (doc.lines.length > 0 && doc.lines[doc.lines.length - 1].trim() === '') {
    doc.lines.pop()
  }
  if (doc.lines.length > 0) {
    doc.lines.push('')
  }
  return doc.lines.join('\n')
}
