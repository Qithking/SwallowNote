/**
 * Bug fix: 后端日志不进入 LogStore
 *
 * Root cause: attachLogger() 只设置 fileWriter 转发前端日志到后端文件，
 * 但没有监听后端 emit 的 `log://log` 事件，导致后端 Rust 日志不进 logStore。
 *
 * Expected: attachLogger() 后，后端 emit log://log 事件时，logStore 应收到该日志。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logStore, setFileWriter } from '@/lib/logger'

// 捕获 listen 注册的回调，模拟后端 emit 事件
let logEventListener: ((event: { payload: { level: number; message: string } }) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (event: unknown) => void) => {
    if (event === 'log://log') {
      logEventListener = cb as typeof logEventListener
    }
    return () => { logEventListener = null }
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

// mock @tauri-apps/plugin-log —— attachLogger 会动态 import
vi.mock('@tauri-apps/plugin-log', () => ({
  trace: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
  // 插件的 attachLogger 用于监听后端日志事件
  attachLogger: vi.fn(async (fn: (entry: { message: string; level: number }) => void) => {
    logEventListener = ((event: { payload: { level: number; message: string } }) => {
      fn({ message: event.payload.message, level: event.payload.level })
    }) as typeof logEventListener
    return () => { logEventListener = null }
  }),
  attachConsole: vi.fn().mockResolvedValue(() => {}),
  LogLevel: { Trace: 1, Debug: 2, Info: 3, Warn: 4, Error: 5 },
}))

describe('Bug: 后端日志不进入 LogStore', () => {
  beforeEach(() => {
    logStore.clear()
    setFileWriter(null)
    logEventListener = null
  })

  it('attachLogger 后，后端 emit log://log 事件应写入 logStore', async () => {
    const { attachLogger } = await import('@/lib/logger')
    await attachLogger()

    // 模拟后端 Rust 日志: log::info!("backend started")
    expect(logEventListener).not.toBeNull()
    logEventListener!({ payload: { level: 3, message: 'backend started' } })

    const all = logStore.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].message).toBe('backend started')
    expect(all[0].level).toBe('info')
    expect(all[0].source).toBe('backend')
  })

  it('attachLogger 后，后端 error 日志应写入 logStore 且 level=error', async () => {
    const { attachLogger } = await import('@/lib/logger')
    await attachLogger()

    logEventListener!({ payload: { level: 5, message: 'git push failed' } })

    const all = logStore.getAll()
    expect(all[0].message).toBe('git push failed')
    expect(all[0].level).toBe('error')
  })
})
