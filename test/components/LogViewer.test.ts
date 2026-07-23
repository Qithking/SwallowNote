/**
 * AC-9: LogViewer 过滤逻辑
 *
 * filterLogEntries 纯函数：按级别 + 来源 + 搜索文本过滤日志条目。
 *
 * Source: spec/unified-logging AC-9
 */
import { describe, it, expect } from 'vitest'
import { filterLogEntries, type LogEntry } from '@/components/LogViewer'

function makeEntry(
  source: string,
  message: string,
  level: LogEntry['level'] = 'info',
  timestamp: number = Date.now(),
): LogEntry {
  return { timestamp, level, source, message }
}

describe('filterLogEntries (AC-9)', () => {
  const entries: LogEntry[] = [
    makeEntry('app', 'startup complete', 'info', 1000),
    makeEntry('editor', 'loaded file', 'debug', 2000),
    makeEntry('git', 'commit failed', 'error', 3000),
    makeEntry('plugin:com.foo', 'plugin warning', 'warn', 4000),
    makeEntry('app', 'trace detail', 'trace', 5000),
  ]

  it('无过滤时返回全部条目', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: '',
      search: '',
    })
    expect(result).toHaveLength(5)
  })

  it('按级别过滤：仅返回 error', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['error']),
      source: '',
      search: '',
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('commit failed')
  })

  it('按级别过滤：返回 info + warn', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['info', 'warn']),
      source: '',
      search: '',
    })
    expect(result).toHaveLength(2)
  })

  it('按来源过滤：仅返回 app', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: 'app',
      search: '',
    })
    expect(result).toHaveLength(2)
    expect(result.every((e) => e.source === 'app')).toBe(true)
  })

  it('按来源过滤：支持 plugin: 前缀', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: 'plugin:com.foo',
      search: '',
    })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('plugin:com.foo')
  })

  it('按搜索文本过滤：匹配 message', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: '',
      search: 'failed',
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('commit failed')
  })

  it('按搜索文本过滤：大小写不敏感', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: '',
      search: 'STARTUP',
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('startup complete')
  })

  it('组合过滤：级别 + 来源 + 搜索', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['info']),
      source: 'app',
      search: 'startup',
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('startup complete')
  })

  it('空级别集合返回空数组', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(),
      source: '',
      search: '',
    })
    expect(result).toHaveLength(0)
  })

  it('搜索文本也匹配 source', () => {
    const result = filterLogEntries(entries, {
      levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
      source: '',
      search: 'plugin',
    })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('plugin:com.foo')
  })
})
