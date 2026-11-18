/**
 * LetterSpacingField —— 字间距 NumberInput（px，step 1）。
 */
import { NumberInput } from '@/components/ui/number-input'

export interface LetterSpacingFieldProps {
  value: number | undefined
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
}

export function LetterSpacingField({
  value,
  onChange,
  className,
  disabled,
}: LetterSpacingFieldProps) {
  return (
    <NumberInput
      value={value ?? 0}
      onChange={onChange}
      min={-10}
      max={50}
      step={1}
      unit="px"
      className={className}
      disabled={disabled}
    />
  )
}
