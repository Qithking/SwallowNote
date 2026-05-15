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
}

function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  className,
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

  return (
    <div className={cn(
      'flex items-center border rounded-md overflow-hidden',
      'border-input bg-background',
      'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
      className
    )}>
      {/* Value Display */}
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={unit ? `${value}${unit}` : value}
          onChange={handleInputChange}
          className="w-16 h-6 px-2 text-center 
            bg-transparent border-none outline-none
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
            disabled:cursor-not-allowed disabled:opacity-50"
          disabled={value <= min && value >= max}
        />
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-border" />

      {/* Buttons */}
      <div className="flex">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={value <= min}
          className="flex items-center justify-center w-8 h-6 
            text-sm hover:bg-accent 
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent
            transition-colors"
        >
          <Minus size={14} />
        </button>
        <div className="w-px h-6 bg-border" />
        <button
          type="button"
          onClick={handleIncrement}
          disabled={value >= max}
          className="flex items-center justify-center w-8 h-6 
            text-sm hover:bg-accent 
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent
            transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

export { NumberInput }