/**
 * MermaidBlockEditor Component
 * Renders Mermaid diagrams in BlockNote editor.
 * Adapted from tolaria's MermaidDiagram component.
 */
import { useEffect, useId, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useBlockResize } from '@/hooks/useBlockResize'
import { BlockResizeHandles } from './BlockResizeHandles'

type MermaidApi = typeof import('mermaid')['default']

interface MermaidBlockEditorProps {
  diagram: string
  source: string
  width: number
  height: number
  block: any
  editor: any
}

interface RenderState {
  diagram: string
  svg: string
  error: boolean
}

let initialized = false
let renderQueue = Promise.resolve()

const MERMAID_RENDER_HOST_STYLE = [
  'position:absolute',
  'left:-10000px',
  'top:-10000px',
  'width:800px',
  'height:600px',
  'overflow:visible',
].join(';')

function renderIdFromReactId(reactId: string): string {
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `swallownote-mermaid-${safeId || 'diagram'}`
}

function initializeMermaid(mermaid: MermaidApi) {
  if (initialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    suppressErrorRendering: false,
    themeVariables: {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    gantt: {
      titleTopMargin: 15,
      barHeight: 20,
      barGap: 4,
      topPadding: 50,
      rightPadding: 75,
      leftPadding: 75,
      fontSize: 11,
    },
  })
  initialized = true
}

function appendMermaidRenderHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('data-swallownote-mermaid-render-host', '')
  host.style.cssText = MERMAID_RENDER_HOST_STYLE
  document.body.appendChild(host)
  return host
}

function removeMermaidRenderArtifacts(renderId: string, host: HTMLElement): void {
  host.remove()
  document.getElementById(renderId)?.remove()
  document.getElementById(`d${renderId}`)?.remove()
  document.getElementById(`i${renderId}`)?.remove()
}

async function renderMermaidDiagram({
  diagram,
  renderId,
}: {
  diagram: string
  renderId: string
}): Promise<string> {
  const render = async () => {
    const mermaid = (await import('mermaid')).default
    initializeMermaid(mermaid)
    const renderHost = appendMermaidRenderHost()
    try {
      const result = await mermaid.render(renderId, diagram, renderHost)
      return result.svg
    } finally {
      removeMermaidRenderArtifacts(renderId, renderHost)
    }
  }
  const nextRender = renderQueue.then(render, render)
  renderQueue = nextRender.then(() => undefined, () => undefined)
  return nextRender
}

/** Safe SVG renderer that parses and sanitizes SVG content */
function SafeSvgDiv({ svg, className, responsive }: { svg: string; className?: string; responsive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const parsed = new DOMParser().parseFromString(svg, 'text/html')
    const svgNode = parsed.body.querySelector('svg')
    if (svgNode) {
      const imported = document.importNode(svgNode, true) as SVGElement
      if (responsive) {
        // Ensure viewBox exists for proper aspect ratio scaling
        if (!imported.getAttribute('viewBox')) {
          const style = (svgNode as SVGElement).style
          const w = style.width || svgNode.getAttribute('width') || '800'
          const h = style.height || svgNode.getAttribute('height') || '600'
          imported.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`)
        }
        // Remove fixed width/height from ALL <svg> elements (outer + nested) so
        // the diagram scales with the container. Required because mermaid with
        // securityLevel:'loose' can emit nested <svg> nodes (foreignObject,
        // internal icons) carrying empty width=""/height="" attributes, which
        // the browser rejects with "Invalid value for <svg> attribute width=''"
        // when the imported node is attached to the live document.
        imported.querySelectorAll('svg').forEach((el) => {
          el.removeAttribute('width')
          el.removeAttribute('height')
        })
        imported.style.width = '100%'
        imported.style.height = '100%'
      }
      ref.current.replaceChildren(imported)
    } else {
      ref.current.replaceChildren()
    }
  }, [svg, responsive])

  return <div className={className} ref={ref} />
}

export function MermaidBlockEditor({ diagram, source, width, height, block, editor }: MermaidBlockEditorProps) {
  const reactId = useId()
  const renderId = useMemo(() => renderIdFromReactId(reactId), [reactId])
  const [state, setState] = useState<RenderState>({ diagram: '', svg: '', error: false })
  
  // Resize state (unified hook)
  const containerRef = useRef<HTMLDivElement>(null)
  const { currentWidth, currentHeight, startResize } = useBlockResize({
    initialWidth: width,
    initialHeight: height,
    editor,
    block,
    containerRef,
  })

  useEffect(() => {
    let active = true
    if (!diagram.trim()) return () => { active = false }

    renderMermaidDiagram({ diagram, renderId })
      .then((svg) => {
        if (active) setState({ diagram, svg, error: false })
      })
      .catch(() => {
        if (active) setState({ diagram, svg: '', error: true })
      })

    return () => { active = false }
  }, [diagram, renderId])

  const currentState = state.diagram === diagram ? state : { diagram, svg: '', error: false }

  // Error or empty: show source fallback
  if (!diagram.trim() || currentState.error) {
    return (
      <figure className="mermaid-block-editor mermaid-block-editor--error my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
        <figcaption className="flex items-center px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">mermaid</span>
          <span className="ml-2 text-destructive text-[9px]">渲染失败</span>
        </figcaption>
        <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{source}</code>
        </pre>
      </figure>
    )
  }

  // Build inline style for container dimensions
  const containerStyle: React.CSSProperties = {}
  if (currentWidth) containerStyle.width = `${currentWidth}px`
  if (currentHeight) containerStyle.height = `${currentHeight}px`

  return (
    <figure
      ref={containerRef}
      className="mermaid-block-editor group/mermaid relative my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20"
      style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}
    >
      {/* Expand button */}
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover/mermaid:opacity-100 transition-opacity z-10"
            title="展开图表"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl w-[90vw] h-[80vh] p-4 flex flex-col">
          <DialogTitle className="sr-only">Mermaid 图表</DialogTitle>
          <div className="flex-1 overflow-auto flex items-center justify-center bg-white dark:bg-black/20 rounded p-4">
            <SafeSvgDiv
              svg={currentState.svg}
              responsive
              className="mermaid-dialog-viewport w-full h-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Diagram viewport - SVG scales to fill container */}
      <div className="mermaid-viewport w-full h-full overflow-auto p-4 flex items-center justify-center min-h-[60px]">
        <SafeSvgDiv
          svg={currentState.svg}
          responsive
          className="w-full h-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:object-contain"
        />
      </div>

      {/* Resize handles */}
      {editor?.isEditable && (
        <BlockResizeHandles onStartResize={startResize} groupHoverClass="group-hover/mermaid" />
      )}
    </figure>
  )
}
