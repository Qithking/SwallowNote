/**
 * AC-8: plugin-telemetry 合并进统一 LogStore
 *
 * 当 record*Metric 被调用时，对应的日志行应同时写入统一 logStore，
 * source 带 plugin:<pluginId> 前缀，级别按标准 5 级映射（'ok'→info, 'err'→error）。
 *
 * Source: spec/unified-logging AC-8
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logStore } from '@/lib/logger'
import {
  recordEventMetric,
  recordStorageMetric,
  recordHookMetric,
  recordBackendMetric,
  recordPluginConflict,
  clearAllMetrics,
} from '@/lib/plugin-telemetry'

describe('plugin-telemetry → LogStore 合并 (AC-8)', () => {
  beforeEach(() => {
    logStore.clear()
    clearAllMetrics()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recordEventMetric 在 logStore 中写入 info 级别（无错误时）', () => {
    recordEventMetric('com.foo', 'note:open', { noteId: '1', path: '/a.md' }, 2, 5.0, 0)
    const entries = logStore.getAll()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const entry = entries.find(
      (e) => e.source === 'plugin:com.foo' && e.message.includes('note:open'),
    )
    expect(entry).toBeDefined()
    expect(entry!.level).toBe('info')
  })

  it('recordEventMetric 在 logStore 中写入 error 级别（有错误时）', () => {
    recordEventMetric('com.foo', 'note:save', { noteId: '1', path: '/a.md' }, 1, 10.0, 2)
    const entry = logStore.getAll().find((e) => e.source === 'plugin:com.foo')
    expect(entry).toBeDefined()
    expect(entry!.level).toBe('error')
  })

  it('recordStorageMetric 成功时写 info，失败时写 error', () => {
    recordStorageMetric('com.bar', 'set', 3, 100, 5.0, true)
    recordStorageMetric('com.bar', 'get', 0, 0, 1.0, false, 'disk full')
    const entries = logStore.getAll().filter((e) => e.source === 'plugin:com.bar')
    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('info')
    expect(entries[1].level).toBe('error')
  })

  it('recordHookMetric 成功时写 info，失败时写 error', () => {
    recordHookMetric('com.baz', 'onLoad', 5.0, true)
    recordHookMetric('com.baz', 'onMount', 3.0, false, 'timeout')
    const entries = logStore.getAll().filter((e) => e.source === 'plugin:com.baz')
    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('info')
    expect(entries[1].level).toBe('error')
  })

  it('recordBackendMetric 成功时写 info，失败时写 error', () => {
    recordBackendMetric('com.qux', 'do_thing', 10.0, true)
    recordBackendMetric('com.qux', 'do_thing', 8.0, false, 'panic')
    const entries = logStore.getAll().filter((e) => e.source === 'plugin:com.qux')
    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('info')
    expect(entries[1].level).toBe('error')
  })

  it('recordPluginConflict 在 logStore 中写 warn 级别', () => {
    recordPluginConflict('extension conflict on .md')
    const entry = logStore.getAll().find((e) => e.level === 'warn')
    expect(entry).toBeDefined()
    expect(entry!.message).toContain('extension conflict on .md')
  })
})
