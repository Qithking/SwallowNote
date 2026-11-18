/**
 * DisplayField —— display 7 种 Select。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Display } from '../types'

export interface DisplayFieldProps {
  value: Display | undefined
  onChange: (v: Display) => void
  className?: string
  disabled?: boolean
}

const DISPLAY_OPTIONS: Array<{ value: Display; label: string }> = [
  { value: 'block', label: 'block' },
  { value: 'inline-block', label: 'inline-block' },
  { value: 'inline', label: 'inline' },
  { value: 'flex', label: 'flex' },
  { value: 'inline-flex', label: 'inline-flex' },
  { value: 'grid', label: 'grid' },
  { value: 'none', label: 'none' },
]

export function DisplayField({ value, onChange, className, disabled }: DisplayFieldProps) {
  return (
    <Select
      value={value ?? 'block'}
      onValueChange={(v) => onChange(v as Display)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="选择 display" />
      </SelectTrigger>
      <SelectContent>
        {DISPLAY_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
