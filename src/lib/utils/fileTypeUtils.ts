/**
 * File type detection utilities
 */

export type FileType = 'markdown' | 'code' | 'binary'

// Markdown files
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn']

// CodeMirror supported languages — covers both native packages and legacy StreamLanguage modes
const CODEMIRROR_EXTENSIONS: Record<string, string> = {
  // Web
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'html',
  '.astro': 'html',

  // Data / Config
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.properties': 'properties',
  '.ini': 'properties',
  '.conf': 'nginx',
  '.env': 'properties',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.python': 'python',

  // Rust
  '.rs': 'rust',

  // Go
  '.go': 'go',

  // C / C++
  '.c': 'cpp',
  '.h': 'cpp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.hmm': 'cpp',

  // Java
  '.java': 'java',

  // Kotlin
  '.kt': 'kotlin',
  '.kts': 'kotlin',

  // Scala
  '.scala': 'scala',

  // C#
  '.cs': 'csharp',

  // Swift
  '.swift': 'swift',

  // Objective-C
  '.m': 'objectivec',
  '.mm': 'objectivec',

  // PHP
  '.php': 'php',
  '.phtml': 'php',

  // Ruby
  '.rb': 'ruby',
  '.ruby': 'ruby',
  '.gemspec': 'ruby',
  '.rake': 'ruby',

  // Shell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.bat': 'bat',
  '.cmd': 'bat',

  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',

  // Dart
  '.dart': 'dart',

  // Lua
  '.lua': 'lua',

  // Perl
  '.pl': 'perl',
  '.pm': 'perl',
  '.perl': 'perl',

  // R
  '.r': 'r',
  '.R': 'r',

  // Haskell
  '.hs': 'haskell',
  '.lhs': 'haskell',

  // Elixir / Erlang
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',

  // Clojure
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',

  // Julia
  '.jl': 'julia',

  // F#
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',

  // OCaml
  '.ml': 'ocaml',
  '.mli': 'ocaml',

  // Pascal
  '.pas': 'pascal',
  '.pascal': 'pascal',

  // Docker
  '.dockerfile': 'dockerfile',

  // Diff / Patch
  '.diff': 'diff',
  '.patch': 'diff',

  // CMake
  '.cmake': 'cmake',

  // Pug / Jade
  '.pug': 'pug',
  '.jade': 'pug',

  // Tcl
  '.tcl': 'tcl',

  // Visual Basic
  '.vb': 'vb',

  // Puppet
  '.pp': 'puppet',

  // TOML (already listed above in Data/Config)
  // Nginx
  '.nginx': 'nginx',

  // Gas / Assembly
  '.s': 'gas',
  '.asm': 'gas',

  // Shader
  '.glsl': 'shader',
  '.vert': 'shader',
  '.frag': 'shader',
  '.hlsl': 'shader',
  '.wgsl': 'shader',
}

// Filenames that map to specific languages (e.g. Dockerfile, Makefile, .gitignore)
const CODEMIRROR_FILENAMES: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'Dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'Makefile': 'makefile',
  'cmakelists.txt': 'cmake',
  'CMakeLists.txt': 'cmake',
  '.gitignore': 'properties',
  '.gitattributes': 'properties',
  '.gitmodules': 'properties',
  '.editorconfig': 'properties',
  '.eslintrc': 'json',
  '.eslintrc.json': 'json',
  '.eslintrc.js': 'javascript',
  '.prettierrc': 'json',
  '.prettierrc.json': 'json',
  '.babelrc': 'json',
  '.npmrc': 'properties',
  '.yarnrc': 'properties',
  'tsconfig.json': 'json',
  'jsconfig.json': 'json',
  'package.json': 'json',
  'composer.json': 'json',
  'gemfile': 'ruby',
  'Gemfile': 'ruby',
  'rakefile': 'ruby',
  'Rakefile': 'ruby',
  'vagrantfile': 'ruby',
  'Vagrantfile': 'ruby',
  'nginx.conf': 'nginx',
  'jenkinsfile': 'groovy',
  'Jenkinsfile': 'groovy',
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
 * Detect file type from filename and content.
 * Returns 'markdown' for markdown, 'binary' for binary files, and 'code' for
 * everything else (including unknown text files — they will open as plain text).
 */
export function detectFileType(filename: string, content?: string): FileType {
  const ext = getFileExtension(filename)

  // Check for markdown first
  if (MARKDOWN_EXTENSIONS.includes(ext)) {
    return 'markdown'
  }

  // If content is provided, check if it's binary
  if (content !== undefined && isBinaryContent(content)) {
    return 'binary'
  }

  // All non-binary, non-markdown files are treated as code (openable in CodeEditor)
  return 'code'
}

/**
 * Get language for CodeMirror from filename
 */
export function getCodeMirrorLanguage(filename: string): string {
  // Check by extension first
  const ext = getFileExtension(filename)
  if (CODEMIRROR_EXTENSIONS[ext]) {
    return CODEMIRROR_EXTENSIONS[ext]
  }

  // Check by exact filename (case-sensitive first, then lowercase)
  const basename = filename.split('/').pop() || filename
  if (CODEMIRROR_FILENAMES[basename]) {
    return CODEMIRROR_FILENAMES[basename]
  }
  const lowerBasename = basename.toLowerCase()
  if (CODEMIRROR_FILENAMES[lowerBasename]) {
    return CODEMIRROR_FILENAMES[lowerBasename]
  }

  // Files without extension but with text content default to plain text
  return 'text'
}
