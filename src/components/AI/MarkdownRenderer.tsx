/**
 * MarkdownRenderer Component
 * Renders markdown source as visual rich text for AI chat messages.
 * Uses react-markdown + remark-gfm for full GFM support.
 * Code blocks get syntax highlighting via shiki (lazy loaded).
 */
import { useState, useEffect, memo, useCallback } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Copy, Check } from 'lucide-react'
import { MermaidBlock } from './MermaidBlock'
import { MathBlock } from './MathBlock'

/** Lazy-loaded shiki highlighter singleton */
let highlighterPromise: Promise<any> | null = null
let cachedHighlighter: any = null

function getHighlighter() {
  if (cachedHighlighter) return Promise.resolve(cachedHighlighter)
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(async (shiki) => {
      const hl = await shiki.createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: ['javascript', 'typescript', 'python', 'rust', 'css', 'html', 'json', 'bash', 'sql', 'yaml', 'xml', 'go', 'java', 'c', 'cpp'],
      })
      cachedHighlighter = hl
      return hl
    })
  }
  return highlighterPromise
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python',
  sh: 'bash', shell: 'bash', yml: 'yaml',
}

function normalizeLang(lang: string): string {
  return LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase()
}

/** Module-level constant to avoid re-creating the plugins array on every render */
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

const SHIKI_LANGS = new Set([
  'javascript', 'typescript', 'python', 'rust', 'css', 'html', 'json',
  'bash', 'sql', 'yaml', 'xml', 'go', 'java', 'c', 'cpp',
  'js', 'ts', 'py', 'sh', 'shell', 'yml',
])

/** Code block with shiki syntax highlighting */
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (SHIKI_LANGS.has(language.toLowerCase())) {
      getHighlighter()
        .then((hl) => {
          if (cancelled) return
          try {
            const result = hl.codeToHtml(code, {
              lang: normalizeLang(language),
              themes: { dark: 'github-dark', light: 'github-light' },
            })
            setHtml(result)
          } catch {
            setHtml('')
          }
        })
        .catch(() => setHtml(''))
    }
    return () => { cancelled = true }
  }, [code, language])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  const header = (
    <div className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5 rounded-t-md">
      <span className="font-mono">{language}</span>
      <button
        onClick={handleCopy}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover/code:opacity-100 transition-opacity"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )

  // Highlighted code (shiki)
  if (html) {
    return (
      <div className="group/code my-2 rounded-md overflow-hidden border border-border/50">
        {header}
        <div
          className="ai-code-block text-xs [&_pre]:!p-3 [&_pre]:!m-0 [&_pre]:!bg-transparent [&_code]:!text-xs [&_pre]:!overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    )
  }

  // Fallback: plain monospace code block
  return (
    <div className="group/code my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
      {header}
      <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Inline code */
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[11px] font-mono">
      {children}
    </code>
  )
}

interface MarkdownRendererProps {
  content: string
}

/** Module-level constant to avoid re-creating the components map on every render */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[13px] font-bold mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-bold mt-2 mb-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-xs font-bold mt-2 mb-1 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !className?.includes('language-')
    const codeStr = String(children).replace(/\n$/, '')

    if (isInline) {
      return <InlineCode>{children}</InlineCode>
    }

    // Handle Mermaid diagrams
    if (match && match[1].toLowerCase() === 'mermaid') {
      return <MermaidBlock diagram={codeStr} />
    }

    // Handle KaTeX math formulas (code block syntax)
    if (match && (match[1].toLowerCase() === 'math' || match[1].toLowerCase() === 'math-inline')) {
      return <MathBlock formula={codeStr} display={match[1].toLowerCase() === 'math'} />
    }

    return <CodeBlock code={codeStr} language={match ? match[1] : 'text'} />
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 -mx-1 max-w-full">
      <table className="w-full border-collapse text-xs min-w-[200px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-black/5 dark:bg-white/5">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  img: ({ src, alt }) => (
    <img src={src} alt={alt || ''} className="max-w-full rounded my-2" />
  ),
  // Strikethrough (GFM)
  del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="ai-markdown-content text-xs leading-relaxed">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
