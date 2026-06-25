/**
 * BorderField —— 边框（宽度 NumberInput + 样式 Select + 颜色 picker）。
 */
import { NumberInput } from '@/components/ui/number-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ColorField } from './ColorField'
import { cn } from '@/lib/utils'
import type { BorderSpec, BorderStyle } from '../types'

export interface BorderFieldProps {
  value: BorderSpec | undefined
  onChange: (next: BorderSpec) => void
  className?: string
  disabled?: boolean
}

const STYLE_OPTIONS: Array<{ value: BorderStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'none', label: '无' },
]

/** 默认值：未设置时使用 */
const DEFAULT_BORDER: BorderSpec = { width: 1, style: 'solid', color: '#000000' }

export function BorderField({ value, onChange, className, disabled }: BorderFieldProps) {
  const current: BorderSpec = value ?? DEFAULT_BORDER
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <NumberInput
        value={current.width}
        onChange={(width) => onChange({ ...current, width })}
        min={0}
        max={20}
        step={1}
        unit="px"
      />
      <Select
        value={current.style}
        onValueChange={(v) => onChange({ ...current, style: v as BorderStyle })}
        disabled={disabled}
      >
        <SelectTrigger className="h-6 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STYLE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ColorField
        value={current.color}
        onChange={(color) => onChange({ ...current, color })}
        disabled={disabled}
      />
    </div>
  )
}
