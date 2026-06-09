/**
 * MathBlock Component
 * Renders KaTeX math formulas in markdown code blocks for AI chat messages.
 * Mirrors the MermaidBlock pattern: a code block with `math` or `math-inline`
 * language is rendered as a KaTeX formula.
 */
import { useEffect, useState } from 'react'
// Lazy-load katex to reduce initial bundle size
let katexModule: typeof import('katex') | null = null
async function getKatex() {
  if (!katexModule) {
    katexModule = await import('katex')
  }
  return katexModule.default
}

function renderFormula(formula: string, display: boolean): Promise<{ html: string; error: boolean }> {
  return getKatex().then((katex) => {
    try {
      const html = katex.renderToString(formula, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
        trust: false,
      })
      return { html, error: false }
    } catch {
      return { html: '', error: true }
    }
  }).catch(() => ({ html: '', error: true }))
}

interface MathBlockProps {
  formula: string
  display: boolean
}

interface RenderState {
  html: string
  error: boolean
}

export function MathBlock({ formula, display }: MathBlockProps) {
  const [state, setState] = useState<RenderState>({ html: '', error: false })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    renderFormula(formula, display).then((result) => {
      if (!cancelled) {
        setState(result)
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [formula, display])

  // Error or empty: show source fallback
  if (!formula.trim() || state.error || isLoading) {
    return (
      <div className="my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="flex items-center px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">{display ? 'math' : 'math-inline'}</span>
          <span className="ml-2 text-destructive text-[9px]">
            {state.error ? '渲染失败' : '空公式'}
          </span>
        </div>
        <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{formula}</code>
        </pre>
      </div>
    )
  }

  return (
    <div
      className={
        display
          ? 'my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20 p-3 flex items-center justify-center overflow-x-auto [&_.katex-display]:m-0'
          : 'my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20 p-2 overflow-x-auto'
      }
    >
      <span
        className={display ? '[&_.katex-display]:m-0' : ''}
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    </div>
  )
}
