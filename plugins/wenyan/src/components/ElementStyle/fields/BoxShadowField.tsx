/**
 * BoxShadowField —— 阴影档位 Select（4 档）。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BoxShadow } from '../types'

export interface BoxShadowFieldProps {
  value: BoxShadow | undefined
  onChange: (v: BoxShadow) => void
  className?: string
  disabled?: boolean
}

const SHADOW_OPTIONS: Array<{ value: BoxShadow; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'sm', label: '浅 (sm)' },
  { value: 'md', label: '中 (md)' },
  { value: 'lg', label: '深 (lg)' },
]

export function BoxShadowField({ value, onChange, className, disabled }: BoxShadowFieldProps) {
  return (
    <Select
      value={value ?? 'none'}
      onValueChange={(v) => onChange(v as BoxShadow)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="选择阴影" />
      </SelectTrigger>
      <SelectContent>
        {SHADOW_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
