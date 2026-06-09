/**
 * MermaidBlock Component
 * Renders Mermaid diagrams in markdown code blocks.
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

type MermaidApi = typeof import('mermaid')['default']

interface MermaidBlockProps {
  diagram: string
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
  'width:0',
  'height:0',
  'overflow:hidden',
].join(';')

function renderIdFromReactId(reactId: string): string {
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `swallownote-mermaid-${safeId || 'diagram'}`
}

function initializeMermaid(mermaid: MermaidApi) {
  if (initialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'default',
    suppressErrorRendering: true,
    themeVariables: {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
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
function SafeSvgDiv({ svg, className }: { svg: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const parsed = new DOMParser().parseFromString(svg, 'text/html')
    const svgNode = parsed.body.querySelector('svg')
    if (svgNode) {
      const imported = document.importNode(svgNode, true)
      ref.current.replaceChildren(imported)
    } else {
      ref.current.replaceChildren()
    }
  }, [svg])

  return <div className={className} ref={ref} />
}

export function MermaidBlock({ diagram }: MermaidBlockProps) {
  const reactId = useId()
  const renderId = useMemo(() => renderIdFromReactId(reactId), [reactId])
  const [state, setState] = useState<RenderState>({ diagram: '', svg: '', error: false })

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
      <div className="my-2 rounded-md overflow-hidden border border-border/50 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="flex items-center px-3 py-1 text-[10px] text-muted-foreground bg-black/5 dark:bg-white/5">
          <span className="font-mono">mermaid</span>
          <span className="ml-2 text-destructive text-[9px]">渲染失败</span>
        </div>
        <pre className="p-3 m-0 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{diagram}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="mermaid-block group/mermaid relative my-2 rounded-md overflow-hidden border border-border/50 bg-white dark:bg-black/20">
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
          <div className="flex-1 overflow-auto flex items-center justify-center bg-white dark:bg-black/20 rounded">
            <SafeSvgDiv
              svg={currentState.svg}
              className="mermaid-dialog-viewport max-w-full max-h-full [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Diagram viewport */}
      <div className="mermaid-viewport overflow-auto p-4 flex items-center justify-center min-h-[60px]">
        <SafeSvgDiv
          svg={currentState.svg}
          className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto"
        />
      </div>
    </div>
  )
}
