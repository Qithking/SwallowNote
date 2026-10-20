/**
 * logger 文件日志序列化测试。
 *
 * 根因（fix/logger-args-dropped）：writeLog 的 formatted 只拼 message 丢弃 args，
 * 导致所有 logger.xxx(source, msg, ...args) 的详情（含 Error 对象）不写入文件日志，
 * 文件中只剩消息前缀（如 "[app] Auto sync failed:" 后全空）。
 * 回归目标：fileWriter 收到的 message 必须包含 args 序列化结果；
 * Error 保留 name/message/stack；循环引用不崩；无 args 时无尾随空格。
 *
 * 回流解析（fix/backend-log-duplicate-datetime）：attachLogger 对 Rust 原生日志
 * （[YYYY-MM-DD] [HH:MM:SS][LEVEL][target] text）须剥离日期/时间/级别前缀并提取
 * target 作为 source——此前日期被误当 source，时间/级别残留在 message，
 * 与日志查看器行首前端时间戳重复显示。
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { logger, setFileWriter, attachLogger, logStore, type LogLevel } from '../logger'

/** 捕获 fileWriter 收到的 (level, message) 调用 */
function captureFileWriter() {
  const calls: Array<{ level: LogLevel; message: string }> = []
  setFileWriter((level, message) => {
    calls.push({ level, message })
  })
  return calls
}

describe('writeLog 文件日志序列化', () => {
  beforeEach(() => {
    logStore.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setFileWriter(null)
  })

  it('args 详情必须写入文件日志（此前只写 message 前缀）', () => {
    const calls = captureFileWriter()

    logger.error('app', 'Auto sync failed:', 'repoA [NO_REMOTE] pull failed', 'pushPaths: x')

    expect(calls).toHaveLength(1)
    expect(calls[0].level).toBe('error')
    expect(calls[0].message).toContain('[app] Auto sync failed:')
    // 修复点：args 详情进入文件日志
    expect(calls[0].message).toContain('repoA [NO_REMOTE] pull failed')
    expect(calls[0].message).toContain('pushPaths: x')
  })

  it('Error 对象序列化保留 name/message/stack（此前文件中丢失）', () => {
    const calls = captureFileWriter()
    const err = new Error('git invoke rejected')

    logger.error('app', 'Auto sync failed:', err)

    expect(calls[0].message).toContain('Error: git invoke rejected')
    expect(calls[0].message).toContain('at ')
  })

  it('循环引用对象序列化不崩且降级为 String()', () => {
    const calls = captureFileWriter()
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic

    expect(() => logger.warn('app', 'cyclic:', cyclic)).not.toThrow()
    expect(calls[0].message).toContain('cyclic:')
  })

  it('无 args 时文件日志无尾随空格', () => {
    const calls = captureFileWriter()

    logger.info('app', 'plain message')

    expect(calls[0].message).toBe('[app] plain message')
  })

  it('logStore 内存路径仍保留原始 args 对象（LogViewer 依赖）', () => {
    captureFileWriter()
    setFileWriter(null) // 走无 fileWriter 降级路径，直接写 logStore
    const detail = { code: 'NO_REMOTE' }

    logger.error('app', 'msg with object', detail)

    const entries = logStore.getAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].args?.[0]).toBe(detail)
  })
})

describe('attachLogger 后端日志回流解析', () => {
  // 共享 handler 数组：beforeAll 中 doMock 后首次动态 import 生效（勿在此 describe restore mocks）
  const handlers: Array<(payload: { message: string; level: number }) => void> = []

  beforeAll(async () => {
    vi.doMock('@tauri-apps/plugin-log', () => ({
      trace: vi.fn(async () => {}),
      debug: vi.fn(async () => {}),
      info: vi.fn(async () => {}),
      warn: vi.fn(async () => {}),
      error: vi.fn(async () => {}),
      attachLogger: vi.fn(async (h: (payload: { message: string; level: number }) => void) => {
        handlers.push(h)
      }),
    }))
    await attachLogger()
  })

  beforeEach(() => {
    // 清理前一 describe 用例残留，保证 logStore 断言隔离
    logStore.clear()
  })

  afterEach(() => {
    logStore.clear()
  })

  it('Rust 原生格式剥离日期/时间/级别前缀，target 作为 source，日期时间不再重复', () => {
    handlers.at(-1)!({
      message: '[2026-10-20] [16:45:17][DEBUG][swallownote_lib::commands::git::scan] [DIAG] get_remote_url path=/tmp url=`http://x`',
      level: 2,
    })

    const entries = logStore.getAll()
    expect(entries).toHaveLength(1)
    // source = Rust target（不再是日期 2026-10-20）
    expect(entries[0].source).toBe('swallownote_lib::commands::git::scan')
    // message 剥离日期/时间/级别，业务标记 [DIAG] 保留
    expect(entries[0].message).toBe('[DIAG] get_remote_url path=/tmp url=`http://x`')
    expect(entries[0].message).not.toContain('2026-10-20')
    expect(entries[0].message).not.toContain('16:45:17')
    expect(entries[0].level).toBe('debug')
  })

  it('前端回流格式 [source] text 解析不回归', () => {
    handlers.at(-1)!({ message: '[app] Auto sync failed: detail', level: 5 })

    const entries = logStore.getAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].source).toBe('app')
    expect(entries[0].message).toBe('Auto sync failed: detail')
    expect(entries[0].level).toBe('error')
  })
})
