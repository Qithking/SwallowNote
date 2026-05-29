/**
 * MindMap Editor Component using simple-mind-map
 *
 * Renders and edits .smm mind map files.
 * The file content is stored as JSON (simple-mind-map data format).
 *
 * IMPORTANT: We use the pre-bundled ESM dist file instead of the source
 * entry to avoid Vite having to process hundreds of sub-modules at dev time,
 * which can cause the app to freeze/hang on initial load.
 *
 * The dist file (simpleMindMap.esm.js) already includes all plugins
 * registered via chain calls, so we do NOT need to manually import and
 * register plugins.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useUIStore } from '@/stores'
import { MindMapToolbar } from './MindMapToolbar'

interface MindMapEditorProps {
  content: string
  onChange?: (content: string) => void
}

// Default mind map data structure
const DEFAULT_DATA = {
  root: {
    data: { text: '中心主题' },
    children: [],
  },
}

/**
 * Recursively ensure all nodes have a valid text field.
 * simple-mind-map's RichText plugin calls htmlEscape(data.text) without
 * null/undefined checks, so we must guarantee text is always a string.
 */
function ensureNodeTextValid(node: any): void {
  if (!node) return
  if (node.data) {
    if (node.data.text === undefined || node.data.text === null) {
      node.data.text = ''
    } else if (typeof node.data.text !== 'string') {
      node.data.text = String(node.data.text)
    }
    // Also fix generalization items which have their own .text field
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

/**
 * Parse content string into mind map data.
 * Returns default data if parsing fails.
 * Ensures all nodes have valid text fields to prevent htmlEscape crashes.
 */
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
  // Ensure every node has a valid text field to avoid:
  // TypeError: undefined is not an object (evaluating 'str.replace')
  // in simple-mind-map's htmlEscape() called from RichText plugin
  if (data?.root) {
    ensureNodeTextValid(data.root)
  }
  return data
}

export function MindMapEditor({ content, onChange }: MindMapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mindMapInstanceRef = useRef<any>(null)
  // Track whether the current data change was triggered by the editor itself
  // to avoid the infinite loop: data_change → onChange → content change → setData → data_change
  const isInternalUpdate = useRef(false)
  // Debounce timer for saving content
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the last saved content to avoid unnecessary saves
  const lastSavedContent = useRef<string>(content)
  const theme = useUIStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mindMapInstance, setMindMapInstance] = useState<any>(null)

  const isDark = theme === 'dark' || (theme === 'system' && systemDark)

  // Listen for system dark mode changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Debounced save function
  const scheduleSave = useCallback(() => {
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
          isInternalUpdate.current = true
          onChange(newContent)
          // Reset the flag after React state update has propagated
          requestAnimationFrame(() => {
            isInternalUpdate.current = false
          })
        }
      } catch (e) {
        console.error('Failed to get mind map data:', e)
      }
    }, 500)
  }, [onChange])

  // Initialize mind map instance lazily
  // We dynamically import the pre-bundled ESM dist file to avoid blocking
  // the main thread and to prevent Vite from processing source modules.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let destroyed = false

    const initMindMap = async () => {
      try {
        // Dynamically import the pre-bundled ESM dist file
        // This file already has all plugins registered
        const MindMapModule = await import(
          'simple-mind-map/dist/simpleMindMap.esm.js'
        )
        const MindMap = MindMapModule.default

        if (destroyed) return

        // Verify the container has dimensions
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          setError('容器尺寸无效，无法初始化思维导图')
          setLoading(false)
          return
        }

        console.log('MindMapEditor init - content:', content?.substring(0, 100))
        const mindMapData = parseMindMapData(content)
        console.log('MindMapEditor init - mindMapData:', mindMapData)
        lastSavedContent.current = content

        const mindMap = new MindMap({
          el,
          // Only pass the pure node tree (root), NOT the full object with
          // layout/theme. Those are separate config options.
          data: mindMapData.root || mindMapData,
          readonly: false,
          layout: mindMapData.layout || 'logicalStructure',
          theme: isDark ? 'dark' : 'default',
          fit: true,
          nodeTextEditZIndex: 1000,
          nodeNoteTooltipZIndex: 1000,
          expandBtnSize: 20,
          enableShortcutOnlyWhenMouseInSvg: false,
          mouseScaleCenterUseMousePosition: true,
        })

        if (destroyed) {
          mindMap.destroy()
          return
        }

        mindMapInstanceRef.current = mindMap
        console.log('MindMapEditor - setting mindMapInstance:', mindMap)
        setMindMapInstance(mindMap)
        setLoading(false)
        setError(null)

        // Listen for data changes with debounced save
        mindMap.on('data_change', scheduleSave)
      } catch (e) {
        console.error('Failed to initialize MindMap:', e)
        if (!destroyed) {
          setError(String(e))
          setLoading(false)
        }
      }
    }

    // Use requestAnimationFrame to ensure the container has been laid out
    // and has actual dimensions before initializing
    const rafId = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        initMindMap()
      } else {
        // If container still has no dimensions, observe until it does
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect
            if (width > 0 && height > 0) {
              observer.disconnect()
              initMindMap()
            }
          }
        })
        observer.observe(el)
      }
    })

    return () => {
      destroyed = true
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
      setMindMapInstance(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle external content changes (e.g., file reload from disk)
  // Skip if the change was triggered by our own editor
  useEffect(() => {
    if (isInternalUpdate.current) return
    if (!mindMapInstance) return
    // Don't re-set if content hasn't actually changed
    if (content === lastSavedContent.current) return

    const mindMapData = parseMindMapData(content)
    lastSavedContent.current = content
    try {
      // setData expects the node tree (root), not the full data object
      mindMapInstance.setData(mindMapData.root || mindMapData)
    } catch (e) {
      console.error('Failed to set mind map data:', e)
    }
  }, [content, mindMapInstance])

  // Update theme when it changes
  useEffect(() => {
    if (!mindMapInstanceRef.current) return
    try {
      mindMapInstanceRef.current.setTheme(isDark ? 'dark' : 'default')
    } catch (e) {
      console.error('Failed to update mind map theme:', e)
    }
  }, [isDark])

  // Handle resize
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
          background: isDark ? '#1a1a1a' : '#f5f5f5',
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
        background: isDark ? '#1a1a1a' : '#f5f5f5',
      }}
    >
      {!loading && !error && (
        <MindMapToolbar mindMap={mindMapInstance} />
      )}
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{
            background: isDark ? '#1a1a1a' : '#f5f5f5',
          }}
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
            <p className="text-xs opacity-50">加载思维导图...</p>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1"
        style={{
          width: '100%',
          height: '100%',
          // Ensure the container has a minimum size so simple-mind-map can initialize
          minHeight: '200px',
        }}
      />
    </div>
  )
}
