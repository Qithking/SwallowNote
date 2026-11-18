/**
 * BUG: 插件后端子进程 stderr/stdout 已进统一日志，但 source 列显示 Rust 模块名
 * （swallownote_lib::commands::plugin_invoke），看不出是哪个插件 —— 用户诉求
 * 「应用日志要能查看所有应用能力日志（含插件）」的来源可辨识性缺口。
 *
 * 行为契约: attachLogger 解析 Rust 原生日志时，若 message 带 [plugin:<id>] 前缀
 * （plugin_invoke.rs 的 stderr/stdout 采集形态），source 必须重分类为 plugin:<id>。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 捕获 attachLogger 注册的回调（logger.ts 经动态 import 使用）
let rustLogHandler: ((data: { message: string; level: number }) => void) | null = null

vi.mock('@tauri-apps/plugin-log', () => ({
  trace: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
  attachLogger: vi.fn((handler: (data: { message: string; level: number }) => void) => {
    rustLogHandler = handler
    return Promise.resolve(() => {})
  }),
}))

import { attachLogger, logStore, type LogEntry } from '@/lib/logger'

const RUST_TS_PREFIX = '[2026-11-18] [09:00:00]'

function lastEntry(): LogEntry {
  const all = logStore.getAll()
  return all[all.length - 1]
}

describe('BUG: 插件后端日志 source 必须重分类为 plugin:<id>', () => {
  beforeEach(async () => {
    logStore.clear()
    rustLogHandler = null
    await attachLogger()
    if (!rustLogHandler) throw new Error('attachLogger 回调未注册')
  })

  it('stderr 形态 [plugin:<id>] 前缀 → source=plugin:<id>，message 剥离前缀', () => {
    rustLogHandler!({
      message: `${RUST_TS_PREFIX}[INFO][swallownote_lib::commands::plugin_invoke] [plugin:com.test.app] backend says hi`,
      level: 3,
    })
    const entry = lastEntry()
    expect(entry.source).toBe('plugin:com.test.app')
    expect(entry.message).toBe('backend says hi')
    expect(entry.level).toBe('info')
  })

  it('stdout 裸 print 形态 [plugin:<id>] (stdout) 前缀同样重分类', () => {
    rustLogHandler!({
      message: `${RUST_TS_PREFIX}[INFO][swallownote_lib::commands::plugin_invoke] [plugin:com.test.app] (stdout) plain print line`,
      level: 3,
    })
    const entry = lastEntry()
    expect(entry.source).toBe('plugin:com.test.app')
    // (stdout) 标记保留在 message 中，区分裸 print 与 stderr
    expect(entry.message).toBe('(stdout) plain print line')
  })

  it('普通 Rust 日志不带 plugin 前缀 → source 保持 Rust target（不回归）', () => {
    rustLogHandler!({
      message: `${RUST_TS_PREFIX}[DEBUG][swallownote_lib::git::scan] scan finished`,
      level: 2,
    })
    const entry = lastEntry()
    expect(entry.source).toBe('swallownote_lib::git::scan')
    expect(entry.message).toBe('scan finished')
  })
})
