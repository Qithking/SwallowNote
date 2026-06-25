/**
 * BoxModelField —— Box Model 可视化编辑器（padding / margin）。
 *
 * 布局（横向紧凑）：
 *   ─ 顶行：4 个紧凑 NumberInput（top / right / bottom / left）+ 联动按钮
 *   ─ 中行长方形 + 4 个 div 色条（top/right/bottom/left）模拟 padding 区域
 *
 * 单位：px。
 *
 * 视觉化：
 *  - 中心长方形内层用 4 个 absolute 定位的 div 表示 padding 4 边（向内推）；
 *  - 中心长方形外层（容器 padding 区域）用 4 个 absolute 定位的 div 表示 margin 4 边（向外推）；
 *  - 数值限制在 [0, VIS_MAX] 用于视觉化显示（不影响实际 onChange 数值）。
 */
import { NumberInput } from '@/components/ui/number-input'
import { Link2, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoxSpacing } from '../types'

export interface BoxModelFieldProps {
  value: BoxSpacing | undefined
  onChange: (next: BoxSpacing) => void
  className?: string
  disabled?: boolean
  /** 字段名（用于父级 onFieldClick 透传） */
  fieldKey?: string
}

const DEFAULT_SPACING: BoxSpacing = { top: 0, right: 0, bottom: 0, left: 0 }

type LinkMode = 'all' | 'tb' | 'lr'

function applyLink(spacing: BoxSpacing, mode: LinkMode, value: number): BoxSpacing {
  switch (mode) {
    case 'all':
      return { top: value, right: value, bottom: value, left: value }
    case 'tb':
      return { ...spacing, top: value, bottom: value }
    case 'lr':
      return { ...spacing, left: value, right: value }
  }
}

/** 把数值限制在 [0, VIS_MAX] 用于视觉化，避免极值打爆 UI（不影响实际 onChange 数值） */
function clampVisual(n: number, max = 32): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  return Math.min(n, max)
}

export function BoxModelField({
  value,
  onChange,
  className,
  disabled,
}: BoxModelFieldProps) {
  const current: BoxSpacing = value ?? DEFAULT_SPACING

  const setOne = (key: keyof BoxSpacing) => (n: number) => {
    onChange({ ...current, [key]: n })
  }

  // 视觉化数值（限制 0..32px）
  const vTop = clampVisual(current.top)
  const vRight = clampVisual(current.right)
  const vBottom = clampVisual(current.bottom)
  const vLeft = clampVisual(current.left)

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {/* ── 顶行：4 个 NumberInput + 联动按钮（紧凑尺寸） ── */}
      <div className="flex items-center gap-1.5">
        <CompactSide label="上" value={current.top} onChange={setOne('top')} disabled={disabled} />
        <CompactSide label="右" value={current.right} onChange={setOne('right')} disabled={disabled} />
        <CompactSide label="下" value={current.bottom} onChange={setOne('bottom')} disabled={disabled} />
        <CompactSide label="左" value={current.left} onChange={setOne('left')} disabled={disabled} />
        {/* 联动按钮 */}
        <div className="ml-auto flex items-center gap-0.5">
          <LinkButton
            title="全部联动"
            onClick={() => onChange(applyLink(current, 'all', current.top))}
            disabled={disabled}
            active
          >
            <Link2 size={11} />
          </LinkButton>
          <LinkButton
            title="上下联动"
            onClick={() => onChange(applyLink(current, 'tb', current.top))}
            disabled={disabled}
          >
            <Unlink size={11} className="rotate-90" />
          </LinkButton>
          <LinkButton
            title="左右联动"
            onClick={() => onChange(applyLink(current, 'lr', current.left))}
            disabled={disabled}
          >
            <Unlink size={11} />
          </LinkButton>
        </div>
      </div>

      {/* ── 中心长方形 + 4 边色条 ── */}
      <div
        className="relative w-full"
        style={{ height: 56, padding: 12 }}
      >
        {/* margin 外圈（虚线）—— 用虚线边框模拟（视觉化 margin 0 时不显示） */}
        <div
          className="relative h-full w-full"
          style={{
            border: '1px dashed #cbd5e1',
            borderRadius: 3,
            background: '#f8fafc',
            boxSizing: 'border-box',
          }}
        >
          {/* padding 4 边色条（向内推）—— 用 4 个 absolute div 替代 box-shadow inset，更可靠 */}
          {vTop > 0 && (
            <div
              className="pointer-events-none absolute"
              style={{
                top: 0,
                left: vLeft,
                right: vRight,
                height: vTop,
                background: 'rgba(59,130,246,0.25)',
              }}
            />
          )}
          {vBottom > 0 && (
            <div
              className="pointer-events-none absolute"
              style={{
                bottom: 0,
                left: vLeft,
                right: vRight,
                height: vBottom,
                background: 'rgba(59,130,246,0.25)',
              }}
            />
          )}
          {vLeft > 0 && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: 0,
                top: vTop,
                bottom: vBottom,
                width: vLeft,
                background: 'rgba(59,130,246,0.25)',
              }}
            />
          )}
          {vRight > 0 && (
            <div
              className="pointer-events-none absolute"
              style={{
                right: 0,
                top: vTop,
                bottom: vBottom,
                width: vRight,
                background: 'rgba(59,130,246,0.25)',
              }}
            />
          )}

          {/* 中心内容区域（避开 padding 色条） */}
          <div
            className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none"
            style={{
              paddingTop: vTop,
              paddingRight: vRight,
              paddingBottom: vBottom,
              paddingLeft: vLeft,
            }}
          >
            元素
          </div>
        </div>
      </div>
    </div>
  )
}

/** 紧凑单边 NumberInput：上方小标签 + 紧凑输入控件 */
function CompactSide({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
      <NumberInput
        value={value}
        onChange={onChange}
        min={-100}
        max={500}
        step={1}
        unit="px"
        compact
        disabled={disabled}
      />
    </div>
  )
}

/** 小尺寸图标按钮（联动） */
function LinkButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center h-5 w-5 rounded text-[10px]',
        'transition-colors',
        active
          ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
          : 'text-muted-foreground hover:bg-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      {children}
    </button>
  )
}
