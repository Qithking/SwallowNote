/**
 * Color Picker Component
 *
 * Provides preset colors and custom color selection
 */
import { useState } from 'react'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  size?: 'sm' | 'md' | 'lg'
  showMore?: boolean
}

// Preset colors matching the screenshot
const PRESET_COLORS = [
  // Row 1
  ['#333333', '#666666', '#999999', '#e74c3c', '#e67e22', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'],
  // Row 2
  ['#000000', '#555555', '#aaaaaa', '#c0392b', '#d35400', '#d4ac0d', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#ad1457', '#6c5ce7'],
  // Row 3
  ['#2d3436', '#636e72', '#b2bec3', '#ff7675', '#fdcb6e', '#00b894', '#00cec9', '#0984e3', '#6c5ce7', '#fd79a8', '#a29bfe', '#2d3436'],
]

export function ColorPicker({ value, onChange, size = 'md', showMore = true }: ColorPickerProps) {
  const [showCustom, setShowCustom] = useState(false)

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
      {/* Preset Colors */}
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

      {/* Custom Color */}
      {showMore && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">更多颜色</span>
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

// Compact color picker for inline use
export function ColorButton({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="relative">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 p-0 border-0 rounded cursor-pointer opacity-0 absolute inset-0 z-10"
      />
      <div
        className="w-8 h-8 rounded border border-[var(--border-color)] cursor-pointer hover:border-[var(--theme-color)] transition-colors"
        style={{ backgroundColor: value }}
      />
    </div>
  )
}
