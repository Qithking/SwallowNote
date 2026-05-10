/**
 * File type detection utilities
 */

export type FileType = 'markdown' | 'code' | 'binary' | 'unknown'

// Markdown files
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn']

// CodeMirror supported languages
const CODEMIRROR_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.json': 'json',
  '.jsonc': 'json',
  '.py': 'python',
  '.python': 'python',
  '.rs': 'rust',
  '.sql': 'sql',
  '.xml': 'xml',
  '.svg': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'shell',
  '.psm1': 'shell',
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return filename.slice(lastDot).toLowerCase()
}

/**
 * Detect if content appears to be binary
 */
export function isBinaryContent(content: string): boolean {
  // Check for null bytes (most reliable binary indicator)
  if (content.includes('\0')) return true

  // Sample the content to check for binary-like patterns
  const sample = content.slice(0, Math.min(512, content.length))
  let nullCount = 0
  let controlCount = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 0) nullCount++
    else if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCount++
    }
  }

  // If more than 10% are null or control characters, likely binary
  const totalChars = sample.length || 1
  return (nullCount / totalChars > 0.1) || (controlCount / totalChars > 0.3)
}

/**
 * Detect file type from filename and content
 */
export function detectFileType(filename: string, content?: string): FileType {
  const ext = getFileExtension(filename)

  // Check for markdown first
  if (MARKDOWN_EXTENSIONS.includes(ext)) {
    return 'markdown'
  }

  // Check for CodeMirror supported extensions
  if (CODEMIRROR_EXTENSIONS[ext]) {
    // If content is provided, check if it's binary
    if (content !== undefined && isBinaryContent(content)) {
      return 'binary'
    }
    return 'code'
  }

  // If we have content, check if it's binary
  if (content !== undefined) {
    if (isBinaryContent(content)) {
      return 'binary'
    }
    // Check if it looks like text (has printable characters)
    const hasText = content.split('').some(c => {
      const code = c.charCodeAt(0)
      return (code >= 32 && code < 127) || code === 9 || code === 10 || code === 13
    })
    if (!hasText) {
      return 'binary'
    }
  }

  // Default to unknown
  return 'unknown'
}

/**
 * Get language for CodeMirror from filename
 */
export function getCodeMirrorLanguage(filename: string): string {
  const ext = getFileExtension(filename)
  return CODEMIRROR_EXTENSIONS[ext] || 'text'
}
