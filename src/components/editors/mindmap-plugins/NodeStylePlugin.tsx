import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Minus, Plus, Square, Paintbrush, Shapes, Spline, BoxSelect, Image, Tag } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorButton } from './ColorPicker'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

interface NodeStylePluginProps {
  mindMap: any
  onClose: () => void
}

interface NodeStyleConfig {
  border: {
    color: string
    dasharray: string
    width: number
    radius: number
  }
  background: {
    color: string
    gradient: boolean
    gradientStart?: string
    gradientEnd?: string
    gradientDirection?: 'to right' | 'to left' | 'to bottom' | 'to top' | 'to bottom right' | 'to bottom left'
  }
  shape: string
  line: {
    color: string
    dasharray: string
    width: number
    markerDir: 'start' | 'end' | 'none'
  }
  padding: {
    horizontal: number
    vertical: number
  }
  image: {
    placement: 'top' | 'bottom' | 'left' | 'right'
  }
  tag: {
    placement: 'right' | 'bottom'
  }
}

const BORDER_STYLES = [
  { value: 'none', label: '实线' },
  { value: '5,5', label: '虚线' },
  { value: '2,2', label: '点线' },
  { value: 'none_border', label: '无' },
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
  { value: 'none', label: '实线' },
  { value: '5,5', label: '虚线' },
  { value: '2,2', label: '点线' },
]

const ARROW_POSITIONS = [
  { value: 'none', label: '无' },
  { value: 'start', label: '头部' },
  { value: 'end', label: '尾部' },
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

const GRADIENT_DIRECTIONS = [
  { value: 'to right', label: '向右' },
  { value: 'to left', label: '向左' },
  { value: 'to bottom', label: '向下' },
  { value: 'to top', label: '向上' },
  { value: 'to bottom right', label: '右下' },
  { value: 'to bottom left', label: '左下' },
  { value: 'to top right', label: '右上' },
  { value: 'to top left', label: '左上' },
]

const DIRECTION_MAP: Record<string, { startDir: [number, number]; endDir: [number, number] }> = {
  'to right': { startDir: [0, 0.5], endDir: [1, 0.5] },
  'to left': { startDir: [1, 0.5], endDir: [0, 0.5] },
  'to bottom': { startDir: [0.5, 0], endDir: [0.5, 1] },
  'to top': { startDir: [0.5, 1], endDir: [0.5, 0] },
  'to bottom right': { startDir: [0, 0], endDir: [1, 1] },
  'to bottom left': { startDir: [1, 0], endDir: [0, 1] },
  'to top right': { startDir: [0, 1], endDir: [1, 0] },
  'to top left': { startDir: [1, 1], endDir: [0, 0] },
}

function coordsToDirection(startDir?: number[], endDir?: number[]): NodeStyleConfig['background']['gradientDirection'] {
  if (!startDir || !endDir) return 'to right'
  for (const [dir, coords] of Object.entries(DIRECTION_MAP)) {
    if (coords.startDir[0] === startDir[0] && coords.startDir[1] === startDir[1] &&
        coords.endDir[0] === endDir[0] && coords.endDir[1] === endDir[1]) {
      return dir as NodeStyleConfig['background']['gradientDirection']
    }
  }
  return 'to right'
}

function Stepper({
  value,
  onChange,
  min = 0,
  max = 20,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div
      className="flex items-center h-[22px] rounded-[3px] overflow-hidden"
      style={{ border: '1px solid var(--border-color)' }}
    >
      <button
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        className="w-[18px] h-full flex items-center justify-center transition-colors duration-100 hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
        style={{ color: 'var(--text-tertiary)', borderRight: '1px solid var(--border-color)' }}
      >
        <Minus size={10} strokeWidth={2.5} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="w-[26px] h-full text-center text-[10px] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        style={{ color: 'var(--text-primary)' }}
      />
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        className="w-[18px] h-full flex items-center justify-center transition-colors duration-100 hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
        style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-color)' }}
      >
        <Plus size={10} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1 select-none shrink-0">
      <Icon size={11} style={{ color: 'var(--text-tertiary)' }} strokeWidth={1.8} />
      <span className="text-[10px] font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
    </div>
  )
}

function Divider() {
  return (
    <div className="w-px self-stretch mx-2 opacity-30" style={{ backgroundColor: 'var(--border-color)' }} />
  )
}

function GradientPicker({
  startColor,
  endColor,
  direction,
  onChange,
}: {
  startColor: string
  endColor: string
  direction: NodeStyleConfig['background']['gradientDirection']
  onChange: (start: string, end: string, dir: NodeStyleConfig['background']['gradientDirection']) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [open])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="w-[28px] h-[22px] rounded-[4px] cursor-pointer transition-all duration-150 hover:shadow-[0_0_0_1.5px_var(--theme-color)] hover:scale-105 border"
        style={{
          background: `linear-gradient(${direction || 'to right'}, ${startColor}, ${endColor})`,
          borderColor: 'rgba(0,0,0,0.12)',
        }}
      />
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] rounded-lg shadow-lg p-3 flex flex-col gap-2.5 min-w-[180px]"
          style={{
            top: pos.top,
            left: pos.left,
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>开始</span>
            <input
              type="color"
              value={startColor}
              onChange={(e) => onChange(e.target.value, endColor, direction)}
              className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
            />
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{startColor}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>结束</span>
            <input
              type="color"
              value={endColor}
              onChange={(e) => onChange(startColor, e.target.value, direction)}
              className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
            />
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{endColor}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>方向</span>
            <select
              value={direction ?? 'to right'}
              onChange={(e) => {
                const dir = e.target.value as NodeStyleConfig['background']['gradientDirection']
                onChange(startColor, endColor, dir)
              }}
              className="h-[22px] w-[72px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent px-1 outline-none cursor-pointer"
              style={{ color: 'var(--text-primary)' }}
            >
              {GRADIENT_DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
          <div
            className="w-full h-[20px] rounded-[3px]"
            style={{ background: `linear-gradient(${direction || 'to right'}, ${startColor}, ${endColor})` }}
          />
        </div>,
        document.body
      )}
    </>
  )
}

export function NodeStylePlugin({ mindMap, onClose }: NodeStylePluginProps) {
  const [activeNodes, setActiveNodes] = useState<any[]>([])
  const activeNodesRef = useRef<any[]>([])

  useEffect(() => {
    activeNodesRef.current = activeNodes
  }, [activeNodes])

  const [config, setConfig] = useState<NodeStyleConfig>({
    border: {
      color: '#549688',
      dasharray: 'none',
      width: 1,
      radius: 5,
    },
    background: {
      color: '#fff',
      gradient: false,
      gradientStart: '#549688',
      gradientEnd: '#e8a87c',
      gradientDirection: 'to right' as const,
    },
    shape: 'rectangle',
    line: {
      color: '#549688',
      dasharray: 'none',
      width: 1,
      markerDir: 'none',
    },
    padding: {
      horizontal: 15,
      vertical: 5,
    },
    image: {
      placement: 'top',
    },
    tag: {
      placement: 'right',
    },
  })

  const readNodeConfig = useCallback((activeNodeList: any[]) => {
    if (activeNodeList && activeNodeList.length === 1) {
      const selectedNode = activeNodeList[0]
      const data = selectedNode.getData() || {}

      setConfig({
        border: {
          color: data.borderColor || '#549688',
          dasharray: data.borderDasharray || 'none',
          width: data.borderWidth || 1,
          radius: data.borderRadius || 5,
        },
        background: {
          color: data.fillColor || '#fff',
          gradient: !!data.gradientStyle,
          gradientStart: data.startColor || '#549688',
          gradientEnd: data.endColor || '#e8a87c',
          gradientDirection: coordsToDirection(data.startDir, data.endDir),
        },
        shape: data.shape || 'rectangle',
        line: {
          color: data.lineColor || '#549688',
          dasharray: data.lineDasharray || 'none',
          width: data.lineWidth || 1,
          markerDir: data.lineMarkerDir || 'none',
        },
        padding: {
          horizontal: data.paddingX || 15,
          vertical: data.paddingY || 5,
        },
        image: {
          placement: data.imgPlacement || 'top',
        },
        tag: {
          placement: data.tagPlacement || 'right',
        },
      })
    }
  }, [])

  useEffect(() => {
    if (!mindMap) return

    const handleNodeActive = (_node: any, activeNodeList: any[]) => {
      setActiveNodes(activeNodeList || [])
      readNodeConfig(activeNodeList || [])
    }

    mindMap.on('node_active', handleNodeActive)

    const currentActiveNodes = mindMap.renderer?.activeNodeList || []
    if (currentActiveNodes.length > 0) {
      setActiveNodes(currentActiveNodes)
      readNodeConfig(currentActiveNodes)
    }

    return () => {
      mindMap.off('node_active', handleNodeActive)
    }
  }, [mindMap, readNodeConfig])

  const applyStyle = useCallback((newConfig: NodeStyleConfig) => {
    if (!mindMap || activeNodesRef.current.length === 0) return

    const dir = newConfig.background.gradientDirection || 'to right'
    const dirCoords = DIRECTION_MAP[dir] || DIRECTION_MAP['to right']

    activeNodesRef.current.forEach((node) => {
      mindMap.execCommand('SET_NODE_STYLES', node, {
        borderColor: newConfig.border.color,
        borderDasharray: newConfig.border.dasharray,
        borderWidth: newConfig.border.width,
        borderRadius: newConfig.border.radius,
        fillColor: newConfig.background.color,
        gradientStyle: newConfig.background.gradient,
        startColor: newConfig.background.gradientStart,
        endColor: newConfig.background.gradientEnd,
        startDir: dirCoords.startDir,
        endDir: dirCoords.endDir,
        shape: newConfig.shape,
        lineColor: newConfig.line.color,
        lineDasharray: newConfig.line.dasharray,
        lineWidth: newConfig.line.width,
        lineMarkerDir: newConfig.line.markerDir,
        paddingX: newConfig.padding.horizontal,
        paddingY: newConfig.padding.vertical,
        imgPlacement: newConfig.image.placement,
        tagPlacement: newConfig.tag.placement,
      })
    })
  }, [mindMap])

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
  const sectionCls = "flex flex-col gap-1"

  if (!hasSelection) {
    return (
      <div
        className="border-b bg-[var(--bg-secondary)] px-4 py-2 flex items-center justify-between"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>请先选择节点</span>
        <button
          onClick={onClose}
          className="p-1 rounded-[3px] transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="border-b bg-[var(--bg-secondary)]"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <ScrollArea className="w-full" onWheel={(e) => {
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
          const viewport = (e.currentTarget as HTMLElement).querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
          if (viewport) {
            e.preventDefault()
            viewport.scrollLeft += e.deltaY
          }
        }
      }}>
        <div className="flex items-stretch px-3 py-1.5 gap-0 min-w-max">
          {/* 边框 */}
          <div className={sectionCls}>
            <SectionLabel icon={Square} label="边框" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>颜色</span>
              <div className="scale-[0.82] origin-left"><ColorButton value={config.border.color} onChange={(c) => updateConfig('border.color', c)} /></div>
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>样式</span>
              <Select value={config.border.dasharray} onValueChange={(v) => updateConfig('border.dasharray', v)}>
                <SelectTrigger className="h-[22px] w-[64px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BORDER_STYLES.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>宽度</span>
              <Stepper value={config.border.width} onChange={(v) => updateConfig('border.width', v)} min={0} max={10} />
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>圆角</span>
              <Stepper value={config.border.radius} onChange={(v) => updateConfig('border.radius', v)} min={0} max={50} />
            </div>
          </div>

          <Divider />

          {/* 背景 */}
          <div className={sectionCls}>
            <SectionLabel icon={Paintbrush} label="背景" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>颜色</span>
              <div className="scale-[0.82] origin-left"><ColorButton value={config.background.color} onChange={(c) => updateConfig('background.color', c)} /></div>
            </div>
            <div className="flex items-center gap-2 relative">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>渐变色</span>
              <Switch checked={config.background.gradient} onCheckedChange={(v) => updateConfig('background.gradient', v)} className="scale-[0.55] origin-center" />
              {config.background.gradient && (
                <GradientPicker
                  startColor={config.background.gradientStart || '#549688'}
                  endColor={config.background.gradientEnd || '#e8a87c'}
                  direction={config.background.gradientDirection || 'to right'}
                  onChange={(start, end, dir) => {
                    const newConfig = { ...config, background: { ...config.background, gradientStart: start, gradientEnd: end, gradientDirection: dir } }
                    setConfig(newConfig)
                    applyStyle(newConfig)
                  }}
                />
              )}
            </div>
          </div>

          <Divider />

          {/* 形状 */}
          <div className={sectionCls}>
            <SectionLabel icon={Shapes} label="形状" />
            <div className="flex items-center gap-2">
              <Select value={config.shape} onValueChange={(v) => updateConfig('shape', v)}>
                <SelectTrigger className="h-[22px] w-[80px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHAPES.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Divider />

          {/* 线条 */}
          <div className={sectionCls}>
            <SectionLabel icon={Spline} label="线条" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>颜色</span>
              <div className="scale-[0.82] origin-left"><ColorButton value={config.line.color} onChange={(c) => updateConfig('line.color', c)} /></div>
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>样式</span>
              <Select value={config.line.dasharray} onValueChange={(v) => updateConfig('line.dasharray', v)}>
                <SelectTrigger className="h-[22px] w-[64px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINE_STYLES.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>宽度</span>
              <Stepper value={config.line.width} onChange={(v) => updateConfig('line.width', v)} min={1} max={10} />
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>箭头</span>
              <Select value={config.line.markerDir} onValueChange={(v) => updateConfig('line.markerDir', v)}>
                <SelectTrigger className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARROW_POSITIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Divider />

          {/* 节点内边距 */}
          <div className={sectionCls}>
            <SectionLabel icon={BoxSelect} label="节点内边距" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>水平</span>
              <Stepper value={config.padding.horizontal} onChange={(v) => updateConfig('padding.horizontal', v)} min={0} max={50} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>垂直</span>
              <Stepper value={config.padding.vertical} onChange={(v) => updateConfig('padding.vertical', v)} min={0} max={50} />
            </div>
          </div>

          <Divider />

          {/* 图片 */}
          <div className={sectionCls}>
            <SectionLabel icon={Image} label="图片" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>布局</span>
              <Select value={config.image.placement} onValueChange={(v) => updateConfig('image.placement', v)}>
                <SelectTrigger className="h-[22px] w-[48px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_LAYOUTS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Divider />

          {/* 标签 */}
          <div className={sectionCls}>
            <SectionLabel icon={Tag} label="标签" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>布局</span>
              <Select value={config.tag.placement} onValueChange={(v) => updateConfig('tag.placement', v)}>
                <SelectTrigger className="h-[22px] w-[48px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent" style={{ color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAG_LAYOUTS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 关闭 */}
          <button
            onClick={onClose}
            className="ml-auto self-start p-1 rounded-[3px] transition-colors duration-100 hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={14} />
          </button>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}
