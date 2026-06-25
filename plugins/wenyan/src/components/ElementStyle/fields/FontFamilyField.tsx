/**
 * FontFamilyField —— 字体族下拉。
 *
 * 默认 8 种预设；可传 `presets` 自定义列表。
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface FontPreset {
  value: string
  label: string
}

export const DEFAULT_FONT_PRESETS: readonly FontPreset[] = [
  { value: 'sans-serif', label: '无衬线' },
  { value: 'serif', label: '衬线' },
  { value: 'monospace', label: '等宽' },
  { value: 'system-ui', label: '系统默认' },
  {
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    label: 'PingFang',
  },
  {
    value: 'Georgia, "Times New Roman", "Songti SC", serif',
    label: '宋体/Georgia',
  },
  { value: '"SF Mono", Menlo, Monaco, Consolas, monospace', label: 'SF Mono' },
  { value: 'inherit', label: '继承' },
]

export interface FontFamilyFieldProps {
  value: string | undefined
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
  presets?: readonly FontPreset[]
}

function normalizeToPreset(v: string | undefined, presets: readonly FontPreset[]): string {
  if (!v) return ''
  const lower = v.toLowerCase()
  for (const opt of presets) {
    if (opt.value.toLowerCase() === lower) return opt.value
  }
  if (/monospace/i.test(lower)) return 'monospace'
  if (/serif/i.test(lower) && !/sans-serif/i.test(lower)) return 'serif'
  if (/sans-serif/i.test(lower) || /system/i.test(lower)) return 'sans-serif'
  return v
}

export function FontFamilyField({
  value,
  onChange,
  className,
  disabled,
  presets = DEFAULT_FONT_PRESETS,
}: FontFamilyFieldProps) {
  const current = normalizeToPreset(value, presets)
  return (
    <Select
      value={current || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="选择字体" />
      </SelectTrigger>
      <SelectContent>
        {presets.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
