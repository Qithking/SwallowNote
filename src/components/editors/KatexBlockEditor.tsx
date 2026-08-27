/**
 * KatexBlockEditor Component
 * Renders KaTeX math formulas in BlockNote editor.
 * Mirrors the MermaidBlockEditor pattern: an inert (non-editable) display block
 * that lets users edit the LaTeX source via an inline editor and view it large
 * in a dialog.
 * 
 * Supports width/height resizing via drag handles (block mode only).
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import 'katex/dist/katex.min.css'
import { Code2, Maximize2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useBlockResize } from '@/hooks/useBlockResize'
import { BlockResizeHandles } from './BlockResizeHandles'

interface KatexBlockEditorProps {
  source: string
  formula: string
  display: boolean
  width: number
  height: number
  block: any
  editor: any
}

interface RenderState {
  formula: string
  display: boolean
  html: string
  error: string | null
}

// Lazy-load katex to reduce initial bundle size — only imported when a KaTeX block is rendered
let katexModule: typeof import('katex') | null = null
async function getKatex() {
  if (!katexModule) {
    katexModule = await import('katex')
  }
  return katexModule.default
}

// KaTeX 渲染结果 LRU 缓存：key=`${display?'d':'i'}\0${formula}`，仅缓存成功结果
const katexRenderCache = new Map<string, { html: string; error: string | null }>()
const KATEX_CACHE_MAX = 50

function renderKatex(formula: string, display: boolean): Promise<{ html: string; error: string | null }> {
  const cacheKey = `${display ? 'd' : 'i'}\0${formula}`
  const hit = katexRenderCache.get(cacheKey)
  if (hit) {
    // LRU：命中时移到末尾（最近使用）
    katexRenderCache.delete(cacheKey)
    katexRenderCache.set(cacheKey, hit)
    return Promise.resolve(hit)
  }
  return getKatex().then((katex) => {
    try {
      const html = katex.renderToString(formula, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
        trust: false,
      })
      const result = { html, error: null }
      katexRenderCache.set(cacheKey, result)
      if (katexRenderCache.size > KATEX_CACHE_MAX) {
        const oldest = katexRenderCache.keys().next().value
        if (oldest !== undefined) katexRenderCache.delete(oldest)
      }
      return result
    } catch (e) {
      return { html: '', error: e instanceof Error ? e.message : String(e) }
    }
  }).catch(() => ({ html: '', error: 'Failed to load KaTeX' }))
}

export function KatexBlockEditor({ source, formula, display, width, height, block, editor }: KatexBlockEditorProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<RenderState>({ formula, display, html: '', error: null })
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(formula)
  
  // Resize state (block mode only, unified hook)
  const containerRef = useRef<HTMLDivElement>(null)
  const { currentWidth, currentHeight, startResize } = useBlockResize({
    initialWidth: width,
    initialHeight: height,
    editor,
    block,
    containerRef,
  })

  // Re-render when the formula or display mode changes
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    renderKatex(formula, display).then((result) => {
      if (!cancelled) {
        setState({ formula, display, ...result })
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [formula, display])

  const handleStartEdit = useCallback(() => {
    setDraft(formula)
    setIsEditing(true)
  }, [formula])

  const handleSave = useCallback(() => {
    if (editor?.updateBlock) {
      editor.updateBlock(block, {
        props: {
          source: `\`\`\`${display ? 'math' : 'math-inline'}\n${draft}\n\`\`\``,
          formula: draft,
        },
      } as any)
    }
    setIsEditing(false)
  }, [draft, formula, editor, block, display])

  const handleCancel = useCallback(() => {
    setDraft(formula)
    setIsEditing(false)
  }, [formula])

  const handleSwitchMode = useCallback(() => {
    if (!editor?.updateBlock) return
    editor.updateBlock(block, {
      props: { ...block.props, display: !display },
    } as any)
  }, [editor, block, display])

  // Build the source for the fallback view (matches the markdown representation)
  const fallbackSource = source || `\`\`\`${display ? 'math' : 'math-inline'}\n${formula}\n\`\`\``

  // Error or empty formula: show source fallback with an edit button
  if (!formula.trim() || state.error || isLoading) {
    return (
      <figure
        className="katex-block-editor katex-block-editor--error my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]"
        contentEditable={false}
      >
        <figcaption className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">{display ? 'math (block)' : 'math (inline)'}</span>
          <span className="text-destructive text-[9px]">
            {state.error ? t('editor.katex.renderFailed', { error: state.error }) : t('editor.katex.emptyFormula')}
          </span>
        </figcaption>
        <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{fallbackSource}</code>
        </pre>
        {editor?.isEditable && (
          <div className="flex items-center gap-1 px-3 py-1 border-t border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleStartEdit}
            >
              <Code2 className="w-3 h-3 mr-1" />
              {t('editor.katex.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleSwitchMode}
            >
              {display ? t('editor.katex.switchToInline') : t('editor.katex.switchToBlock')}
            </Button>
          </div>
        )}
        {isEditing && (
          <InlineEditor
            draft={draft}
            setDraft={setDraft}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </figure>
    )
  }

  // Calculate container styles for resizable block mode
  const containerStyle: React.CSSProperties = display && currentWidth > 0 && currentHeight > 0
    ? { width: currentWidth, height: currentHeight, position: 'relative' }
    : {}

  return (
    <figure
      ref={containerRef}
      className="katex-block-editor group/katex relative my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20"
      contentEditable={false}
      style={containerStyle}
    >
      {/* Header: language label + actions */}
      <figcaption className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
        <span className="font-mono">{display ? 'math (block)' : 'math (inline)'}</span>
        {editor?.isEditable && (
          <div className="flex items-center gap-1 opacity-0 group-hover/katex:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={handleSwitchMode}
              title={display ? t('editor.katex.switchToInlineTitle') : t('editor.katex.switchToBlockTitle')}
            >
              {display ? t('editor.katex.switchToInline') : t('editor.katex.switchToBlock')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={handleStartEdit}
              title={t('editor.katex.editLatex')}
            >
              <Code2 className="w-3 h-3 mr-1" />
              {t('editor.katex.edit')}
            </Button>
          </div>
        )}
      </figcaption>

      {/* Rendered math */}
      <div
        className={
          display
            ? 'katex-block-viewport overflow-auto p-3 flex items-center justify-center min-h-[40px] [&_.katex-display]:m-0'
            : 'katex-inline-viewport overflow-x-auto p-3 flex items-center min-h-[32px]'
        }
        style={display && currentHeight > 0 ? { height: currentHeight - 28 } : {}} // Subtract header height
        dangerouslySetInnerHTML={{ __html: state.html }}
      />

      {/* Expand button - only for block math (inline is too small) */}
      {display && (
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="absolute top-7 right-2 h-6 w-6 opacity-0 group-hover/katex:opacity-100 transition-opacity z-10"
              title={t('editor.katex.expand')}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl w-[90vw] max-h-[80vh] p-6 flex flex-col">
            <DialogTitle className="text-sm font-semibold mb-2">{t('editor.katex.dialogTitle')}</DialogTitle>
            <div className="flex-1 overflow-auto flex items-center justify-center bg-white dark:bg-black/20 rounded p-6 min-h-[120px]">
              <div
                className="[&_.katex-display]:m-0 [&_.katex]:text-2xl"
                dangerouslySetInnerHTML={{ __html: state.html }}
              />
            </div>
            <pre className="mt-3 p-2 rounded bg-black/5 dark:bg-white/5 text-xs font-mono overflow-x-auto max-h-32">
              <code>{formula}</code>
            </pre>
          </DialogContent>
        </Dialog>
      )}

      {/* Resize handles - only for block mode */}
      {display && editor?.isEditable && (
        <BlockResizeHandles onStartResize={startResize} groupHoverClass="group-hover/katex" />
      )}

      {/* Inline editor */}
      {isEditing && (
        <InlineEditor
          draft={draft}
          setDraft={setDraft}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </figure>
  )
}

function InlineEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: string
  setDraft: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="px-3 py-2 border-t border-border/50 bg-black/[0.02] dark:bg-white/[0.02]"
      contentEditable={false}
    >
      <textarea
        className="w-full font-mono text-xs p-2 rounded border border-border/50 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
        rows={Math.max(2, draft.split('\n').length)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onCancel}>
          {t('editor.katex.cancel')}
        </Button>
        <Button variant="default" size="sm" className="h-6 text-[10px]" onClick={onSave}>
          {t('editor.katex.save')}
        </Button>
      </div>
    </div>
  )
}
