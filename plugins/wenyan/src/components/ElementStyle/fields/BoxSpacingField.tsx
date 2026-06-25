/**
 * BoxSpacingField —— 4 格 Box（top/right/bottom/left），单位 em。
 *
 * 提供「全部/上右/上下/左」4 个按钮联动更新。点 4 边的 NumberInput
 * 可单独调整某一边的值。
 */
import { NumberInput } from '@/components/ui/number-input'
import { cn } from '@/lib/utils'
import type { BoxSpacing } from '../types'

export interface BoxSpacingFieldProps {
  value: BoxSpacing | undefined
  onChange: (next: BoxSpacing) => void
  className?: string
  disabled?: boolean
}

const DEFAULT_SPACING: BoxSpacing = { top: 0, right: 0, bottom: 0, left: 0 }

type LinkMode = 'all' | 'trbl' | 'tb' | 'lr'

function applyLink(spacing: BoxSpacing, mode: LinkMode, value: number): BoxSpacing {
  switch (mode) {
    case 'all':
      return { top: value, right: value, bottom: value, left: value }
    case 'trbl':
      return { ...spacing, top: value, right: value, bottom: value, left: value }
    case 'tb':
      return { ...spacing, top: value, bottom: value }
    case 'lr':
      return { ...spacing, left: value, right: value }
  }
}

export function BoxSpacingField({ value, onChange, className, disabled }: BoxSpacingFieldProps) {
  const current: BoxSpacing = value ?? DEFAULT_SPACING

  const handleOne = (key: keyof BoxSpacing) => (n: number) => {
    onChange({ ...current, [key]: n })
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1">
        <NumberInput
          value={current.top}
          onChange={handleOne('top')}
          min={-10}
          max={20}
          step={0.1}
          unit="em"
          disabled={disabled}
        />
        <NumberInput
          value={current.right}
          onChange={handleOne('right')}
          min={-10}
          max={20}
          step={0.1}
          unit="em"
          disabled={disabled}
        />
        <NumberInput
          value={current.bottom}
          onChange={handleOne('bottom')}
          min={-10}
          max={20}
          step={0.1}
          unit="em"
          disabled={disabled}
        />
        <NumberInput
          value={current.left}
          onChange={handleOne('left')}
          min={-10}
          max={20}
          step={0.1}
          unit="em"
          disabled={disabled}
        />
      </div>
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => onChange(applyLink(current, 'all', current.top))}
          disabled={disabled}
          className="rounded border border-input bg-background px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => onChange(applyLink(current, 'tb', current.top))}
          disabled={disabled}
          className="rounded border border-input bg-background px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          上下
        </button>
        <button
          type="button"
          onClick={() => onChange(applyLink(current, 'lr', current.left))}
          disabled={disabled}
          className="rounded border border-input bg-background px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          左右
        </button>
      </div>
    </div>
  )
}
