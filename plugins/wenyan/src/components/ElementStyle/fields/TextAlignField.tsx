/**
 * TextAlignField —— 4 项 RadioGroup（左/居中/右/两端）。
 */
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { TextAlign } from '../types'

export interface TextAlignFieldProps {
  value: TextAlign | undefined
  onChange: (v: TextAlign) => void
  className?: string
  disabled?: boolean
}

const OPTIONS: Array<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右' },
  { value: 'justify', label: '两端' },
]

export function TextAlignField({ value, onChange, className, disabled }: TextAlignFieldProps) {
  return (
    <RadioGroup
      value={value ?? 'left'}
      onValueChange={(v) => onChange(v as TextAlign)}
      disabled={disabled}
      className={cn('flex flex-row gap-3', className)}
    >
      {OPTIONS.map((opt) => (
        <div key={opt.value} className="flex items-center space-x-1">
          <RadioGroupItem value={opt.value} id={`text-align-${opt.value}`} />
          <Label
            htmlFor={`text-align-${opt.value}`}
            className="cursor-pointer text-xs font-normal"
          >
            {opt.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  )
}
