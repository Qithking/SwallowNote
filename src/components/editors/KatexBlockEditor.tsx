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
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Code2, Maximize2, GripVertical, GripHorizontal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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

interface ResizeState {
  handleUsed: 'left' | 'right' | 'bottom' | 'corner'
  initialWidth: number
  initialHeight: number
  initialClientX: number
  initialClientY: number
}

function renderKatex(formula: string, display: boolean): { html: string; error: string | null } {
  try {
    const html = katex.renderToString(formula, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      strict: 'ignore',
      trust: false,
    })
    return { html, error: null }
  } catch (e) {
    return { html: '', error: e instanceof Error ? e.message : String(e) }
  }
}

export function KatexBlockEditor({ source, formula, display, width, height, block, editor }: KatexBlockEditorProps) {
  const [state, setState] = useState<RenderState>(() => {
    const initial = renderKatex(formula, display)
    return { formula, display, ...initial }
  })
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(formula)
  
  // Resize state (block mode only)
  const [resizeState, setResizeState] = useState<ResizeState | undefined>(undefined)
  const [currentWidth, setCurrentWidth] = useState<number>(width || 0)
  const [currentHeight, setCurrentHeight] = useState<number>(height || 0)
  // Use refs to track latest values for the mouseup handler
  const currentWidthRef = useRef(currentWidth)
  const currentHeightRef = useRef(currentHeight)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep refs in sync with state
  useEffect(() => {
    currentWidthRef.current = currentWidth
  }, [currentWidth])
  useEffect(() => {
    currentHeightRef.current = currentHeight
  }, [currentHeight])

  // Sync props changes
  useEffect(() => {
    if (width && width !== currentWidthRef.current) setCurrentWidth(width)
  }, [width])
  useEffect(() => {
    if (height && height !== currentHeightRef.current) setCurrentHeight(height)
  }, [height])

  // Handle resize drag (block mode only)
  useEffect(() => {
    if (!resizeState || !display) return

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const maxWidth = editor?.domElement?.firstElementChild?.clientWidth || 1200

      if (resizeState.handleUsed === 'left' || resizeState.handleUsed === 'right' || resizeState.handleUsed === 'corner') {
        let newWidth: number
        if (resizeState.handleUsed === 'left') {
          newWidth = resizeState.initialWidth + (resizeState.initialClientX - clientX)
        } else {
          newWidth = resizeState.initialWidth + (clientX - resizeState.initialClientX)
        }
        setCurrentWidth(Math.min(Math.max(newWidth, 200), maxWidth))
      }

      if (resizeState.handleUsed === 'bottom' || resizeState.handleUsed === 'corner') {
        const newHeight = resizeState.initialHeight + (clientY - resizeState.initialClientY)
        setCurrentHeight(Math.min(Math.max(newHeight, 80), 600))
      }
    }

    const handleMouseUp = () => {
      setResizeState(undefined)
      // Use refs to get the latest values
      editor?.updateBlock(block, { props: { width: currentWidthRef.current, height: currentHeightRef.current } })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchmove', handleMouseMove)
    window.addEventListener('touchend', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleMouseMove)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [resizeState, display, editor, block])

  const startResize = useCallback((handle: ResizeState['handleUsed'], e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    setResizeState({
      handleUsed: handle,
      initialWidth: currentWidth,
      initialHeight: currentHeight,
      initialClientX: clientX,
      initialClientY: clientY,
    })
  }, [currentWidth, currentHeight])

  // Re-render when the formula or display mode changes
  useEffect(() => {
    const next = renderKatex(formula, display)
    setState({ formula, display, ...next })
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
  if (!formula.trim() || state.error) {
    return (
      <figure
        className="katex-block-editor katex-block-editor--error my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]"
        contentEditable={false}
      >
        <figcaption className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">{display ? 'math (block)' : 'math (inline)'}</span>
          <span className="text-destructive text-[9px]">
            {state.error ? `渲染失败: ${state.error}` : '空公式'}
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
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleSwitchMode}
            >
              {display ? '转为行内' : '转为块级'}
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
              title={display ? '切换为行内公式' : '切换为块级公式'}
            >
              {display ? '转为行内' : '转为块级'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={handleStartEdit}
              title="编辑 LaTeX"
            >
              <Code2 className="w-3 h-3 mr-1" />
              编辑
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
              title="放大查看"
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl w-[90vw] max-h-[80vh] p-6 flex flex-col">
            <DialogTitle className="text-sm font-semibold mb-2">LaTeX 公式</DialogTitle>
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
        <>
          {/* Right resize handle */}
          <div
            className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-12 flex items-center justify-center cursor-ew-resize opacity-0 group-hover/katex:opacity-100 transition-opacity hover:bg-primary/10 rounded-l"
            onMouseDown={(e) => startResize('right', e)}
            onTouchStart={(e) => startResize('right', e)}
            title="拖动调整宽度"
          >
            <GripVertical className="w-3 h-3 text-muted-foreground" />
          </div>
          {/* Bottom resize handle */}
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 h-4 w-12 flex items-center justify-center cursor-ns-resize opacity-0 group-hover/katex:opacity-100 transition-opacity hover:bg-primary/10 rounded-t"
            onMouseDown={(e) => startResize('bottom', e)}
            onTouchStart={(e) => startResize('bottom', e)}
            title="拖动调整高度"
          >
            <GripHorizontal className="w-3 h-3 text-muted-foreground" />
          </div>
          {/* Corner resize handle */}
          <div
            className="absolute right-0 bottom-0 w-6 h-6 flex items-center justify-center cursor-nwse-resize opacity-0 group-hover/katex:opacity-100 transition-opacity hover:bg-primary/10 rounded-tl"
            onMouseDown={(e) => startResize('corner', e)}
            onTouchStart={(e) => startResize('corner', e)}
            title="拖动调整宽高"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-muted-foreground">
              <path d="M1 9L9 1M5 9L9 5M9 9L9 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </>
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
          取消
        </Button>
        <Button variant="default" size="sm" className="h-6 text-[10px]" onClick={onSave}>
          保存
        </Button>
      </div>
    </div>
  )
}
