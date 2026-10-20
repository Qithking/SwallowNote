/**
 * LogViewer 纯函数工具
 *
 * 独立成文件：react-refresh 要求组件文件只导出组件，
 * 纯函数与类型拆出后 LogViewer.tsx 仅保留组件导出，HMR 才能正确生效。
 */
import type { LogEntry, LogLevel } from '@/lib/logger'

/** 过滤条件 */
export interface FilterOptions {
  levels: Set<LogLevel>
  source: string
  search: string
}

/**
 * 过滤日志条目（纯函数，便于测试）
 *
 * 按级别集合 + 来源 + 搜索文本过滤。levels 为空集时表示「全部」（不过滤级别）。
 * 搜索大小写不敏感，匹配 message 或 source。
 */
export function filterLogEntries(entries: LogEntry[], opts: FilterOptions): LogEntry[] {
  const { levels, source, search } = opts
  const lowerSearch = search.toLowerCase()
  const lowerSource = source.toLowerCase()
  return entries.filter((e) => {
    // 空集 = 「全部」态：不做级别过滤
    if (levels.size > 0 && !levels.has(e.level)) return false
    if (lowerSource && !e.source.toLowerCase().includes(lowerSource)) return false
    if (lowerSearch) {
      const inMsg = e.message.toLowerCase().includes(lowerSearch)
      const inSrc = e.source.toLowerCase().includes(lowerSearch)
      if (!inMsg && !inSrc) return false
    }
    return true
  })
}

/** 格式化时间戳为「YYYY-MM-DD HH:MM:SS.mmm」（日期+时间，行首两段） */
export function formatLogTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
