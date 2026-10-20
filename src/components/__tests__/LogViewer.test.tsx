/**
 * LogViewer 测试。
 *
 * 行为 1（B1）：时间戳格式化输出「YYYY-MM-DD HH:MM:SS.mmm」——
 * 此前只有 HH:MM:SS.mmm 无日期，用户要求每行按「日期 时间 日志类型 日志详情」顺序显示。
 * 行为 2（B2）：行渲染四段顺序「日期时间 → 级别 → [source] message 详情」——
 * 来源并入详情列，与文件日志格式一致。
 * 行为 3（B3）：新增「全部」级别按钮，点击恢复全选。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LogViewer as LogViewerComponent } from '../LogViewer'
import type { LogViewerProps } from '../LogViewer'
import { formatLogTimestamp } from '../logViewerUtils'
import { logStore } from '@/lib/logger'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => null),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

function seedLogStore() {
  logStore.clear()
  logStore.push({
    timestamp: new Date(2026, 9, 20, 16, 24, 18, 123).getTime(),
    level: 'error',
    source: 'app',
    message: 'Auto sync failed: detail',
  })
  logStore.push({
    timestamp: new Date(2026, 9, 20, 16, 25, 0, 0).getTime(),
    level: 'info',
    source: 'git',
    message: 'push ok',
  })
}

const baseProps: LogViewerProps = { open: true, onOpenChange: () => {} }

describe('formatLogTimestamp', () => {
  // 用本地时间构造（各字段定参），断言与时区无关
  it('输出 日期 时间.毫秒 格式（YYYY-MM-DD HH:MM:SS.mmm）', () => {
    const ts = new Date(2026, 9, 20, 16, 24, 18, 123).getTime()
    expect(formatLogTimestamp(ts)).toBe('2026-10-20 16:24:18.123')
  })

  it('个位数月/日/时/分/秒/毫秒补零', () => {
    const ts = new Date(2026, 0, 5, 3, 7, 9, 42).getTime()
    expect(formatLogTimestamp(ts)).toBe('2026-01-05 03:07:09.042')
  })

  it('毫秒 3 位对齐（1ms → 001）', () => {
    const ts = new Date(2026, 11, 31, 23, 59, 59, 1).getTime()
    expect(formatLogTimestamp(ts)).toBe('2026-12-31 23:59:59.001')
  })
})

describe('LogViewer 行渲染四段顺序', () => {
  beforeEach(() => {
    seedLogStore()
  })

  afterEach(() => {
    logStore.clear()
  })

  it('每行按「日期时间 → 级别 → [source] message 详情」顺序渲染', () => {
    render(<LogViewerComponent {...baseProps} />)

    // radix Dialog 经 portal 渲染到 document.body，从 body 查询
    const rows = Array.from(document.querySelectorAll('[data-log-row]'))
    expect(rows).toHaveLength(2)
    const text = rows[0].textContent || ''
    expect(text).toContain('2026-10-20 16:24:18.123')
    expect(text).toContain('error')
    expect(text).toContain('[app] Auto sync failed: detail')
    // 顺序断言：日期 < 级别 < 详情（详情含 [source] 前缀）
    expect(text.indexOf('2026-10-20')).toBeLessThan(text.indexOf('error'))
    expect(text.indexOf('error')).toBeLessThan(text.indexOf('[app]'))
    // 第二行：来源 git 并入详情
    expect((rows[1].textContent || '')).toContain('[git] push ok')
  })

  it('复制按钮导出的文本与行格式一致（含日期与 [source] 前缀）', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<LogViewerComponent {...baseProps} />)

    fireEvent.click(screen.getByTitle('logViewer.copy'))
    await Promise.resolve()

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = (writeText.mock.calls as unknown as string[][])[0]?.[0] ?? ''
    expect(copied).toContain('2026-10-20 16:24:18.123')
    expect(copied).toContain('[app] Auto sync failed: detail')
    expect(copied.indexOf('2026-10-20')).toBeLessThan(copied.indexOf('error'))
  })
})

describe('LogViewer「全部」级别按钮', () => {
  beforeEach(() => {
    seedLogStore()
  })

  afterEach(() => {
    logStore.clear()
  })

  /** 取过滤按钮组内指定文本的按钮（日志行内也有相同 level 文本） */
  function levelButton(text: string): HTMLElement {
    return screen.getAllByText(text).find((el) => el.tagName === 'BUTTON')!
  }

  it('默认仅「全部」激活、级别均未选，点级别后只看该类型，点「全部」恢复', () => {
    render(<LogViewerComponent {...baseProps} />)

    // 默认态：「全部」激活（data-active="true"），级别按钮均未激活，显示 2 行
    expect(levelButton('logViewer.allLevels').getAttribute('data-active')).toBe('true')
    expect(levelButton('error').getAttribute('data-active')).toBe('false')
    expect(document.querySelectorAll('[data-log-row]')).toHaveLength(2)

    // 点 error → 只看 error 1 行，「全部」取消激活
    fireEvent.click(levelButton('error'))
    expect(document.querySelectorAll('[data-log-row]')).toHaveLength(1)
    expect(levelButton('error').getAttribute('data-active')).toBe('true')
    expect(levelButton('logViewer.allLevels').getAttribute('data-active')).toBe('false')

    // 点「全部」→ 恢复显示所有日志
    fireEvent.click(levelButton('logViewer.allLevels'))
    expect(document.querySelectorAll('[data-log-row]')).toHaveLength(2)
    expect(levelButton('logViewer.allLevels').getAttribute('data-active')).toBe('true')
  })

  it('级别多选保留：error 选中后点 info 同时查看两类', () => {
    render(<LogViewerComponent {...baseProps} />)

    fireEvent.click(levelButton('error'))
    expect(document.querySelectorAll('[data-log-row]')).toHaveLength(1)
    fireEvent.click(levelButton('info'))
    // error + info 两行
    expect(document.querySelectorAll('[data-log-row]')).toHaveLength(2)
    expect(levelButton('error').getAttribute('data-active')).toBe('true')
    expect(levelButton('info').getAttribute('data-active')).toBe('true')
  })
})
