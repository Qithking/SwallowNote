/**
 * BorderRadiusField —— 圆角 (px) NumberInput。
 */
import { NumberInput } from '@/components/ui/number-input'

export interface BorderRadiusFieldProps {
  value: number | undefined
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
}

export function BorderRadiusField({ value, onChange, className, disabled }: BorderRadiusFieldProps) {
  return (
    <NumberInput
      value={value ?? 0}
      onChange={onChange}
      min={0}
      max={50}
      step={1}
      unit="px"
      className={className}
      disabled={disabled}
    />
  )
}
