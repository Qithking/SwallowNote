import { useT } from '../i18n/useT'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  size?: 'sm' | 'md' | 'lg'
  showMore?: boolean
}

const PRESET_COLORS = [
  ['#333333', '#666666', '#999999', '#e74c3c', '#e67e22', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'],
  ['#000000', '#555555', '#aaaaaa', '#c0392b', '#d35400', '#d4ac0d', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#ad1457', '#6c5ce7'],
  ['#2d3436', '#636e72', '#b2bec3', '#ff7675', '#fdcb6e', '#00b894', '#00cec9', '#0984e3', '#6c5ce7', '#fd79a8', '#a29bfe', '#2d3436'],
]

export function ColorPicker({ value, onChange, size = 'md', showMore = true }: ColorPickerProps) {
  const t = useT()
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }

  const isSelected = (color: string) => {
    return value.toLowerCase() === color.toLowerCase()
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {PRESET_COLORS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((color) => (
              <button
                key={color}
                onClick={() => onChange(color)}
                className={`
                  ${sizeClasses[size]} rounded-sm border border-[var(--border-color)]
                  hover:scale-110 transition-transform
                  ${isSelected(color) ? 'ring-2 ring-[var(--theme-color)] ring-offset-1' : ''}
                `}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        ))}
      </div>

      {showMore && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">{t('mindMap.colorPicker.moreColors')}</span>
          <div className="relative">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-6 h-6 p-0 border-0 rounded cursor-pointer opacity-0 absolute inset-0"
            />
            <div
              className="w-6 h-6 rounded border border-[var(--border-color)] flex items-center justify-center"
              style={{ backgroundColor: value }}
            >
              <div className="w-3 h-3 border border-[var(--border-color)] bg-white/50" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function ColorSwatch({
  value,
  onChange,
  size = 22,
  showHex = false,
}: {
  value: string
  onChange: (color: string) => void
  size?: number
  showHex?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 group">
      <div
        className="relative rounded-[3px] overflow-hidden cursor-pointer transition-all duration-150 hover:shadow-[0_0_0_1.5px_var(--theme-color)]"
        style={{ width: size, height: size }}
      >
        <input
          type="color"
          value={value.startsWith('#') ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="w-full h-full rounded-[3px]"
          style={{
            backgroundColor: value,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
          }}
        />
      </div>
      {showHex && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[62px] px-1 py-px text-[10px] font-mono tracking-tight border rounded-[3px] bg-transparent transition-colors duration-150 focus:border-[var(--theme-color)]"
          style={{
            color: 'var(--text-primary)',
            borderColor: 'var(--border-color)',
          }}
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
      )}
    </div>
  )
}

export function ColorButton({ value, onChange, disabled }: { value: string; onChange: (color: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <input
        type="color"
        value={value.startsWith('#') ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-7 h-7 p-0 border-0 rounded cursor-pointer opacity-0 absolute inset-0 z-10"
      />
      <div
        className="w-7 h-7 rounded-[4px] cursor-pointer transition-all duration-150 hover:shadow-[0_0_0_1.5px_var(--theme-color)] hover:scale-105"
        style={{
          backgroundColor: value,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
        }}
      />
    </div>
  )
}
