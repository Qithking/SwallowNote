/**
 * MarkmapBlockEditor Component
 * Renders Markmap mindmaps in BlockNote editor.
 */
import { useEffect, useState, useRef } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useBlockResize } from '@/hooks/useBlockResize'
import { BlockResizeHandles } from './BlockResizeHandles'

interface MarkmapBlockEditorProps {
  diagram: string
  source: string
  width: number
  height: number
  scale: number
  block: any
  editor: any
}

type MarkmapInstance = {
  setData: (data: any) => Promise<void>
  destroy: () => void
  fit: (maxScale?: number) => Promise<void>
  state: { transform: [number, number, number] }
  zoom: { transform: (node: SVGSVGElement, transform: { k: number; x: number; y: number }) => void }
}

export function MarkmapBlockEditor({ diagram, source, width, height, scale, block, editor }: MarkmapBlockEditorProps) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement>(null)
  const dialogSvgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<MarkmapInstance | null>(null)
  const dialogMarkmapRef = useRef<MarkmapInstance | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [hasError, setHasError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Resize state (unified hook)
  const { currentWidth, currentHeight, currentWidthRef, currentHeightRef, startResize } = useBlockResize({
    initialWidth: width,
    initialHeight: height,
    editor,
    block,
    containerRef,
  })

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

  // Error or empty: show source fallback
  if (!diagram.trim() || hasError) {
    return (
      <figure className="markmap-block-editor markmap-block-editor--error my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
        <figcaption className="flex items-center px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">markmap</span>
          <span className="ml-2 text-destructive text-[9px]">{t('error.renderFailed')}</span>
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
      {editor?.isEditable && (
        <BlockResizeHandles onStartResize={startResize} groupHoverClass="group-hover/markmap" />
      )}
    </figure>
  )
}
