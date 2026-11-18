/**
 * FieldRow —— 单行布局：label 在左，控件在右。
 *
 * 用 Tailwind className 实现，与主项目其它 ui/ 组件风格一致。
 */
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldRowProps {
  label: string
  children: ReactNode
  /** label 列宽（默认 96px） */
  labelWidth?: number
  className?: string
  /** 隐藏 label（控件独占整行） */
  hideLabel?: boolean
  /** label 点击回调（用于「跳转到手写 CSS 对应行」） */
  onLabelClick?: () => void
}

export function FieldRow({
  label,
  children,
  labelWidth = 96,
  className,
  hideLabel,
  onLabelClick,
}: FieldRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border/40 py-2 last:border-b-0',
        className
      )}
    >
      {!hideLabel && (
        <Label
          className={cn(
            'shrink-0 text-xs text-muted-foreground',
            onLabelClick && 'cursor-pointer hover:text-foreground transition-colors'
          )}
          style={{ width: labelWidth }}
          onClick={onLabelClick}
          title={onLabelClick ? '点击跳转到手写 CSS 对应行' : undefined}
        >
          {label}
        </Label>
      )}
      {/* min-w-0 防止 flex 子项内容撑破容器，避免横向滚动 */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  )
}
