import { useEffect, useRef, useState, useCallback } from 'react'
import { useUIStore } from '@/stores'
import { MindMapToolbar } from './MindMapToolbar'
import { MindMapContextMenu } from './MindMapContextMenu'

interface MindMapEditorProps {
  content: string
  onChange?: (content: string) => void
}

const DEFAULT_DATA = {
  root: {
    data: { text: '中心主题' },
    children: [],
  },
}

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

function parseMindMapData(content: string) {
  let data: any
  if (!content || !content.trim()) {
    data = DEFAULT_DATA
  } else {
    try {
      const parsed = JSON.parse(content)
      if (parsed && parsed.root) {
        data = parsed
      } else if (parsed && parsed.data && parsed.data.text) {
        data = { root: parsed }
      } else {
        data = DEFAULT_DATA
      }
    } catch {
      data = DEFAULT_DATA
    }
  }
  if (data?.root) {
    ensureNodeTextValid(data.root)
  }
  return data
}

export function MindMapEditor({ content, onChange }: MindMapEditorProps) {
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

  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark

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
    if (initStartedRef.current) {
      console.log('[MindMapEditor] doInitMindMap skipped: already started')
      return
    }
    if (destroyedRef.current) {
      console.log('[MindMapEditor] doInitMindMap skipped: destroyed')
      return
    }

    console.log('[MindMapEditor] doInitMindMap starting, content length:', dataContent?.length)
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
        setError('容器尺寸无效，无法初始化思维导图')
        setLoading(false)
        return
      }

      const mindMapData = parseMindMapData(dataContent)
      lastSavedContent.current = dataContent

      const mindMap = new MindMap({
        el,
        data: mindMapData.root || mindMapData,
        readonly: false,
        layout: mindMapData.layout || 'logicalStructure',
        theme: isDarkRef.current ? 'dark' : 'default',
        fit: true,
        nodeTextEditZIndex: 1000,
        nodeNoteTooltipZIndex: 1000,
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
                  } catch (_e) {}
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
          } catch (_e) { orig() }
        }
      }

      mindMapReadyRef.current = true

      try {
        const initialData = mindMap.getData(true)
        lastSavedContent.current = JSON.stringify(initialData)
      } catch (e) {
        console.error('Failed to get initial mind map data:', e)
      }

      mindMap.on('data_change', scheduleSave)
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
        console.log('[MindMapEditor] container ready, pendingContent:', pc ? `length=${pc.length}` : 'null')
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
              console.log('[MindMapEditor] container ready (observer), pendingContent:', pc ? `length=${pc.length}` : 'null')
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
    if (!content || !content.trim()) {
      console.log('[MindMapEditor] content effect: content is empty, skipping')
      return
    }

    if (mindMapReadyRef.current) {
      if (content === lastLoadedContentRef.current) {
        console.log('[MindMapEditor] content effect: same content, skipping setData')
        return
      }

      console.log('[MindMapEditor] content effect: calling setData')
      isInitialLoad.current = true
      lastLoadedContentRef.current = content

      const mindMapData = parseMindMapData(content)
      try {
        mindMapInstanceRef.current.setData(mindMapData.root || mindMapData)
      } catch (e) {
        console.error('Failed to set mind map data:', e)
      }
      return
    }

    if (initStartedRef.current) {
      console.log('[MindMapEditor] content effect: init already started, skipping')
      return
    }

    console.log('[MindMapEditor] content effect: setting pendingContent and checking container')
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
          <p className="text-sm font-medium mb-2">思维导图加载失败</p>
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
            <p className="text-xs opacity-50">加载思维导图...</p>
          </div>
        </div>
      )}
      <MindMapContextMenu mindMap={mindMapInstance}>
        <div
          ref={containerRef}
          className="flex-1"
          style={{
            width: '100%',
            height: '100%',
            minHeight: '200px',
          }}
        />
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
