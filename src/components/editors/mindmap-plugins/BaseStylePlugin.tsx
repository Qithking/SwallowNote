/**
 * Base Style Plugin for MindMap
 *
 * Controls canvas background, line styles, rainbow lines, generalization lines, associative lines
 * Similar to the "基础样式" panel in simple-mind-map official example
 */
import { useState, useEffect, useCallback } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { ColorPicker, ColorButton } from './ColorPicker'

interface BaseStylePluginProps {
  mindMap: any // simple-mind-map instance
  onClose: () => void
}

interface LineStyleConfig {
  color: string
  width: number
  style: 'straight' | 'curve' | 'direct'
  radius: number
  showArrow: boolean
}

interface BaseStyleConfig {
  backgroundColor: string
  backgroundImage: string
  line: LineStyleConfig
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
}

const LINE_STYLES = [
  { value: 'straight', label: '直线' },
  { value: 'curve', label: '曲线' },
  { value: 'direct', label: '直连' },
]

const DASHARRAY_OPTIONS = [
  { value: 'none', label: '实线' },
  { value: '5,5', label: '虚线5' },
  { value: '10,10', label: '虚线10' },
  { value: '5,10', label: '虚线5-10' },
]

export function BaseStylePlugin({ mindMap, onClose }: BaseStylePluginProps) {
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
      dasharray: '6,4',
    },
  })

  // Get current theme config from mindMap
  useEffect(() => {
    if (!mindMap) return
    const themeConfig = mindMap.getThemeConfig()
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
        dasharray: themeConfig.associativeLineDasharray || '6,4',
      },
    })
  }, [mindMap])

  // Apply config to mindMap
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
    applyConfig(newConfig)
  }

  const [activeTab, setActiveTab] = useState<'color' | 'image'>('color')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[400px] max-h-[80vh] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">基础样式</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Background Section */}
          <section>
            <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">背景</h4>
            <div className="flex gap-4 mb-3">
              <button
                onClick={() => setActiveTab('color')}
                className={`text-xs pb-1 border-b-2 transition-colors ${
                  activeTab === 'color'
                    ? 'text-[var(--theme-color)] border-[var(--theme-color)]'
                    : 'text-[var(--text-secondary)] border-transparent'
                }`}
              >
                颜色
              </button>
              <button
                onClick={() => setActiveTab('image')}
                className={`text-xs pb-1 border-b-2 transition-colors ${
                  activeTab === 'image'
                    ? 'text-[var(--theme-color)] border-[var(--theme-color)]'
                    : 'text-[var(--text-secondary)] border-transparent'
                }`}
              >
                图片
              </button>
            </div>
            {activeTab === 'color' && (
              <ColorPicker
                value={config.backgroundColor}
                onChange={(color) => updateConfig('backgroundColor', color)}
                size="sm"
              />
            )}
            {activeTab === 'image' && (
              <div className="text-xs text-[var(--text-secondary)] py-2">
                图片背景功能暂未实现
              </div>
            )}
          </section>

          {/* Line Section */}
          <section>
            <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">连线</h4>
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
                  <span className="text-xs text-[var(--text-secondary)]">粗细</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={config.line.width}
                    onChange={(e) => updateConfig('line.width', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">风格</span>
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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">圆角大小</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={config.line.radius}
                    onChange={(e) => updateConfig('line.radius', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.line.showArrow}
                  onChange={(e) => updateConfig('line.showArrow', e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--border-color)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">是否显示箭头</span>
              </label>
            </div>
          </section>

          {/* Rainbow Lines Section */}
          <section>
            <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">彩虹线条</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.rainbowLines}
                onChange={(e) => updateConfig('rainbowLines', e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border-color)]"
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {config.rainbowLines ? '使用彩虹线条' : '不使用彩虹线条'}
              </span>
            </label>
          </section>

          {/* Generalization Line Section */}
          <section>
            <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">概要的连线</h4>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">颜色</span>
                <ColorButton
                  value={config.generalizationLine.color}
                  onChange={(color) => updateConfig('generalizationLine.color', color)}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">粗细</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={config.generalizationLine.width}
                  onChange={(e) => updateConfig('generalizationLine.width', parseInt(e.target.value) || 1)}
                  className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                />
              </div>
            </div>
          </section>

          {/* Associative Line Section */}
          <section>
            <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">关联线</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">颜色</span>
                  <ColorButton
                    value={config.associativeLine.color}
                    onChange={(color) => updateConfig('associativeLine.color', color)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">粗细</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={config.associativeLine.width}
                    onChange={(e) => updateConfig('associativeLine.width', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">激活颜色</span>
                  <ColorButton
                    value={config.associativeLine.activeColor}
                    onChange={(color) => updateConfig('associativeLine.activeColor', color)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">激活粗细</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={config.associativeLine.activeWidth}
                    onChange={(e) => updateConfig('associativeLine.activeWidth', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">样式</span>
                <select
                  value={config.associativeLine.dasharray}
                  onChange={(e) => updateConfig('associativeLine.dasharray', e.target.value)}
                  className="px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-secondary)]"
                >
                  {DASHARRAY_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
