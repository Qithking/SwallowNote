/**
 * PluginStatsRibbon — the 5-cell install stats grid.
 *
 * Cells (in order):
 *   1. Installed  — total plugin count
 *   2. Active     — enabled plugins
 *   3. Disabled   — disabled plugins
 *   4. Updates    — plugins with a pending update
 *   5. Errors     — total errors reported in the last 24h
 *
 * Each cell shows a large display-font number, a mono uppercase label,
 * and an optional trend delta (green up / red down / muted stable).
 *
 * Layout: 2 cells per row (a 2×N grid). The 5 cells therefore fall
 * into 3 rows: 2 + 2 + 1. The 5th cell is marked with `.is-last`
 * so it can stretch across both columns and not look stranded.
 *
 * The ribbon is purely presentational — the parent component is
 * responsible for supplying already-computed values. This keeps the
 * ribbon trivially testable and easy to drop into any view that needs
 * the same summary.
 */
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface PluginStatsRibbonProps {
  total: number
  active: number
  disabled: number
  updates: number
  errors: number
  /**
   * Optional trend deltas as percentages. The host computes these from
   * telemetry snapshots (e.g. comparing the last 24h to the previous
   * 24h). When a field is `undefined` we fall back to a stable "—"
   * placeholder instead of a fake arrow.
   */
  trends?: {
    active?: number
    updates?: number
    errors?: number
  }
}

export function PluginStatsRibbon({ total, active, disabled, updates, errors, trends }: PluginStatsRibbonProps) {
  const { t } = useTranslation()
  return (
    <div className="pa-stats" role="group" aria-label={t('plugin.pa.stats.installed')}>
      <Cell
        label={t('plugin.pa.stats.installed')}
        value={total}
        trend={null}
      />
      <Cell
        label={t('plugin.pa.stats.active')}
        value={active}
        trend={trends?.active}
      />
      <Cell
        label={t('plugin.pa.stats.disabled')}
        value={disabled}
        trend={null}
      />
      <Cell
        label={t('plugin.pa.stats.updates')}
        value={updates}
        trend={trends?.updates}
      />
      <Cell
        label={t('plugin.pa.stats.errors')}
        value={errors}
        trend={trends?.errors}
        dangerZero
        isLast
      />
    </div>
  )
}

interface CellProps {
  label: string
  value: number
  trend: number | null | undefined
  /** When true, treat `0` as the "good" state and any non-zero trend
   *  is styled as `is-warn` rather than `is-up`/`is-down`. Used for
   *  the errors cell so a flat `0` reads as "no errors" rather than
   *  "no growth". */
  dangerZero?: boolean
  /** Set on the trailing cell of an odd-count grid so it can span
   *  both columns and the layout reads as a 2×N grid instead of
   *  leaving the last cell stranded on a half-width row. */
  isLast?: boolean
}

function Cell({ label, value, trend, dangerZero, isLast }: CellProps) {
  let trendEl: React.ReactNode = null
  if (typeof trend === 'number' && Number.isFinite(trend)) {
    if (trend === 0) {
      trendEl = (
        <span className="pa-stat-delta">
          <Minus size={9} /> stable
        </span>
      )
    } else if (trend > 0) {
      const cls = dangerZero ? 'is-warn' : 'is-up'
      trendEl = (
        <span className={`pa-stat-delta ${cls}`}>
          <TrendingUp size={9} /> {trend.toFixed(0)}%
        </span>
      )
    } else {
      const cls = dangerZero ? 'is-up' : 'is-down'
      trendEl = (
        <span className={`pa-stat-delta ${cls}`}>
          <TrendingDown size={9} /> {Math.abs(trend).toFixed(0)}%
        </span>
      )
    }
  }
  return (
    <div className={isLast ? 'pa-stat is-last' : 'pa-stat'}>
      <span className="pa-stat-label">{label}</span>
      <span className="pa-stat-num">{value}</span>
      {trendEl}
    </div>
  )
}
