/**
 * ColorField —— 颜色选择行（color picker + 文本输入）。
 *
 * 使用原生 <input type="color"> + 文本输入。原生 picker 不支持 8 位
 * hex（含 alpha），因此 picker 端对 8 位 hex 截断为 6 位再写入。
 */
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** 把颜色归一化为 6 位 hex（用于原生 color picker）。 */
export function normalizeColor(c: string): string {
  const v = c.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase()
  }
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase()
  return v || '#000000'
}

export interface ColorFieldProps {
  value: string
  onChange: (v: string) => void
  className?: string
  /** 文本输入框是否禁用（用于「未设置」时锁定） */
  disabled?: boolean
}

export function ColorField({ value, onChange, className, disabled }: ColorFieldProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <input
        type="color"
        value={normalizeColor(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-6 w-7 cursor-pointer rounded border border-input bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="颜色选择器"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-6 w-24 px-2 font-mono text-xs"
        placeholder="如 #3f3f3f"
      />
    </div>
  )
}
