import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Droplets, Type, Palette, RotateCw, Space, Grid3X3, Layers, Download } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { ColorButton } from './ColorPicker'

interface WatermarkPluginProps {
  mindMap: any
  onClose: () => void
}

interface WatermarkConfig {
  enabled: boolean
  text: string
  color: string
  opacity: number
  fontSize: number
  rotate: number
  lineSpacing: number
  textSpacing: number
  showBelowNodes: boolean
  showOnExport: boolean
}

const DEFAULT_CONFIG: WatermarkConfig = {
  enabled: false,
  text: 'SwallowNote',
  color: '#999999',
  opacity: 0.15,
  fontSize: 14,
  rotate: -30,
  lineSpacing: 100,
  textSpacing: 100,
  showBelowNodes: false,
  showOnExport: false,
}

function Stepper({
  value,
  onChange,
  min = 0,
  max = 100,
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
        <span className="text-[10px]">−</span>
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="w-[40px] h-full text-center text-[10px] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        style={{ color: 'var(--text-primary)' }}
      />
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        className="w-[18px] h-full flex items-center justify-center transition-colors duration-100 hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
        style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-color)' }}
      >
        <span className="text-[10px]">+</span>
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

export function WatermarkPlugin({ mindMap, onClose }: WatermarkPluginProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<WatermarkConfig>(DEFAULT_CONFIG)

  // Load watermark config from mindMap
  useEffect(() => {
    if (!mindMap) return
    const savedConfig = mindMap.opt?.watermark || {}
    setConfig({
      ...DEFAULT_CONFIG,
      ...savedConfig,
    })
  }, [mindMap])

  const applyConfig = useCallback((newConfig: WatermarkConfig) => {
    if (!mindMap) return
    
    // Store config in mindMap options
    if (!mindMap.opt) mindMap.opt = {}
    mindMap.opt.watermark = newConfig
    
    // Directly trigger watermark redraw
    if (mindMap.drawWatermark) {
      mindMap.drawWatermark()
    }
    
    // Trigger data change event to save config
    mindMap.emit('data_change')
  }, [mindMap])

  const updateConfig = (key: keyof WatermarkConfig, value: any) => {
    const newConfig = { ...config, [key]: value }
    setConfig(newConfig)
    applyConfig(newConfig)
  }

  const sectionCls = "flex flex-col gap-1"

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
          {/* 启用开关 */}
          <div className={sectionCls}>
            <SectionLabel icon={Droplets} label={t('mindMap.watermark.title')} />
            <div className="flex items-center gap-2">
              <Switch
                checked={config.enabled}
                onCheckedChange={(v) => updateConfig('enabled', v)}
                className="scale-[0.55] origin-center"
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {config.enabled ? t('common.on') : t('common.off')}
              </span>
            </div>
          </div>

          <Divider />

          {/* 文字内容 */}
          <div className={sectionCls}>
            <SectionLabel icon={Type} label={t('mindMap.watermark.text')} />
            <Input
              value={config.text}
              onChange={(e) => updateConfig('text', e.target.value)}
              placeholder={t('mindMap.watermark.textPlaceholder')}
              disabled={!config.enabled}
              className="h-[22px] w-[100px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent disabled:opacity-50"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <Divider />

          {/* 颜色 */}
          <div className={sectionCls}>
            <SectionLabel icon={Palette} label={t('mindMap.watermark.color')} />
            <div className="flex items-center gap-2">
              <div className={`scale-[0.82] origin-left ${!config.enabled ? 'opacity-50' : ''}`}>
                <ColorButton 
                  value={config.color} 
                  onChange={(c) => updateConfig('color', c)} 
                  disabled={!config.enabled}
                />
              </div>
            </div>
          </div>

          <Divider />

          {/* 透明度 */}
          <div className={sectionCls}>
            <SectionLabel icon={Droplets} label={t('mindMap.watermark.opacity')} />
            <div className="flex items-center gap-2">
              <Stepper 
                value={Math.round(config.opacity * 100)} 
                onChange={(v) => updateConfig('opacity', v / 100)} 
                min={0} 
                max={100} 
                step={5}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>%</span>
            </div>
          </div>

          <Divider />

          {/* 字号 */}
          <div className={sectionCls}>
            <SectionLabel icon={Type} label={t('mindMap.watermark.fontSize')} />
            <div className="flex items-center gap-2">
              <Stepper 
                value={config.fontSize} 
                onChange={(v) => updateConfig('fontSize', v)} 
                min={8} 
                max={72} 
                step={1}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>px</span>
            </div>
          </div>

          <Divider />

          {/* 旋转角度 */}
          <div className={sectionCls}>
            <SectionLabel icon={RotateCw} label={t('mindMap.watermark.rotation')} />
            <div className="flex items-center gap-2">
              <Stepper 
                value={config.rotate} 
                onChange={(v) => updateConfig('rotate', v)} 
                min={-180} 
                max={180} 
                step={5}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>°</span>
            </div>
          </div>

          <Divider />

          {/* 行间距 */}
          <div className={sectionCls}>
            <SectionLabel icon={Space} label={t('mindMap.watermark.lineSpacing')} />
            <div className="flex items-center gap-2">
              <Stepper 
                value={config.lineSpacing} 
                onChange={(v) => updateConfig('lineSpacing', v)} 
                min={50} 
                max={300} 
                step={10}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>px</span>
            </div>
          </div>

          <Divider />

          {/* 文字间距 */}
          <div className={sectionCls}>
            <SectionLabel icon={Grid3X3} label={t('mindMap.watermark.letterSpacing')} />
            <div className="flex items-center gap-2">
              <Stepper 
                value={config.textSpacing} 
                onChange={(v) => updateConfig('textSpacing', v)} 
                min={50} 
                max={300} 
                step={10}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>px</span>
            </div>
          </div>

          <Divider />

          {/* 在节点下方显示 */}
          <div className={sectionCls}>
            <SectionLabel icon={Layers} label={t('mindMap.watermark.layer')} />
            <div className="flex items-center gap-2">
              <Switch
                checked={config.showBelowNodes}
                onCheckedChange={(v) => updateConfig('showBelowNodes', v)}
                disabled={!config.enabled}
                className="scale-[0.55] origin-center"
              />
              <span className="text-[10px]" style={{ color: config.enabled ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {config.showBelowNodes ? t('mindMap.toolbar.zoomOut') : t('mindMap.toolbar.zoomIn')}
              </span>
            </div>
          </div>

          <Divider />

          {/* 导出时显示 */}
          <div className={sectionCls}>
            <SectionLabel icon={Download} label={t('mindMap.watermark.export')} />
            <div className="flex items-center gap-2">
              <Switch
                checked={config.showOnExport}
                onCheckedChange={(v) => updateConfig('showOnExport', v)}
                disabled={!config.enabled}
                className="scale-[0.55] origin-center"
              />
              <span className="text-[10px]" style={{ color: config.enabled ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {config.showOnExport ? `${t('mindMap.watermark.export')} ${t('common.only')}` : t('common.show')}
              </span>
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
