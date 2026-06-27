import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  className?: string
  disabled?: boolean
  /** 紧凑模式：进一步压缩 input / 按钮尺寸（用于 BoxModelField 4 周布局） */
  compact?: boolean
}

function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  className,
  disabled,
  compact = false,
}: NumberInputProps) {
  const handleIncrement = () => {
    const newValue = Math.min(max, value + step)
    onChange(newValue)
  }

  const handleDecrement = () => {
    const newValue = Math.max(min, value - step)
    onChange(newValue)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    if (inputValue === '') return
    const parsed = parseFloat(inputValue)
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed))
      onChange(clamped)
    }
  }

  // 紧凑模式尺寸：input w-10 h-5，按钮 w-4 h-5（最小尺寸）
  // 默认尺寸：input w-16 h-6，按钮 w-8 h-6
  const inputSize = compact ? 'w-10 h-5' : 'w-16 h-6'
  const buttonSize = compact ? 'w-4 h-5' : 'w-8 h-6'
  const separatorHeight = compact ? 'h-5' : 'h-6'
  const iconSize = compact ? 10 : 14
  const containerHeight = compact ? 'h-5' : 'h-6'

  return (
    <div className={cn(
      'flex items-center border rounded-md overflow-hidden',
      'border-input bg-background',
      'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
      containerHeight,
      className
    )}>
      {/* Value Display */}
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={unit ? `${value}${unit}` : value}
          onChange={handleInputChange}
          className={cn(
            inputSize,
            'px-1 text-center',
            'bg-transparent border-none outline-none',
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            compact ? 'text-[11px]' : 'text-sm'
          )}
          disabled={disabled ?? (value <= min && value >= max)}
        />
      </div>

      {/* Separator */}
      <div className={cn('w-px bg-border', separatorHeight)} />
      {/* Buttons */}
      <div className="flex">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled ?? value <= min}
          className={cn(
            buttonSize,
            'flex items-center justify-center',
            'hover:bg-accent',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            'transition-colors'
          )}
        >
          <Minus size={iconSize} />
        </button>
        <div className={cn('w-px bg-border', separatorHeight)} />
        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled ?? value >= max}
          className={cn(
            buttonSize,
            'flex items-center justify-center',
            'hover:bg-accent',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            'transition-colors'
          )}
        >
          <Plus size={iconSize} />
        </button>
      </div>
    </div>
  )
}

export { NumberInput }