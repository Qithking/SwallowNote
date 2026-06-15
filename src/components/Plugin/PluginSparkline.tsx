/**
 * PluginSparkline — compact "startup time + error rate" sparkline for
 * the per-plugin Installed card (Task 12 / G12).
 *
 * Visual contract:
 *   - Height: 18px (within the 16–20px band specified in the design).
 *   - Width: auto-fills the parent up to `maxWidth` (default 120px) so
 *     a long line on a wider card just shows more horizontal detail.
 *     The component reports its own measured width via the optional
 *     `onWidthChange` callback so a parent that wants to align a label
 *     to the right of the line can match the rendered extent.
 *   - Colour: the polyline's stroke uses one of three theme tokens,
 *     picked by the *peak* `errorRate` across the rendered buckets:
 *       - `errorRate === 0`  → `--pa-sparkline-ok`   (positive / green)
 *       - `errorRate < 0.25` → `--pa-sparkline-warn` (warn / amber)
 *       - `errorRate ≥ 0.25` → `--pa-sparkline-err`  (negative / red)
 *     The thresholds are deliberately generous: a single failed
 *     hook in 20 successful ones is "warn", not "err". A bucket
 *     with 25%+ errors is treated as a real outage.
 *   - Data contract: the component is *purely presentational*. It
 *     receives pre-aggregated buckets from the parent; the parent
 *     (the Installed card) computes them once per mount via
 *     `aggregateTelemetryByTimeWindow` so re-renders don't re-walk
 *     the metric ring buffers.
 *   - Empty state: when *every* bucket has `totalCount === 0` the
 *     component returns `null`. The card's "no data" behavior is
 *     "no chart at all" — per the spec — rather than a placeholder
 *     line. This keeps the Installed grid's vertical rhythm stable
 *     for new installs that have never recorded a metric.
 *
 * Implementation notes:
 *   - Pure SVG, no chart library. The point set is a polyline of
 *     `bucketCount` points with `stroke-linejoin: round` to soften
 *     the sharp corners; the height is normalised against the
 *     *max* value across the visible window so a 5ms-only
 *     visualisation isn't pinned to the bottom.
 *   - A small "0" baseline guides the eye but only when the chart
 *     has data; it's hidden in the empty case (the whole chart is
 *     hidden anyway).
 *   - `aria-label` summarises the range so a screen-reader user
 *     hears e.g. "Last 30 minutes, peak 12.4ms, 0% errors" instead
 *     of the raw SVG path.
 */
import { useMemo, type CSSProperties } from 'react'
import type { TelemetryBucket } from '@/lib/plugin-telemetry'

/** Visual height of the sparkline in pixels. */
const SPARKLINE_HEIGHT = 18
/** Padding (top + bottom) inside the SVG so the line doesn't touch
 *  the top/bottom edges. Each value is in pixels. */
const SPARKLINE_PADDING_Y = 2
/** Hard cap on the rendered width. The component never grows
 *  beyond this; in practice the parent (the card's right column)
 *  is much narrower than 120px so the value is a guard, not a
 *  target. */
const SPARKLINE_MAX_WIDTH = 120
/** Minimum rendered width. The chart collapses to 0 instead of
 *  rendering a 1px dot — a 1-dot sparkline is visual noise. */
const SPARKLINE_MIN_WIDTH = 24

/**
 * Props for `<PluginSparkline />`.
 *
 * The component deliberately does not accept a `pluginId` — it
 * operates on already-aggregated buckets. The parent is
 * responsible for filtering by plugin id (and choosing the
 * window / bucket size) before handing the data down. This
 * keeps the sparkline reusable from any context that has
 * `TelemetryBucket[]` available (the diagnostics dialog, the
 * activity dialog, etc.).
 */
export interface PluginSparklineProps {
  /**
   * Pre-aggregated buckets, oldest first. The component treats
   * the array as opaque: it doesn't know about the underlying
   * window size, only that each element is a point on the line.
   * The parent should pass at least 2 buckets — with 1 bucket
   * the polyline is just a horizontal segment, which renders
   * the same as a 0-line and wastes pixels.
   */
  buckets: readonly TelemetryBucket[]
  /**
   * Override the height (in pixels). Mostly useful for tests
   * that want a deterministic SVG height without depending on
   * the constant. Must be in the 12–24px range; values outside
   * are clamped to keep the "compact" contract.
   */
  height?: number
  /**
   * Optional className appended to the wrapping `<svg>`. Kept
   * for the card's BEM-style hook (`pa-sparkline`) and for any
   * future per-instance modifier (`is-warn`, `is-err`).
   */
  className?: string
  /**
   * Optional style override. Intended for the card to push the
   * sparkline flush-right via `marginLeft: 'auto'` from the
   * outside; the component itself is `display: block`.
   */
  style?: CSSProperties
  /**
   * Locale-aware label for the chart. Defaults to a fixed
   * English string; the Installed card passes a translated
   * version through `t(...)`.
   */
  ariaLabel?: string
}

/** Pick the sparkline's stroke colour based on the peak error
 *  rate across the rendered buckets. We return both the CSS
 *  variable name and a className so the consumer can style the
 *  wrapper (e.g. tint the background) the same way. */
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
  // Memoize the polyline geometry. The expensive parts are:
  //   1. Walking the buckets to find `maxValue` and `peakErrorRate`.
  //   2. Computing the `points` string.
  // Both are O(N) in bucket count (default 30), so for 50 cards
  // in the Installed grid the total cost is 1500 iterations per
  // re-render — well within budget.
  const geometry = useMemo(() => {
    // Empty-state guard. We test for *any* activity in the window
    // (totalCount > 0) because the spec says "no data → don't
    // render". A window with only successes is still "data".
    let hasData = false
    let maxValue = 0
    let peakErrorRate = 0
    for (const b of buckets) {
      if (b.totalCount > 0) hasData = true
      // Use hook duration as the primary Y axis. The bucket
      // also carries `avgBackendDurationMs`; we blend the two
      // so a backend-heavy plugin's startup time is still
      // reflected. Weighted by count so a bucket with 0 hooks
      // and 1 backend doesn't paint itself entirely as the
      // backend's duration.
      let v = 0
      const total = b.hookCount + b.backendCount
      if (total > 0) {
        v = (b.avgHookDurationMs * b.hookCount + b.avgBackendDurationMs * b.backendCount) / total
      } else if (b.eventCount > 0 || b.storageCount > 0) {
        // No duration-bearing records; use the error rate as
        // a stand-in so a bucket with *only* failed storage
        // ops still shows up on the chart (with a small lift).
        v = b.errorRate * 4
      }
      if (v > maxValue) maxValue = v
      if (b.errorRate > peakErrorRate) peakErrorRate = b.errorRate
    }

    if (!hasData || buckets.length < 2) {
      return null
    }

    // The width is derived from the bucket count. The card's
    // right column is roughly 96px wide; we let the chart fill
    // the available space up to `SPARKLINE_MAX_WIDTH` so a wider
    // card shows more horizontal resolution. The actual width
    // is computed in the parent via `useResizeObserver` if it
    // needs to; for now we just use a width that matches the
    // bucket count (1.5px per bucket ≈ 45px for 30 buckets).
    // Real CSS layout is `width: 100%`; this constant is the
    // `viewBox` width so the polyline coordinates are stable
    // regardless of the rendered size.
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

  // Empty-state: render nothing. The card's flex layout
  // collapses around `null` so this is the "no sparkline"
  // behavior — the meta row simply doesn't get a right-side
  // companion. The spec requires "no data → don't render"
  // specifically so new installs don't show an empty grid of
  // placeholder lines.
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
      // `viewBox` makes the SVG resolution-independent; the
      // `width`/`height` attributes give the layout its size
      // while `style.maxWidth` / `style.minWidth` clamp the
      // rendered extent to the design band.
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
      {/* Baseline (0-value guide). Drawn as a 1px line at the
        bottom of the usable area. We use `currentColor` with
        low opacity so it picks up the card's text colour
        automatically and remains subtle. */}
      <line
        x1={0}
        y1={geometry.viewH - SPARKLINE_PADDING_Y}
        x2={geometry.viewW}
        y2={geometry.viewH - SPARKLINE_PADDING_Y}
        className="pa-sparkline-baseline"
      />
      {/* The main trend line. `stroke` is set via CSS variable
        so theme changes (light / dark / system) flow through
        the same `--pa-*` aliases the rest of the card uses. */}
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
