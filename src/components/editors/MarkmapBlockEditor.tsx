/**
 * MarkmapBlockEditor Component
 * Renders Markmap mindmaps in BlockNote editor.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MarkmapBlockEditorProps {
  diagram: string
  source: string
  width: number
  height: number
  scale: number
  block: any
  editor: any
}

interface ResizeState {
  handleUsed: 'left' | 'right' | 'bottom' | 'corner'
  initialWidth: number
  initialHeight: number
  initialClientX: number
  initialClientY: number
}

type MarkmapInstance = {
  setData: (data: any) => Promise<void>
  destroy: () => void
  fit: (maxScale?: number) => Promise<void>
  state: { transform: [number, number, number] }
  zoom: { transform: (node: SVGSVGElement, transform: { k: number; x: number; y: number }) => void }
}

export function MarkmapBlockEditor({ diagram, source, width, height, scale, block, editor }: MarkmapBlockEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dialogSvgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<MarkmapInstance | null>(null)
  const dialogMarkmapRef = useRef<MarkmapInstance | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [hasError, setHasError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Resize state
  const [resizeState, setResizeState] = useState<ResizeState | undefined>(undefined)
  const [currentWidth, setCurrentWidth] = useState<number>(width || 0)
  const [currentHeight, setCurrentHeight] = useState<number>(height || 0)
  const currentWidthRef = useRef(currentWidth)
  const currentHeightRef = useRef(currentHeight)

  useEffect(() => { currentWidthRef.current = currentWidth }, [currentWidth])
  useEffect(() => { currentHeightRef.current = currentHeight }, [currentHeight])

  // Sync props changes
  useEffect(() => {
    if (width && width !== currentWidthRef.current) setCurrentWidth(width)
  }, [width])
  useEffect(() => {
    if (height && height !== currentHeightRef.current) setCurrentHeight(height)
  }, [height])

  // Render markmap into inline svg
  useEffect(() => {
    let active = true
    setHasError(false)

    if (!diagram.trim() || !svgRef.current) {
      return () => { active = false }
    }

    ;(async () => {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib'),
          import('markmap-view'),
        ])
        if (!active || !svgRef.current) return

        const transformer = new Transformer()
        const { root } = transformer.transform(diagram)
        const instance = Markmap.create(svgRef.current) as unknown as MarkmapInstance
        await instance.setData(root ?? { type: 'heading', depth: 0, value: '' })

        // Apply saved zoom scale if available, otherwise auto-fit
        if (scale && scale > 0 && instance.zoom && instance.state) {
          try {
            const { zoomIdentity } = await import('d3-zoom')
            instance.zoom.transform(svgRef.current, zoomIdentity.scale(scale))
          } catch {
            await instance.fit()
          }
        } else {
          await instance.fit()
        }
        markmapRef.current = instance

        // Persist the current scale into the markmap-meta comment for next load
        if (active && instance.state && editor && block) {
          const currentScale = instance.state.transform?.[2] ?? 0
          if (
            currentScale > 0 &&
            Math.abs(currentScale - (scale || 0)) > 0.001
          ) {
            const newMeta = JSON.stringify({
              width: currentWidthRef.current || 0,
              height: currentHeightRef.current || 0,
              scale: currentScale,
            })
            const cleanDiagram = diagram.replace(/<!--\s*markmap-meta:.*?-->\s*\n?/g, '')
            const newDiagram = `<!-- markmap-meta:${newMeta} -->\n${cleanDiagram}`
            try {
              editor.updateBlock(block, {
                props: { diagram: newDiagram, scale: currentScale },
              })
            } catch {
              /* noop */
            }
          }
        }
      } catch {
        if (active) setHasError(true)
      }
    })()

    return () => {
      active = false
      const inst = markmapRef.current
      markmapRef.current = null
      if (inst) {
        try { inst.destroy() } catch { /* noop */ }
      }
    }
  }, [diagram, scale])

  // Render markmap into dialog svg when opened
  useEffect(() => {
    if (!dialogOpen) return
    let active = true

    // Wait one frame so the dialog SVG element is mounted
    const id = requestAnimationFrame(async () => {
      if (!active || !dialogSvgRef.current) return
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib'),
          import('markmap-view'),
        ])
        if (!active || !dialogSvgRef.current) return

        const transformer = new Transformer()
        const { root } = transformer.transform(diagram)
        const instance = Markmap.create(dialogSvgRef.current) as unknown as MarkmapInstance
        await instance.setData(root ?? { type: 'heading', depth: 0, value: '' })
        await instance.fit()
        dialogMarkmapRef.current = instance
      } catch {
        if (active) setHasError(true)
      }
    })

    return () => {
      active = false
      cancelAnimationFrame(id)
      const inst = dialogMarkmapRef.current
      dialogMarkmapRef.current = null
      if (inst) {
        try { inst.destroy() } catch { /* noop */ }
      }
    }
  }, [dialogOpen, diagram])

  // Auto-fit inline markmap when container size changes (width/height resize, window resize, etc.)
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const inst = markmapRef.current
        if (inst) {
          inst.fit().catch(() => { /* noop */ })
        }
      })
    })
    observer.observe(container)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [diagram])

  // Auto-fit dialog markmap while dialog is open and viewport changes
  useEffect(() => {
    if (!dialogOpen) return
    const svg = dialogSvgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const inst = dialogMarkmapRef.current
        if (inst) {
          inst.fit().catch(() => { /* noop */ })
        }
      })
    })
    observer.observe(svg)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [dialogOpen])

  // Handle resize drag
  useEffect(() => {
    if (!resizeState) return

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
        setCurrentWidth(Math.min(Math.max(newWidth, 240), maxWidth))
      }

      if (resizeState.handleUsed === 'bottom' || resizeState.handleUsed === 'corner') {
        const newHeight = resizeState.initialHeight + (clientY - resizeState.initialClientY)
        setCurrentHeight(Math.min(Math.max(newHeight, 160), 800))
      }
    }

    const handleMouseUp = () => {
      setResizeState(undefined)
      editor?.updateBlock(block, { props: { width: currentWidthRef.current, height: currentHeightRef.current } })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('touchmove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchend', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('touchmove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [resizeState, editor, block])

  const getInitialSize = useCallback(() => ({
    initialWidth: currentWidth || containerRef.current?.clientWidth || 480,
    initialHeight: currentHeight || containerRef.current?.clientHeight || 320,
  }), [currentWidth, currentHeight])

  const handleMouseDown = useCallback((handle: ResizeState['handleUsed']) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const size = getInitialSize()
    setResizeState({
      handleUsed: handle,
      ...size,
      initialClientX: clientX,
      initialClientY: clientY,
    })
  }, [getInitialSize])

  // Error or empty: show source fallback
  if (!diagram.trim() || hasError) {
    return (
      <figure className="markmap-block-editor markmap-block-editor--error my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
        <figcaption className="flex items-center px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">markmap</span>
          <span className="ml-2 text-destructive text-[9px]">渲染失败</span>
        </figcaption>
        <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{source}</code>
        </pre>
      </figure>
    )
  }

  const containerStyle: React.CSSProperties = {}
  if (currentWidth) containerStyle.width = `${currentWidth}px`
  if (currentHeight) containerStyle.height = `${currentHeight}px`

  return (
    <figure
      ref={containerRef}
      className="markmap-block-editor group/markmap relative my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20"
      style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}
    >
      {/* Expand button */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover/markmap:opacity-100 transition-opacity z-10"
            title="展开思维导图"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl w-[90vw] h-[80vh] p-4 flex flex-col">
          <DialogTitle className="sr-only">Markmap 思维导图</DialogTitle>
          <div className="flex-1 overflow-auto flex items-center justify-center bg-white dark:bg-black/20 rounded p-4">
            <svg
              ref={dialogSvgRef}
              className="markmap-dialog-viewport w-full h-full"
            />
          </div>
        </DialogContent>
      </Dialog>

      <svg
        ref={svgRef}
        className="markmap-svg w-full h-full"
        style={currentHeight ? { height: `${currentHeight}px` } : { minHeight: '320px' }}
      />

      {/* Resize handles */}
      <div
        className="absolute top-1/2 -translate-y-1/2 left-0 w-1.5 h-8 cursor-ew-resize opacity-0 group-hover/markmap:opacity-100 transition-opacity bg-border hover:bg-primary/50 rounded-r"
        onMouseDown={handleMouseDown('left')}
        onTouchStart={handleMouseDown('left')}
        title="拖拽调整宽度"
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 right-0 w-1.5 h-8 cursor-ew-resize opacity-0 group-hover/markmap:opacity-100 transition-opacity bg-border hover:bg-primary/50 rounded-l"
        onMouseDown={handleMouseDown('right')}
        onTouchStart={handleMouseDown('right')}
        title="拖拽调整宽度"
      />
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-8 cursor-ns-resize opacity-0 group-hover/markmap:opacity-100 transition-opacity bg-border hover:bg-primary/50 rounded-t"
        onMouseDown={handleMouseDown('bottom')}
        onTouchStart={handleMouseDown('bottom')}
        title="拖拽调整高度"
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize opacity-0 group-hover/markmap:opacity-100 transition-opacity"
        onMouseDown={handleMouseDown('corner')}
        onTouchStart={handleMouseDown('corner')}
        title="拖拽调整尺寸"
      />
    </figure>
  )
}
