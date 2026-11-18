/**
 * LineHeightField —— 行高 NumberInput（无单位）。
 */
import { NumberInput } from '@/components/ui/number-input'

export interface LineHeightFieldProps {
  value: number | undefined
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
}

export function LineHeightField({ value, onChange, className, disabled }: LineHeightFieldProps) {
  return (
    <NumberInput
      value={value ?? 1.5}
      onChange={onChange}
      min={0.8}
      max={3}
      step={0.05}
      className={className}
      disabled={disabled}
    />
  )
}
