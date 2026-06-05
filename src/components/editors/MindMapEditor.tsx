import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores'
import { MindMapToolbar } from './MindMapToolbar'
import { MindMapContextMenu } from './MindMapContextMenu'

interface MindMapEditorProps {
  content: string
  onChange?: (content: string) => void
}

const DEFAULT_DATA = (t: (key: string) => string) => ({
  root: {
    data: { text: t('mindMap.defaultRootText') },
    children: [],
  },
})

function ensureNodeTextValid(node: any): void {
  if (!node) return
  if (node.data) {
    if (node.data.text === undefined || node.data.text === null) {
      node.data.text = ''
    } else if (typeof node.data.text !== 'string') {
      node.data.text = String(node.data.text)
    }
    if (Array.isArray(node.data.generalization)) {
      for (const item of node.data.generalization) {
        if (item.text === undefined || item.text === null) {
          item.text = ''
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      ensureNodeTextValid(child)
    }
  }
}

function parseMindMapData(content: string, t?: (key: string) => string) {
  let data: any
  if (!content || !content.trim()) {
    data = { ...DEFAULT_DATA(t || ((k: string) => k)) }
  } else {
    try {
      const parsed = JSON.parse(content)
      if (parsed && parsed.root) {
        // Keep all config fields (layout, theme, themeConfig, etc.)
        data = parsed
      } else if (parsed && parsed.data && parsed.data.text) {
        data = { root: parsed }
      } else {
        data = { ...DEFAULT_DATA }
      }
    } catch {
      data = { ...DEFAULT_DATA }
    }
  }
  if (data?.root) {
    ensureNodeTextValid(data.root)
  }
  return data
}

export function MindMapEditor({ content, onChange }: MindMapEditorProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mindMapInstanceRef = useRef<any>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContent = useRef<string>(content)
  const isInitialLoad = useRef(true)
  const lastLoadedContentRef = useRef<string | null>(null)
  const mindMapReadyRef = useRef(false)
  const mountTimeRef = useRef<number>(0)
  const initStartedRef = useRef(false)
  const destroyedRef = useRef(false)
  const containerReadyRef = useRef(false)
  const pendingContentRef = useRef<string | null>(null)
  const theme = useUIStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mindMapInstance, setMindMapInstance] = useState<any>(null)
  const [noteTooltip, setNoteTooltip] = useState<{
    visible: boolean
    note: string
    left: number
    top: number
    fontFamily: string
    fontSize: number
    color: string
  } | null>(null)
  const watermarkRef = useRef<SVGSVGElement>(null)

  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark

  // Watermark drawing function
  const drawWatermark = useCallback((options?: { forExport?: boolean }) => {
    if (!watermarkRef.current || !mindMapInstanceRef.current) return
    
    const watermarkConfig = mindMapInstanceRef.current.opt?.watermark
    
    if (!watermarkConfig?.enabled) {
      watermarkRef.current.innerHTML = ''
      return
    }

    const { text, color, opacity, fontSize, rotate, lineSpacing, textSpacing, showBelowNodes, showOnExport } = watermarkConfig

    // If showOnExport is true and this is not for export, hide watermark on canvas
    if (showOnExport && !options?.forExport) {
      watermarkRef.current.innerHTML = ''
      return
    }

    // Update z-index based on showBelowNodes
    // When showBelowNodes is true, watermark should be behind nodes (z-index: 1)
    // When showBelowNodes is false, watermark should be in front of nodes (z-index: 10)
    watermarkRef.current.style.zIndex = showBelowNodes ? '1' : '10'

    // Get container dimensions
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const width = containerRect.width
    const height = containerRect.height

    // Create watermark pattern
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    const patternId = 'mindmap-watermark-pattern'
    pattern.setAttribute('id', patternId)
    pattern.setAttribute('x', '0')
    pattern.setAttribute('y', '0')
    pattern.setAttribute('width', String(textSpacing))
    pattern.setAttribute('height', String(lineSpacing))
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')

    // Create text element - center it in the pattern cell
    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    textEl.setAttribute('x', String(textSpacing / 2))
    textEl.setAttribute('y', String(lineSpacing / 2))
    textEl.setAttribute('text-anchor', 'middle')
    textEl.setAttribute('dominant-baseline', 'middle')
    textEl.setAttribute('fill', color)
    textEl.setAttribute('opacity', String(opacity))
    textEl.setAttribute('font-size', String(fontSize))
    textEl.setAttribute('font-family', 'sans-serif')
    textEl.setAttribute('transform', `rotate(${rotate}, ${textSpacing / 2}, ${lineSpacing / 2})`)
    textEl.textContent = text

    pattern.appendChild(textEl)

    // Clear previous watermark
    watermarkRef.current.innerHTML = ''
    
    // Create defs and add pattern
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    defs.appendChild(pattern)
    watermarkRef.current.appendChild(defs)

    // Create rect with pattern fill
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', String(width))
    rect.setAttribute('height', String(height))
    rect.setAttribute('fill', `url(#${patternId})`)
    rect.setAttribute('pointer-events', 'none')
    watermarkRef.current.appendChild(rect)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const scheduleSave = useCallback(() => {
    if (!mindMapReadyRef.current || isInitialLoad.current) {
      if (mindMapInstanceRef.current) {
        try {
          const data = mindMapInstanceRef.current.getData(true)
          // Include watermark config in saved data
          const watermarkConfig = mindMapInstanceRef.current.opt?.watermark
          if (watermarkConfig) {
            data.watermark = watermarkConfig
          }
          lastSavedContent.current = JSON.stringify(data)
        } catch (e) {
          console.error('Failed to get initial mind map data:', e)
        }
      }
      isInitialLoad.current = false
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      if (!mindMapInstanceRef.current || !onChange) return
      try {
        const data = mindMapInstanceRef.current.getData(true)
        // Include watermark config in saved data
        const watermarkConfig = mindMapInstanceRef.current.opt?.watermark
        if (watermarkConfig) {
          data.watermark = watermarkConfig
        }
        const newContent = JSON.stringify(data)
        if (newContent !== lastSavedContent.current) {
          lastSavedContent.current = newContent
          lastLoadedContentRef.current = newContent
          onChange(newContent)
        }
      } catch (e) {
        console.error('Failed to get mind map data:', e)
      }
    }, 500)
  }, [onChange])

  const doInitMindMap = useCallback(async (dataContent: string) => {
    const el = containerRef.current
    if (!el) return
    if (initStartedRef.current) return
    if (destroyedRef.current) return
    initStartedRef.current = true
    isInitialLoad.current = true
    mountTimeRef.current = Date.now()

    try {
      const MindMapModule = await import(
        'simple-mind-map/dist/simpleMindMap.esm.js'
      )
      const MindMap = MindMapModule.default

      if (destroyedRef.current) return

      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        setError(t('mindMap.invalidContainer'))
        setLoading(false)
        return
      }

      const mindMapData = parseMindMapData(dataContent, t)
      lastSavedContent.current = dataContent

      // Determine theme: use saved theme if available, otherwise use current app theme
      const savedTheme = mindMapData.theme
      const currentTheme = isDarkRef.current ? 'dark' : 'default'
      const themeToUse = savedTheme || currentTheme

      const mindMap = new MindMap({
        el,
        data: mindMapData.root || mindMapData,
        readonly: false,
        layout: mindMapData.layout || 'logicalStructure',
        theme: themeToUse,
        fit: true,
        nodeTextEditZIndex: 1000,
        nodeNoteTooltipZIndex: 1000,
        // Restore watermark config if exists
        watermark: mindMapData.watermark || { enabled: false },
        expandBtnSize: 20,
        enableShortcutOnlyWhenMouseInSvg: false,
        mouseScaleCenterUseMousePosition: true,
        customNoteContentShow: {
          show: (note: string, left: number, top: number, node: any) => {
            setNoteTooltip({
              visible: true,
              note,
              left,
              top,
              fontFamily: node?.getStyle?.('fontFamily') || 'inherit',
              fontSize: node?.getStyle?.('fontSize') || 14,
              color: node?.getStyle?.('color') || 'inherit',
            })
          },
          hide: () => {
            setNoteTooltip(null)
          }
        },
      })

      const bgSecondary = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim()
      if (bgSecondary) {
        ;(mindMap as any).setThemeConfig({ backgroundColor: bgSecondary })
      }

      if (destroyedRef.current) {
        mindMap.destroy()
        return
      }

      mindMapInstanceRef.current = mindMap
      lastLoadedContentRef.current = dataContent
      setMindMapInstance(mindMap)
      setLoading(false)
      setError(null)

      const mindMapAny: any = mindMap
      if (mindMapAny.outerFrame) {
        const plugin: any = mindMapAny.outerFrame
        const orig = plugin.renderOuterFrames.bind(plugin)
        plugin.renderOuterFrames = () => {
          plugin.isNotRenderOuterFrames = false
          plugin.clearActiveOuterFrame()
          plugin.clearTextNodes()
          plugin.clearOuterFrameElList()
          const tree = mindMapAny.renderer.root
          if (!tree) { orig(); return }
          const { outerFramePaddingX, outerFramePaddingY } = mindMapAny.opt
          try {
            const t = mindMapAny.draw.transform()
            ;(function walkNode(root: any) {
              if (!root) return
              const children = root.children
              if (!children?.length) { root.children?.forEach((c: any) => walkNode(c)); return }
              const groups: Record<string, Array<{ node: any; index: number }>> = {}
              const direct: Array<{ nodeList: any[]; range: [number, number] }> = []
              children.forEach((item: any, idx: number) => {
                const of = item.getData('outerFrame')
                if (!of) return
                if (of.groupId) {
                  ;(groups[of.groupId] ||= []).push({ node: item, index: idx })
                } else {
                  direct.push({ nodeList: [item], range: [idx, idx] })
                }
              })
              const list = [...direct]
              Object.keys(groups).forEach(id => {
                const g = groups[id]
                list.push({
                  nodeList: g.map(e => e.node),
                  range: [g[0].index, g[g.length - 1].index]
                })
              })
              if (!list.length) { root.children?.forEach((c: any) => walkNode(c)); return }
              list.forEach(({ nodeList, range }: any) => {
                if (range[0] === -1 || range[1] === -1) return
                let minX = Infinity, maxX = -Infinity
                let minY = Infinity, maxY = -Infinity
                let ok = false
                nodeList.forEach((node: any) => {
                  try {
                    const shape = node.group?.findOne?.('.smm-node-shape')
                    if (!shape) return
                    const b = shape.bbox()
                    if (b.x < minX) minX = b.x
                    if (b.x + b.width > maxX) maxX = b.x + b.width
                    if (b.y < minY) minY = b.y
                    if (b.y + b.height > maxY) maxY = b.y + b.height
                    ok = true
                  } catch { /* ignore */ }
                })
                if (!ok || !isFinite(minX) || !isFinite(minY)
                  || !isFinite(maxX - minX) || !isFinite(maxY - minY)) return
                const el = plugin.createOuterFrameEl(
                  (minX - outerFramePaddingX - t.translateX) / t.scaleX,
                  (minY - outerFramePaddingY - t.translateY) / t.scaleY,
                  (maxX - minX + outerFramePaddingX * 2) / t.scaleX,
                  (maxY - minY + outerFramePaddingY * 2) / t.scaleY,
                  plugin.getStyle(nodeList[0])
                )
                const tn = plugin.createText(el, root, range)
                plugin.textNodeList.push(tn)
                plugin.renderText(plugin.getText(nodeList[0]), el, tn, root, range)
                el.on('click', (e: any) => {
                  e.stopPropagation()
                  plugin.setActiveOuterFrame(el, root, range, tn)
                })
              })
              root.children?.forEach((c: any) => walkNode(c))
            })(tree)
          } catch { orig() }
        }
      }

      mindMapReadyRef.current = true

      try {
        const initialData = mindMap.getData(true)
        lastSavedContent.current = JSON.stringify(initialData)
      } catch (e) {
        console.error('Failed to get initial mind map data:', e)
      }

      // Listen for render events to redraw watermark
      mindMap.on('render_end', drawWatermark)
      mindMap.on('view_change', drawWatermark)
      mindMap.on('data_change', scheduleSave)
      
      // Expose drawWatermark function for plugins to call
      ;(mindMap as any).drawWatermark = drawWatermark
      
      // Initial watermark draw
      setTimeout(drawWatermark, 100)
    } catch (e) {
      console.error('Failed to initialize MindMap:', e)
      if (!destroyedRef.current) {
        setError(String(e))
        setLoading(false)
      }
    }
  }, [scheduleSave])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    destroyedRef.current = false

    const rafId = requestAnimationFrame(() => {
      if (destroyedRef.current) return
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        containerReadyRef.current = true
        const pc = pendingContentRef.current
        if (pc && pc.trim()) {
          doInitMindMap(pc)
        }
      } else {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect
            if (width > 0 && height > 0) {
              observer.disconnect()
              if (destroyedRef.current) return
              containerReadyRef.current = true
              const pc = pendingContentRef.current
              if (pc && pc.trim()) {
                doInitMindMap(pc)
              }
            }
          }
        })
        observer.observe(el)
      }
    })

    return () => {
      destroyedRef.current = true
      cancelAnimationFrame(rafId)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      if (mindMapInstanceRef.current) {
        try {
          mindMapInstanceRef.current.off('data_change', scheduleSave)
          mindMapInstanceRef.current.destroy()
        } catch (e) {
          console.error('Failed to destroy MindMap:', e)
        }
        mindMapInstanceRef.current = null
        mindMapReadyRef.current = false
        initStartedRef.current = false
        lastLoadedContentRef.current = null
        setMindMapInstance(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!content || !content.trim()) return

    if (mindMapReadyRef.current) {
      if (content === lastLoadedContentRef.current) return
      isInitialLoad.current = true
      lastLoadedContentRef.current = content

      const mindMapData = parseMindMapData(content, t)
      try {
        mindMapInstanceRef.current.setData(mindMapData.root || mindMapData)
      } catch (e) {
        console.error('Failed to set mind map data:', e)
      }
      return
    }

    if (initStartedRef.current) return
    pendingContentRef.current = content

    if (containerReadyRef.current) {
      doInitMindMap(content)
    }
  }, [content, doInitMindMap])

  useEffect(() => {
    if (!mindMapInstanceRef.current) return
    try {
      isInitialLoad.current = true
      mindMapInstanceRef.current.setTheme(isDark ? 'dark' : 'default')
      const bgSecondary = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim()
      if (bgSecondary) {
        ;(mindMapInstanceRef.current as any).setThemeConfig({ backgroundColor: bgSecondary })
      }
    } catch (e) {
      console.error('Failed to update mind map theme:', e)
    }
  }, [isDark])

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (mindMapInstanceRef.current && width > 0 && height > 0) {
          try {
            mindMapInstanceRef.current.resize()
          } catch (e) {
            console.error('Failed to resize MindMap:', e)
          }
        }
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  if (error) {
    return (
      <div
        className="flex-1 flex items-center justify-center p-8"
        style={{
          background: 'var(--bg-secondary)',
          color: 'var(--danger-color, #f44336)',
        }}
      >
        <div className="text-center">
          <p className="text-sm font-medium mb-2">{t('mindMap.loadFailed')}</p>
          <p className="text-xs opacity-70">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{
        background: 'var(--bg-secondary)',
      }}
    >
      {!loading && !error && (
        <MindMapToolbar mindMap={mindMapInstance} />
      )}
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{
            background: 'var(--bg-secondary)',
          }}
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
            <p className="text-xs opacity-50">{t('mindMap.loading')}</p>
          </div>
        </div>
      )}
      <MindMapContextMenu mindMap={mindMapInstance}>
        <div className="flex-1 relative" style={{ width: '100%', height: '100%', minHeight: '200px' }}>
          {/* Watermark layer - controlled by z-index via drawWatermark */}
          <svg
            ref={watermarkRef}
            className="absolute inset-0 pointer-events-none"
            style={{
              width: '100%',
              height: '100%',
            }}
          />
          {/* MindMap container - background must be transparent for watermark to show through */}
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'transparent',
            }}
          />
        </div>
      </MindMapContextMenu>
      {noteTooltip?.visible && (
        <div
          style={{
            position: 'fixed',
            left: noteTooltip.left,
            top: noteTooltip.top,
            padding: '10px',
            borderRadius: '5px',
            boxShadow: '0 2px 5px rgb(0 0 0 / 10%)',
            zIndex: 1000,
            maxWidth: '300px',
            wordBreak: 'break-word',
            lineHeight: 1.5,
            fontFamily: noteTooltip.fontFamily,
            fontSize: noteTooltip.fontSize + 'px',
            color: noteTooltip.color,
            background: isDark ? '#2a2a2a' : '#fff',
          }}
        >
          {noteTooltip.note}
        </div>
      )}
    </div>
  )
}
