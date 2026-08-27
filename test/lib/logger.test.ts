/**
 * AC-1: 前端 logger 模块
 *
 * LogStore 维护最近 5000 条日志的内存环形缓冲，
 * 供 LogViewer 实时订阅展示。
 *
 * Source: spec/unified-logging AC-1
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logger, logStore, setFileWriter, createPluginLogger, MAX_LOG_ENTRIES, type LogEntry } from '@/lib/logger'

function makeEntry(i: number): LogEntry {
  return { timestamp: i, level: 'info', source: 'test', message: `msg-${i}` }
}

describe('LogStore: 环形缓冲 (AC-1a)', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('getAll 返回空数组当缓冲区为空', () => {
    expect(logStore.getAll()).toEqual([])
  })

  it('写入日志后 getAll 返回该日志', () => {
    const entry = makeEntry(1)
    logStore.push(entry)
    expect(logStore.getAll()).toHaveLength(1)
    expect(logStore.getAll()[0]).toEqual(entry)
  })

  it('写入多条日志后 getAll 按时间顺序返回', () => {
    logStore.push(makeEntry(1))
    logStore.push(makeEntry(2))
    logStore.push(makeEntry(3))
    const all = logStore.getAll()
    expect(all).toHaveLength(3)
    expect(all[0].message).toBe('msg-1')
    expect(all[2].message).toBe('msg-3')
  })

  it('超过 MAX_LOG_ENTRIES 时丢弃最早的日志', () => {
    const overflow = 10
    for (let i = 0; i < MAX_LOG_ENTRIES + overflow; i++) {
      logStore.push(makeEntry(i))
    }
    expect(logStore.getAll()).toHaveLength(MAX_LOG_ENTRIES)
    // 最早的 overflow 条被丢弃
    expect(logStore.getAll()[0].message).toBe(`msg-${overflow}`)
    expect(logStore.getAll()[MAX_LOG_ENTRIES - 1].message).toBe(
      `msg-${MAX_LOG_ENTRIES + overflow - 1}`,
    )
  })

  it('clear 清空缓冲区', () => {
    logStore.push(makeEntry(1))
    logStore.push(makeEntry(2))
    logStore.clear()
    expect(logStore.getAll()).toEqual([])
  })
})

describe('LogStore: subscribe 订阅 (AC-1b)', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('push 时通知订阅者并传入该日志条目', () => {
    const received: LogEntry[] = []
    const unsubscribe = logStore.subscribe((entry) => received.push(entry))

    const entry = makeEntry(42)
    logStore.push(entry)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(entry)

    unsubscribe()
  })

  it('多条日志按顺序通知订阅者', () => {
    const received: LogEntry[] = []
    const unsubscribe = logStore.subscribe((e) => received.push(e))

    logStore.push(makeEntry(1))
    logStore.push(makeEntry(2))
    logStore.push(makeEntry(3))

    expect(received).toHaveLength(3)
    expect(received[0].message).toBe('msg-1')
    expect(received[2].message).toBe('msg-3')

    unsubscribe()
  })

  it('unsubscribe 后不再收到通知', () => {
    const received: LogEntry[] = []
    const unsubscribe = logStore.subscribe((e) => received.push(e))

    logStore.push(makeEntry(1))
    unsubscribe()

    logStore.push(makeEntry(2))

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('msg-1')
  })

  it('多个订阅者同时收到通知', () => {
    const receivedA: LogEntry[] = []
    const receivedB: LogEntry[] = []
    const unsubA = logStore.subscribe((e) => receivedA.push(e))
    const unsubB = logStore.subscribe((e) => receivedB.push(e))

    logStore.push(makeEntry(1))

    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(1)

    unsubA()
    unsubB()
  })
})

describe('LogStore: exportJsonl 导出 (AC-1c)', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('空缓冲区导出空字符串', () => {
    expect(logStore.exportJsonl()).toBe('')
  })

  it('单条日志导出为单行 JSON', () => {
    logStore.push({ timestamp: 1000, level: 'info', source: 'app', message: 'hello' })
    const jsonl = logStore.exportJsonl()
    const lines = jsonl.split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed).toEqual({ timestamp: 1000, level: 'info', source: 'app', message: 'hello' })
  })

  it('多条日志导出为多行 JSON（每行一条）', () => {
    logStore.push({ timestamp: 1, level: 'info', source: 'a', message: 'first' })
    logStore.push({ timestamp: 2, level: 'warn', source: 'b', message: 'second' })
    logStore.push({ timestamp: 3, level: 'error', source: 'c', message: 'third' })
    const jsonl = logStore.exportJsonl()
    const lines = jsonl.split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).message).toBe('first')
    expect(JSON.parse(lines[2]).message).toBe('third')
  })

  it('带 args 的日志正确序列化', () => {
    logStore.push({
      timestamp: 1,
      level: 'error',
      source: 'test',
      message: 'failed',
      args: [{ code: 500 }, 'detail'],
    })
    const jsonl = logStore.exportJsonl()
    const parsed = JSON.parse(jsonl)
    expect(parsed.args).toEqual([{ code: 500 }, 'detail'])
  })
})

describe('logger: 5 级方法 (AC-1d)', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('logger.info 写入 LogStore 并调用 console.info', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('app', 'hello info')
    const all = logStore.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].level).toBe('info')
    expect(all[0].source).toBe('app')
    expect(all[0].message).toBe('hello info')
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('logger.warn 写入 LogStore 并调用 console.warn', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('ui', 'warning msg')
    const all = logStore.getAll()
    expect(all[0].level).toBe('warn')
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('logger.error 写入 LogStore 并调用 console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('git', 'error msg', new Error('boom'))
    const all = logStore.getAll()
    expect(all[0].level).toBe('error')
    expect(all[0].args).toHaveLength(1)
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('logger.debug 写入 LogStore 并调用 console.debug', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    logger.debug('editor', 'debug msg')
    expect(logStore.getAll()[0].level).toBe('debug')
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('logger.trace 写入 LogStore 并调用 console.trace', () => {
    const consoleSpy = vi.spyOn(console, 'trace').mockImplementation(() => {})
    logger.trace('plugin', 'trace msg')
    expect(logStore.getAll()[0].level).toBe('trace')
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('每条日志带 timestamp（epoch ms）', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const before = Date.now()
    logger.info('test', 'timestamped')
    const after = Date.now()
    const entry = logStore.getAll()[0]
    expect(entry.timestamp).toBeGreaterThanOrEqual(before)
    expect(entry.timestamp).toBeLessThanOrEqual(after)
  })
})

describe('logger: 文件写入 (AC-1e)', () => {
  beforeEach(() => {
    logStore.clear()
    setFileWriter(null)
  })

  afterEach(() => {
    setFileWriter(null)
  })

  it('无 fileWriter 时不 throw，仍写 LogStore + console', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => logger.info('test', 'no writer')).not.toThrow()
    expect(logStore.getAll()).toHaveLength(1)
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('有 fileWriter 时调用 fileWriter(level, message)', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const writer = vi.fn()
    setFileWriter(writer)

    logger.info('app', 'file write test')

    expect(writer).toHaveBeenCalledOnce()
    expect(writer).toHaveBeenCalledWith('info', '[app] file write test')
    // 有 fileWriter 时不直接写 LogStore（由后端 log://log 事件监听器统一写入，避免重复）
    expect(logStore.getAll()).toHaveLength(0)
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('fileWriter 抛错时不 throw，降级为直接写 LogStore + console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const writer = vi.fn().mockImplementation(() => {
      throw new Error('IPC failed')
    })
    setFileWriter(writer)

    expect(() => logger.error('git', 'boom')).not.toThrow()
    // fileWriter 抛错时降级为直接写 LogStore
    expect(logStore.getAll()).toHaveLength(1)
    // console.error 被调用两次：一次是 logger 自身转发，一次是 fileWriter 错误降级
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('createPluginLogger (AC-7)', () => {
  beforeEach(() => {
    logStore.clear()
  })

  it('info 写入 LogStore 且 source 带 plugin: 前缀', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const pluginLog = createPluginLogger('com.foo')
    pluginLog.info('hello from plugin')
    const entry = logStore.getAll()[0]
    expect(entry.source).toBe('plugin:com.foo')
    expect(entry.message).toBe('hello from plugin')
    expect(entry.level).toBe('info')
  })

  it('error 写入 LogStore 且 source 带 plugin: 前缀', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pluginLog = createPluginLogger('com.bar')
    pluginLog.error('plugin failed', new Error('crash'))
    const entry = logStore.getAll()[0]
    expect(entry.source).toBe('plugin:com.bar')
    expect(entry.level).toBe('error')
  })

  it('5 级方法都可调用', () => {
    vi.spyOn(console, 'trace').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pluginLog = createPluginLogger('com.test')
    pluginLog.trace('t')
    pluginLog.debug('d')
    pluginLog.info('i')
    pluginLog.warn('w')
    pluginLog.error('e')
    const all = logStore.getAll()
    expect(all.map((e) => e.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error'])
    expect(all.every((e) => e.source === 'plugin:com.test')).toBe(true)
  })
})
