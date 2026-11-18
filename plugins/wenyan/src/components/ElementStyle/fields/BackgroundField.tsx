/**
 * BackgroundField —— 背景（颜色 / 背景图 URL 切换）。
 */
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { ColorField } from './ColorField'
import { cn } from '@/lib/utils'

export type BackgroundMode = 'color' | 'image'

export interface BackgroundFieldProps {
  /** 背景颜色（mode=color 时使用） */
  backgroundColor?: string
  /** 背景图（mode=image 时使用，value 已包含 `url(...)`） */
  backgroundImage?: string
  onChange: (next: {
    backgroundColor?: string
    backgroundImage?: string
  }) => void
  className?: string
  disabled?: boolean
}

function inferMode(_bg?: string, img?: string): BackgroundMode {
  if (img !== undefined) return 'image'
  return 'color'
}

/** 把用户输入的图片 URL 包成 `url(...)` 形式；已带 url() 的不再嵌套 */
function toBackgroundImageValue(input: string): string {
  const v = input.trim()
  if (!v) return ''
  if (/^url\(/i.test(v)) return v
  if (/^linear-gradient|^radial-gradient|^conic-gradient/i.test(v)) return v
  return `url(${v})`
}

export function BackgroundField({
  backgroundColor,
  backgroundImage,
  onChange,
  className,
  disabled,
}: BackgroundFieldProps) {
  const [mode, setMode] = useState<BackgroundMode>(() =>
    inferMode(backgroundColor, backgroundImage)
  )

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        value={mode}
        onValueChange={(v) => {
          const next = v as BackgroundMode
          setMode(next)
          if (next === 'color') {
            onChange({ backgroundColor: backgroundColor ?? '', backgroundImage: undefined })
          } else {
            onChange({ backgroundColor: undefined, backgroundImage: backgroundImage ?? 'url()' })
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-6 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="color">纯色</SelectItem>
          <SelectItem value="image">图片</SelectItem>
        </SelectContent>
      </Select>

      {mode === 'color' ? (
        <ColorField
          value={backgroundColor ?? ''}
          onChange={(v) => onChange({ backgroundColor: v, backgroundImage: undefined })}
          disabled={disabled}
        />
      ) : (
        <Input
          type="text"
          value={stripUrlWrapper(backgroundImage ?? '')}
          onChange={(e) =>
            onChange({
              backgroundColor: undefined,
              backgroundImage: toBackgroundImageValue(e.target.value),
            })
          }
          disabled={disabled}
          className="h-6 w-40 px-2 font-mono text-xs"
          placeholder="图片 URL 或 gradient"
        />
      )}
    </div>
  )
}

/** 去掉 `url(...)` 外壳，只剩内部内容，方便用户编辑 */
function stripUrlWrapper(value: string): string {
  const v = value.trim()
  const m = /^url\(\s*(.*?)\s*\)$/i.exec(v)
  if (m) return m[1].replace(/^['"]|['"]$/g, '')
  return v
}
