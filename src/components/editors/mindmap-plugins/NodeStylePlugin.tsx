/**
 * Node Style Plugin for MindMap
 *
 * Controls selected node styles: border, background, shape, line, padding, image layout, tag layout
 * Similar to the "节点样式" panel in simple-mind-map official example
 */
import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { ColorButton } from './ColorPicker'

interface NodeStylePluginProps {
  mindMap: any // simple-mind-map instance
  onClose: () => void
}

interface NodeStyleConfig {
  border: {
    color: string
    style: 'solid' | 'dashed' | 'dotted' | 'none'
    width: number
    radius: number
  }
  background: {
    color: string
    gradient: boolean
  }
  shape: 'rectangle' | 'diamond' | 'parallelogram' | 'roundedRectangle' | 'circle' | 'ellipse'
  line: {
    color: string
    style: 'solid' | 'dashed' | 'dotted'
    width: number
    arrowPosition: 'start' | 'end' | 'both' | 'none'
  }
  padding: {
    horizontal: number
    vertical: number
  }
  image: {
    layout: 'top' | 'bottom' | 'left' | 'right'
  }
  tag: {
    layout: 'right' | 'bottom'
  }
}

const BORDER_STYLES = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'none', label: '无' },
]

const SHAPES = [
  { value: 'rectangle', label: '矩形' },
  { value: 'roundedRectangle', label: '圆角矩形' },
  { value: 'circle', label: '圆形' },
  { value: 'ellipse', label: '椭圆' },
  { value: 'diamond', label: '菱形' },
  { value: 'parallelogram', label: '平行四边形' },
]

const LINE_STYLES = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
]

const ARROW_POSITIONS = [
  { value: 'none', label: '无' },
  { value: 'start', label: '头部' },
  { value: 'end', label: '尾部' },
  { value: 'both', label: '两端' },
]

const IMAGE_LAYOUTS = [
  { value: 'top', label: '上' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
]

const TAG_LAYOUTS = [
  { value: 'right', label: '右' },
  { value: 'bottom', label: '下' },
]

export function NodeStylePlugin({ mindMap, onClose }: NodeStylePluginProps) {
  const [activeNodes, setActiveNodes] = useState<any[]>([])
  const [config, setConfig] = useState<NodeStyleConfig>({
    border: {
      color: '#549688',
      style: 'solid',
      width: 1,
      radius: 5,
    },
    background: {
      color: '#fff',
      gradient: false,
    },
    shape: 'rectangle',
    line: {
      color: '#549688',
      style: 'solid',
      width: 1,
      arrowPosition: 'none',
    },
    padding: {
      horizontal: 15,
      vertical: 5,
    },
    image: {
      layout: 'top',
    },
    tag: {
      layout: 'right',
    },
  })

  // Listen for active node changes
  useEffect(() => {
    if (!mindMap) return

    const handleNodeActive = (nodes: any[]) => {
      setActiveNodes(nodes || [])
      // Load node style if single node selected
      if (nodes && nodes.length === 1) {
        const node = nodes[0]
        const nodeData = node.getData() || {}
        const style = nodeData.style || {}
        
        setConfig({
          border: {
            color: style.borderColor || '#549688',
            style: style.borderStyle || 'solid',
            width: style.borderWidth || 1,
            radius: style.borderRadius || 5,
          },
          background: {
            color: style.fillColor || '#fff',
            gradient: style.gradient || false,
          },
          shape: style.shape || 'rectangle',
          line: {
            color: style.lineColor || '#549688',
            style: style.lineStyle || 'solid',
            width: style.lineWidth || 1,
            arrowPosition: style.arrowPosition || 'none',
          },
          padding: {
            horizontal: style.paddingX || 15,
            vertical: style.paddingY || 5,
          },
          image: {
            layout: style.imageLayout || 'top',
          },
          tag: {
            layout: style.tagLayout || 'right',
          },
        })
      }
    }

    mindMap.on('node_active', handleNodeActive)
    return () => {
      mindMap.off('node_active', handleNodeActive)
    }
  }, [mindMap])

  // Apply style to selected nodes
  const applyStyle = useCallback((newConfig: NodeStyleConfig) => {
    if (!mindMap || activeNodes.length === 0) return
    
    activeNodes.forEach((node) => {
      mindMap.execCommand('SET_NODE_STYLE', node, {
        borderColor: newConfig.border.color,
        borderStyle: newConfig.border.style,
        borderWidth: newConfig.border.width,
        borderRadius: newConfig.border.radius,
        fillColor: newConfig.background.color,
        gradient: newConfig.background.gradient,
        shape: newConfig.shape,
        lineColor: newConfig.line.color,
        lineStyle: newConfig.line.style,
        lineWidth: newConfig.line.width,
        arrowPosition: newConfig.line.arrowPosition,
        paddingX: newConfig.padding.horizontal,
        paddingY: newConfig.padding.vertical,
        imageLayout: newConfig.image.layout,
        tagLayout: newConfig.tag.layout,
      })
    })
  }, [mindMap, activeNodes])

  const updateConfig = (path: string, value: any) => {
    const newConfig = { ...config }
    const keys = path.split('.')
    let target: any = newConfig
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]]
    }
    target[keys[keys.length - 1]] = value
    setConfig(newConfig)
    applyStyle(newConfig)
  }

  const hasSelection = activeNodes.length > 0
  const isRootNode = hasSelection && activeNodes[0]?.isRoot

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[400px] max-h-[80vh] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">节点样式</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          >
            <X size={16} />
          </button>
        </div>

        {!hasSelection ? (
          <div className="p-8 text-center text-sm text-[var(--text-secondary)]">
            请先选择一个节点
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {/* Border Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">边框</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">颜色</span>
                    <ColorButton
                      value={config.border.color}
                      onChange={(color) => updateConfig('border.color', color)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">样式</span>
                    <select
                      value={config.border.style}
                      onChange={(e) => updateConfig('border.style', e.target.value)}
                      className="px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    >
                      {BORDER_STYLES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">宽度</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={config.border.width}
                      onChange={(e) => updateConfig('border.width', parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">圆角</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={config.border.radius}
                      onChange={(e) => updateConfig('border.radius', parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Background Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">背景</h4>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">颜色</span>
                  <ColorButton
                    value={config.background.color}
                    onChange={(color) => updateConfig('background.color', color)}
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.background.gradient}
                    onChange={(e) => updateConfig('background.gradient', e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-color)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)]">渐变</span>
                </label>
              </div>
            </section>

            {/* Shape Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">形状</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">形状</span>
                <select
                  value={config.shape}
                  onChange={(e) => updateConfig('shape', e.target.value)}
                  className="px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                >
                  {SHAPES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </section>

            {/* Line Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">线条</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">颜色</span>
                    <ColorButton
                      value={config.line.color}
                      onChange={(color) => updateConfig('line.color', color)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">样式</span>
                    <select
                      value={config.line.style}
                      onChange={(e) => updateConfig('line.style', e.target.value)}
                      className="px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    >
                      {LINE_STYLES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">宽度</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={config.line.width}
                      onChange={(e) => updateConfig('line.width', parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">箭头位置</span>
                    <select
                      value={config.line.arrowPosition}
                      onChange={(e) => updateConfig('line.arrowPosition', e.target.value)}
                      className="px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                    >
                      {ARROW_POSITIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* Padding Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">节点内边距</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="text-xs text-[var(--text-secondary)] w-8">水平</span>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={config.padding.horizontal}
                    onChange={(e) => updateConfig('padding.horizontal', parseInt(e.target.value))}
                    className="flex-1 h-1 bg-[var(--bg-secondary)] rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs text-[var(--text-secondary)] w-8 text-right">
                    {config.padding.horizontal}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-[var(--text-secondary)] w-8">垂直</span>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={config.padding.vertical}
                    onChange={(e) => updateConfig('padding.vertical', parseInt(e.target.value))}
                    className="flex-1 h-1 bg-[var(--bg-secondary)] rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs text-[var(--text-secondary)] w-8 text-right">
                    {config.padding.vertical}
                  </span>
                </div>
              </div>
            </section>

            {/* Image Layout Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">图片</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">布局</span>
                <div className="flex rounded border border-[var(--border-color)] overflow-hidden">
                  {IMAGE_LAYOUTS.map((layout) => (
                    <button
                      key={layout.value}
                      onClick={() => updateConfig('image.layout', layout.value)}
                      className={`
                        px-3 py-1 text-xs transition-colors
                        ${config.image.layout === layout.value
                          ? 'bg-[var(--theme-color)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                        }
                      `}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Tag Layout Section */}
            <section>
              <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">标签</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">布局</span>
                <div className="flex rounded border border-[var(--border-color)] overflow-hidden">
                  {TAG_LAYOUTS.map((layout) => (
                    <button
                      key={layout.value}
                      onClick={() => updateConfig('tag.layout', layout.value)}
                      className={`
                        px-3 py-1 text-xs transition-colors
                        ${config.tag.layout === layout.value
                          ? 'bg-[var(--theme-color)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                        }
                      `}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
