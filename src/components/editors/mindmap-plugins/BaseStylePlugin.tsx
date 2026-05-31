import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Palette, Minus, Plus, Spline, GitBranch, Link, BoxSelect, Square, Crown, Binary, Layers, Braces } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorSwatch, ColorButton } from './ColorPicker'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

interface BaseStylePluginProps {
  mindMap: any
  onClose: () => void
}

interface NodeTextStyleConfig {
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: string
  fontStyle: string
  textDecoration: string
}

interface BaseStyleConfig {
  backgroundColor: string
  backgroundImage: string
  line: {
    color: string
    width: number
    style: 'straight' | 'curve' | 'direct'
    radius: number
    showArrow: boolean
  }
  rainbowLines: boolean
  generalizationLine: {
    color: string
    width: number
  }
  associativeLine: {
    color: string
    width: number
    activeColor: string
    activeWidth: number
    dasharray: string
  }
  padding: {
    horizontal: number
    vertical: number
  }
  outerFramePadding: {
    horizontal: number
    vertical: number
  }
  root: NodeTextStyleConfig
  second: NodeTextStyleConfig
  node: NodeTextStyleConfig
  generalization: NodeTextStyleConfig
}

const LINE_STYLES = [
  { value: 'straight', label: '直线' },
  { value: 'curve', label: '曲线' },
  { value: 'direct', label: '直连' },
]

const DASHARRAY_OPTIONS = [
  { value: 'none', label: '实线' },
  { value: '5,5', label: '虚线' },
  { value: '10,10', label: '长虚线' },
  { value: '5,10', label: '点线' },
]

const FONT_FAMILY_OPTIONS = [
  { value: '微软雅黑, Microsoft YaHei', label: '微软雅黑' },
  { value: '宋体, SimSun', label: '宋体' },
  { value: '黑体, SimHei', label: '黑体' },
  { value: '楷体, KaiTi', label: '楷体' },
  { value: '仿宋, FangSong', label: '仿宋' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Times New Roman, Times, serif', label: 'Times' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Courier New, Courier, monospace', label: 'Courier' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
]

const FONT_WEIGHT_OPTIONS = [
  { value: 'normal', label: '常规' },
  { value: 'bold', label: '粗体' },
  { value: 'lighter', label: '细体' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '300', label: '300' },
  { value: '400', label: '400' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700' },
  { value: '800', label: '800' },
  { value: '900', label: '900' },
]

const FONT_STYLE_OPTIONS = [
  { value: 'normal', label: '正常' },
  { value: 'italic', label: '斜体' },
]

const TEXT_DECORATION_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'underline', label: '下划线' },
  { value: 'line-through', label: '删除线' },
  { value: 'overline', label: '上划线' },
]

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

export function BaseStylePlugin({ mindMap, onClose }: BaseStylePluginProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<BaseStyleConfig>({
    backgroundColor: '#fafafa',
    backgroundImage: '',
    line: {
      color: '#549688',
      width: 1,
      style: 'straight',
      radius: 5,
      showArrow: false,
    },
    rainbowLines: false,
    generalizationLine: {
      color: '#549688',
      width: 1,
    },
    associativeLine: {
      color: 'rgb(51, 51, 51)',
      width: 2,
      activeColor: 'rgba(2, 167, 240, 1)',
      activeWidth: 8,
      dasharray: 'none',
    },
    padding: {
      horizontal: 15,
      vertical: 5,
    },
    outerFramePadding: {
      horizontal: 10,
      vertical: 10,
    },
    root: {
      color: '#fff',
      fontFamily: '微软雅黑, Microsoft YaHei',
      fontSize: 16,
      fontWeight: 'bold',
      fontStyle: 'normal',
      textDecoration: 'none',
    },
    second: {
      color: '#565656',
      fontFamily: '微软雅黑, Microsoft YaHei',
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
    },
    node: {
      color: '#6a6d6c',
      fontFamily: '微软雅黑, Microsoft YaHei',
      fontSize: 14,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
    },
    generalization: {
      color: '#565656',
      fontFamily: '微软雅黑, Microsoft YaHei',
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
    },
  })

  useEffect(() => {
    if (!mindMap) return
    const themeConfig = mindMap.getThemeConfig()
    const rootTheme = themeConfig.root || {}
    const secondTheme = themeConfig.second || {}
    const nodeTheme = themeConfig.node || {}
    const generalizationTheme = themeConfig.generalization || {}
    setConfig({
      backgroundColor: themeConfig.backgroundColor || '#fafafa',
      backgroundImage: themeConfig.backgroundImage || '',
      line: {
        color: themeConfig.lineColor || '#549688',
        width: themeConfig.lineWidth || 1,
        style: themeConfig.lineStyle || 'straight',
        radius: themeConfig.lineRadius || 5,
        showArrow: themeConfig.showLineMarker || false,
      },
      rainbowLines: themeConfig.rainbowLines || false,
      generalizationLine: {
        color: themeConfig.generalizationLineColor || '#549688',
        width: themeConfig.generalizationLineWidth || 1,
      },
      associativeLine: {
        color: themeConfig.associativeLineColor || 'rgb(51, 51, 51)',
        width: themeConfig.associativeLineWidth || 2,
        activeColor: themeConfig.associativeLineActiveColor || 'rgba(2, 167, 240, 1)',
        activeWidth: themeConfig.associativeLineActiveWidth || 8,
        dasharray: themeConfig.associativeLineDasharray || 'none',
      },
      padding: {
        horizontal: themeConfig.paddingX || 15,
        vertical: themeConfig.paddingY || 5,
      },
      outerFramePadding: {
        horizontal: mindMap.opt?.outerFramePaddingX ?? 10,
        vertical: mindMap.opt?.outerFramePaddingY ?? 10,
      },
      root: {
        color: rootTheme.color || '#fff',
        fontFamily: rootTheme.fontFamily || '微软雅黑, Microsoft YaHei',
        fontSize: rootTheme.fontSize || 16,
        fontWeight: rootTheme.fontWeight || 'bold',
        fontStyle: rootTheme.fontStyle || 'normal',
        textDecoration: rootTheme.textDecoration || 'none',
      },
      second: {
        color: secondTheme.color || '#565656',
        fontFamily: secondTheme.fontFamily || '微软雅黑, Microsoft YaHei',
        fontSize: secondTheme.fontSize || 16,
        fontWeight: secondTheme.fontWeight || 'normal',
        fontStyle: secondTheme.fontStyle || 'normal',
        textDecoration: secondTheme.textDecoration || 'none',
      },
      node: {
        color: nodeTheme.color || '#6a6d6c',
        fontFamily: nodeTheme.fontFamily || '微软雅黑, Microsoft YaHei',
        fontSize: nodeTheme.fontSize || 14,
        fontWeight: nodeTheme.fontWeight || 'normal',
        fontStyle: nodeTheme.fontStyle || 'normal',
        textDecoration: nodeTheme.textDecoration || 'none',
      },
      generalization: {
        color: generalizationTheme.color || '#565656',
        fontFamily: generalizationTheme.fontFamily || '微软雅黑, Microsoft YaHei',
        fontSize: generalizationTheme.fontSize || 16,
        fontWeight: generalizationTheme.fontWeight || 'normal',
        fontStyle: generalizationTheme.fontStyle || 'normal',
        textDecoration: generalizationTheme.textDecoration || 'none',
      },
    })
  }, [mindMap])

  const applyConfig = useCallback((newConfig: BaseStyleConfig) => {
    if (!mindMap) return
    mindMap.setThemeConfig({
      backgroundColor: newConfig.backgroundColor,
      backgroundImage: newConfig.backgroundImage,
      lineColor: newConfig.line.color,
      lineWidth: newConfig.line.width,
      lineStyle: newConfig.line.style,
      lineRadius: newConfig.line.radius,
      showLineMarker: newConfig.line.showArrow,
      rainbowLines: newConfig.rainbowLines,
      generalizationLineColor: newConfig.generalizationLine.color,
      generalizationLineWidth: newConfig.generalizationLine.width,
      associativeLineColor: newConfig.associativeLine.color,
      associativeLineWidth: newConfig.associativeLine.width,
      associativeLineActiveColor: newConfig.associativeLine.activeColor,
      associativeLineActiveWidth: newConfig.associativeLine.activeWidth,
      associativeLineDasharray: newConfig.associativeLine.dasharray,
      paddingX: newConfig.padding.horizontal,
      paddingY: newConfig.padding.vertical,
      root: {
        color: newConfig.root.color,
        fontFamily: newConfig.root.fontFamily,
        fontSize: newConfig.root.fontSize,
        fontWeight: newConfig.root.fontWeight,
        fontStyle: newConfig.root.fontStyle,
        textDecoration: newConfig.root.textDecoration,
      },
      second: {
        color: newConfig.second.color,
        fontFamily: newConfig.second.fontFamily,
        fontSize: newConfig.second.fontSize,
        fontWeight: newConfig.second.fontWeight,
        fontStyle: newConfig.second.fontStyle,
        textDecoration: newConfig.second.textDecoration,
      },
      node: {
        color: newConfig.node.color,
        fontFamily: newConfig.node.fontFamily,
        fontSize: newConfig.node.fontSize,
        fontWeight: newConfig.node.fontWeight,
        fontStyle: newConfig.node.fontStyle,
        textDecoration: newConfig.node.textDecoration,
      },
      generalization: {
        color: newConfig.generalization.color,
        fontFamily: newConfig.generalization.fontFamily,
        fontSize: newConfig.generalization.fontSize,
        fontWeight: newConfig.generalization.fontWeight,
        fontStyle: newConfig.generalization.fontStyle,
        textDecoration: newConfig.generalization.textDecoration,
      },
    })
    if (mindMap.opt) {
      mindMap.opt.outerFramePaddingX = newConfig.outerFramePadding.horizontal
      mindMap.opt.outerFramePaddingY = newConfig.outerFramePadding.vertical
    }
  }, [mindMap])

  const updateConfig = (path: string, value: any) => {
    const keys = path.split('.')
    const newConfig = { ...config }
    let target: any = newConfig
    for (let i = 0; i < keys.length - 1; i++) {
      target[keys[i]] = { ...target[keys[i]] }
      target = target[keys[i]]
    }
    target[keys[keys.length - 1]] = value
    setConfig(newConfig)
    applyConfig(newConfig)
  }

  const sectionCls = "flex flex-col gap-1"

  const BG_PRESETS = [
    '#fff8e1', '#fff3e0', '#fce4ec', '#e8f5e9', '#e3f2fd',
    '#ede7f6', '#ffe0b2', '#d7ccc8', '#cfd8dc', '#b2dfdb',
  ]

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
        {/* 背景 */}
        <div className={sectionCls}>
          <SectionLabel icon={Palette} label={t('mindMap.style.background')} />
          <div className="flex items-center gap-2">
            <ColorSwatch
              value={config.backgroundColor}
              onChange={(c) => updateConfig('backgroundColor', c)}
              size={22}
              showHex
            />
          </div>
          <div className="grid grid-cols-5 gap-[3px] mt-0.5">
            {BG_PRESETS.map((color) => (
              <button
                key={color}
                onClick={() => updateConfig('backgroundColor', color)}
                className="w-[15px] h-[15px] rounded-[2px] transition-all duration-100 hover:scale-110 hover:shadow-sm"
                style={{
                  backgroundColor: color,
                  border: config.backgroundColor === color ? '1.5px solid var(--theme-color)' : '1px solid rgba(0,0,0,0.12)',
                  boxShadow: config.backgroundColor === color ? '0 0 0 1px var(--theme-color), inset 0 0 0 1px rgba(0,0,0,0.06)' : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                }}
              />
            ))}
          </div>
        </div>

        <Divider />

        {/* 基础连线 */}
        <div className={sectionCls}>
          <SectionLabel icon={Spline} label={t('mindMap.style.connection')} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.line.color} onChange={(c) => updateConfig('line.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Stepper value={config.line.width} onChange={(v) => updateConfig('line.width', v)} min={1} max={10} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomIn')}</span>
            <Switch
              checked={config.line.showArrow}
              onCheckedChange={(v) => updateConfig('line.showArrow', v)}
              className="scale-[0.55] origin-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.layout')}</span>
            <Select value={config.line.style} onValueChange={(v) => updateConfig('line.style', v)}>
              <SelectTrigger
                className="h-[22px] w-[64px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>圆角</span>
            <Stepper value={config.line.radius} onChange={(v) => updateConfig('line.radius', v)} min={0} max={20} />
          </div>
        </div>

        <Divider />

        {/* 概要连线 */}
        <div className={sectionCls}>
          <SectionLabel icon={GitBranch} label={`${t('mindMap.style.connection')} ${t('mindMap.toolbar.summary')}`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left">
              <ColorButton value={config.generalizationLine.color} onChange={(c) => updateConfig('generalizationLine.color', c)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Stepper value={config.generalizationLine.width} onChange={(v) => updateConfig('generalizationLine.width', v)} min={1} max={10} />
          </div>
        </div>

        <Divider />

        {/* 关联线 */}
        <div className={sectionCls}>
          <SectionLabel icon={Link} label={t('mindMap.dialog.hyperlink')} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.associativeLine.color} onChange={(c) => updateConfig('associativeLine.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Stepper value={config.associativeLine.width} onChange={(v) => updateConfig('associativeLine.width', v)} min={1} max={10} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.layout')}</span>
            <Select value={config.associativeLine.dasharray} onValueChange={(v) => updateConfig('associativeLine.dasharray', v)}>
              <SelectTrigger
                className="h-[22px] w-[64px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DASHARRAY_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Active {t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.associativeLine.activeColor} onChange={(c) => updateConfig('associativeLine.activeColor', c)} /></div>
              <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Active {t('mindMap.toolbar.zoomOut')}</span>
            <Stepper value={config.associativeLine.activeWidth} onChange={(v) => updateConfig('associativeLine.activeWidth', v)} min={1} max={20} />
          </div>
        </div>

        <Divider />

        {/* 节点内边距 */}
        <div className={sectionCls}>
          <SectionLabel icon={BoxSelect} label={`${t('mindMap.toolbar.node')} Padding`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>H</span>
            <Stepper value={config.padding.horizontal} onChange={(v) => updateConfig('padding.horizontal', v)} min={0} max={50} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>V</span>
            <Stepper value={config.padding.vertical} onChange={(v) => updateConfig('padding.vertical', v)} min={0} max={50} />
          </div>
        </div>

        <Divider />

        {/* 外框内边距 */}
        <div className={sectionCls}>
          <SectionLabel icon={Square} label={`${t('mindMap.toolbar.outline')} Padding`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>H</span>
            <Stepper value={config.outerFramePadding.horizontal} onChange={(v) => updateConfig('outerFramePadding.horizontal', v)} min={0} max={50} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>V</span>
            <Stepper value={config.outerFramePadding.vertical} onChange={(v) => updateConfig('outerFramePadding.vertical', v)} min={0} max={50} />
          </div>
        </div>

        <Divider />

        {/* 根节点文字 */}
        <div className={sectionCls}>
          <SectionLabel icon={Crown} label={`Root ${t('editorSettings.title')}`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.root.color} onChange={(c) => updateConfig('root.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.fontSize')}</span>
            <Stepper value={config.root.fontSize} onChange={(v) => updateConfig('root.fontSize', v)} min={10} max={60} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.icon')}</span>
            <Select value={config.root.fontFamily} onValueChange={(v) => updateConfig('root.fontFamily', v)}>
              <SelectTrigger
                className="h-[22px] w-[72px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Select value={config.root.fontWeight} onValueChange={(v) => updateConfig('root.fontWeight', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHT_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Italic</span>
            <Select value={config.root.fontStyle} onValueChange={(v) => updateConfig('root.fontStyle', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_STYLE_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Line</span>
            <Select value={config.root.textDecoration} onValueChange={(v) => updateConfig('root.textDecoration', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_DECORATION_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Divider />

        {/* 二级节点文字 */}
        <div className={sectionCls}>
          <SectionLabel icon={Binary} label={`L2 ${t('editorSettings.title')}`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.second.color} onChange={(c) => updateConfig('second.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.fontSize')}</span>
            <Stepper value={config.second.fontSize} onChange={(v) => updateConfig('second.fontSize', v)} min={10} max={60} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.icon')}</span>
            <Select value={config.second.fontFamily} onValueChange={(v) => updateConfig('second.fontFamily', v)}>
              <SelectTrigger
                className="h-[22px] w-[72px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Select value={config.second.fontWeight} onValueChange={(v) => updateConfig('second.fontWeight', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHT_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Italic</span>
            <Select value={config.second.fontStyle} onValueChange={(v) => updateConfig('second.fontStyle', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_STYLE_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Line</span>
            <Select value={config.second.textDecoration} onValueChange={(v) => updateConfig('second.textDecoration', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_DECORATION_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Divider />

        {/* 普通节点文字 */}
        <div className={sectionCls}>
          <SectionLabel icon={Layers} label={`${t('common.normal')} ${t('mindMap.toolbar.node')} ${t('editorSettings.title')}`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.node.color} onChange={(c) => updateConfig('node.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.fontSize')}</span>
            <Stepper value={config.node.fontSize} onChange={(v) => updateConfig('node.fontSize', v)} min={10} max={60} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.icon')}</span>
            <Select value={config.node.fontFamily} onValueChange={(v) => updateConfig('node.fontFamily', v)}>
              <SelectTrigger
                className="h-[22px] w-[72px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Select value={config.node.fontWeight} onValueChange={(v) => updateConfig('node.fontWeight', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHT_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Italic</span>
            <Select value={config.node.fontStyle} onValueChange={(v) => updateConfig('node.fontStyle', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_STYLE_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Line</span>
            <Select value={config.node.textDecoration} onValueChange={(v) => updateConfig('node.textDecoration', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_DECORATION_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Divider />

        {/* 概要节点文字 */}
        <div className={sectionCls}>
          <SectionLabel icon={Braces} label={`${t('mindMap.toolbar.summary')} ${t('mindMap.toolbar.node')} ${t('editorSettings.title')}`} />
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.color')}</span>
            <div className="scale-[0.82] origin-left"><ColorButton value={config.generalization.color} onChange={(c) => updateConfig('generalization.color', c)} /></div>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.watermark.fontSize')}</span>
            <Stepper value={config.generalization.fontSize} onChange={(v) => updateConfig('generalization.fontSize', v)} min={10} max={60} />
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.icon')}</span>
            <Select value={config.generalization.fontFamily} onValueChange={(v) => updateConfig('generalization.fontFamily', v)}>
              <SelectTrigger
                className="h-[22px] w-[72px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>{t('mindMap.toolbar.zoomOut')}</span>
            <Select value={config.generalization.fontWeight} onValueChange={(v) => updateConfig('generalization.fontWeight', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_WEIGHT_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Italic</span>
            <Select value={config.generalization.fontStyle} onValueChange={(v) => updateConfig('generalization.fontStyle', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_STYLE_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] select-none" style={{ color: 'var(--text-tertiary)' }}>Line</span>
            <Select value={config.generalization.textDecoration} onValueChange={(v) => updateConfig('generalization.textDecoration', v)}>
              <SelectTrigger
                className="h-[22px] w-[52px] text-[10px] rounded-[3px] border-[var(--border-color)] bg-transparent"
                style={{ color: 'var(--text-primary)' }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEXT_DECORATION_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
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
