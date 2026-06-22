/** PluginSparkline - 紧凑的"启动时间 + 错误率"sparkline。纯 SVG，按峰值错误率选色，无数据返回 null。 */
import { useMemo, type CSSProperties } from 'react'
import type { TelemetryBucket } from '@/lib/plugin-telemetry'

/** Visual height of the sparkline in pixels. */
const SPARKLINE_HEIGHT = 18
/** Padding (top + bottom) inside the SVG so the line doesn't touch
 *  the top/bottom edges. Each value is in pixels. */
const SPARKLINE_PADDING_Y = 2
// 渲染宽度硬上限
const SPARKLINE_MAX_WIDTH = 120
/** Minimum rendered width. The chart collapses to 0 instead of
 *  rendering a 1px dot — a 1-dot sparkline is visual noise. */
const SPARKLINE_MIN_WIDTH = 24

/** Props。组件不接受 pluginId，操作已聚合的 buckets。 */
export interface PluginSparklineProps {
  // 预聚合 buckets（oldest first）
  buckets: readonly TelemetryBucket[]
  // 覆盖高度（12-24px，超出 clamp）
  height?: number
  // 附加 className
  className?: string
  // 样式覆盖
  style?: CSSProperties
  // locale-aware aria-label
  ariaLabel?: string
}

// 按峰值错误率返回颜色级别
function classifyErrorRate(peakErrorRate: number): {
  level: 'ok' | 'warn' | 'err'
  cssVar: string
} {
  if (peakErrorRate <= 0) {
    return { level: 'ok', cssVar: 'var(--pa-sparkline-ok, var(--pa-positive))' }
  }
  if (peakErrorRate < 0.25) {
    return { level: 'warn', cssVar: 'var(--pa-sparkline-warn, var(--pa-warn))' }
  }
  return { level: 'err', cssVar: 'var(--pa-sparkline-err, var(--pa-negative))' }
}

/**
 * Sparkline for plugin startup time / error rate.
 *
 * Renders `null` when no bucket has any operations; this is the
 * "no data → don't render" contract documented in the design.
 */
export function PluginSparkline({
  buckets,
  height = SPARKLINE_HEIGHT,
  className,
  style,
  ariaLabel,
}: PluginSparklineProps) {
  // memoize 几何计算
  const geometry = useMemo(() => {
    // Empty-state guard. We test for *any* activity in the window
    // (totalCount > 0) because the spec says "no data → don't
    // render". A window with only successes is still "data".
    let hasData = false
    let maxValue = 0
    let peakErrorRate = 0
    for (const b of buckets) {
      if (b.totalCount > 0) hasData = true
      // Y 轴用 hook + backend 时长加权平均
      let v = 0
      const total = b.hookCount + b.backendCount
      if (total > 0) {
        v = (b.avgHookDurationMs * b.hookCount + b.avgBackendDurationMs * b.backendCount) / total
      } else if (b.eventCount > 0 || b.storageCount > 0) {
        // 无 duration 记录时用 errorRate 作 stand-in
        v = b.errorRate * 4
      }
      if (v > maxValue) maxValue = v
      if (b.errorRate > peakErrorRate) peakErrorRate = b.errorRate
    }

    if (!hasData || buckets.length < 2) {
      return null
    }

    // viewBox 宽度按 bucket 数量推导
    const viewW = Math.max(buckets.length * 1.5, 40)
    const usableH = height - SPARKLINE_PADDING_Y * 2
    // Avoid divide-by-zero when every value is 0: we render a
    // flat zero line in that case. `maxValue === 0` is the
    // "all durations 0" case (e.g. a brand-new install with
    // 0 hook time recorded).
    const range = maxValue > 0 ? maxValue : 1
    const points: string[] = []
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]
      let v = 0
      const total = b.hookCount + b.backendCount
      if (total > 0) {
        v = (b.avgHookDurationMs * b.hookCount + b.avgBackendDurationMs * b.backendCount) / total
      } else if (b.errorRate > 0) {
        v = b.errorRate * 4
      }
      const x = (i / Math.max(buckets.length - 1, 1)) * viewW
      // Y axis is inverted (SVG origin is top-left), so higher
      // values land *closer to the top*. The 0-baseline sits
      // at the bottom of the usable area.
      const y = SPARKLINE_PADDING_Y + (1 - v / range) * usableH
      // Round to 2 decimals to keep the polyline `points`
      // string short (3 decimal places × 30 buckets ≈ 600
      // chars; 2 decimals is enough for a 40px-wide chart).
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    }

    const classification = classifyErrorRate(peakErrorRate)
    // The summary string is used for `aria-label`; we pre-build
    // it here so the JSX stays declarative.
    const peakMs = maxValue
    const errPct = (peakErrorRate * 100).toFixed(0)
    return {
      viewW,
      viewH: height,
      points: points.join(' '),
      classification,
      peakMs,
      errPct,
      hasData: true,
    }
  }, [buckets, height])

  // 空状态返回 null
  if (!geometry || !geometry.hasData) {
    return null
  }

  const fallbackLabel = `Plugin metrics, last ${buckets.length} buckets, peak ${geometry.peakMs.toFixed(1)}ms, ${geometry.errPct}% errors`
  const finalAria = ariaLabel ?? fallbackLabel

  // Compose className. The `is-ok` / `is-warn` / `is-err`
  // modifier lets CSS tint a background or pulse the chart on
  // error without the JSX having to set inline style flags.
  const cls = [
    'pa-sparkline',
    `is-${geometry.classification.level}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      className={cls}
      // viewBox 保证分辨率无关
      viewBox={`0 0 ${geometry.viewW} ${geometry.viewH}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      // The sparkline's `min-width` is enforced via inline
      // style so the parent grid doesn't squeeze it to a
      // 1px dot on narrow cards.
      style={{
        minWidth: SPARKLINE_MIN_WIDTH,
        maxWidth: SPARKLINE_MAX_WIDTH,
        display: 'block',
        ...style,
      }}
      role="img"
      aria-label={finalAria}
      data-sparkline-level={geometry.classification.level}
    >
      {/* baseline：1px currentColor 低透明度 */}
      <line
        x1={0}
        y1={geometry.viewH - SPARKLINE_PADDING_Y}
        x2={geometry.viewW}
        y2={geometry.viewH - SPARKLINE_PADDING_Y}
        className="pa-sparkline-baseline"
      />
      {/* stroke 用 CSS 变量适配主题 */}
      <polyline
        points={geometry.points}
        className="pa-sparkline-line"
        fill="none"
        stroke={geometry.classification.cssVar}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default PluginSparkline
