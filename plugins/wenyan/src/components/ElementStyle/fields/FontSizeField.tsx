/**
 * FontSizeField —— 字号 NumberInput（px）。
 */
import { NumberInput } from '@/components/ui/number-input'

export interface FontSizeFieldProps {
  value: number | undefined
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
}

export function FontSizeField({ value, onChange, className, disabled }: FontSizeFieldProps) {
  return (
    <NumberInput
      value={value ?? 16}
      onChange={onChange}
      min={8}
      max={72}
      step={1}
      unit="px"
      className={className}
      disabled={disabled}
    />
  )
}
