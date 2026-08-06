/**
 * AIView 工具函数拆分验证测试
 *
 * 行为契约: getMessageText 与 formatTimeStr 从 AIView.tsx 迁移到
 * src/lib/ai-utils.ts 后行为保持不变。
 *
 * Source: plan/large-file-split-batch step 21
 */
import { describe, it, expect } from 'vitest'
import { getMessageText, formatTimeStr } from '@/lib/ai-utils'

describe('ai-utils: getMessageText', () => {
  it('拼接所有 text 类型 parts', () => {
    expect(
      getMessageText({
        parts: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab')
  })

  it('过滤非 text 类型 parts', () => {
    expect(
      getMessageText({
        parts: [
          { type: 'text', text: 'a' },
          { type: 'reasoning' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab')
  })

  it('无非 text parts 返回空字符串', () => {
    expect(getMessageText({ parts: [{ type: 'other' }] })).toBe('')
  })

  it('空 parts 数组返回空字符串', () => {
    expect(getMessageText({ parts: [] })).toBe('')
  })

  it('缺少 parts 字段返回空字符串', () => {
    expect(getMessageText({})).toBe('')
  })

  it('保留含空格的文本', () => {
    expect(getMessageText({ parts: [{ type: 'text', text: 'hello world' }] })).toBe('hello world')
  })
})

describe('ai-utils: formatTimeStr', () => {
  it('从完整时间戳提取 HH:MM:SS', () => {
    expect(formatTimeStr('2026-01-02 03:04:05')).toBe('03:04:05')
  })

  it('空字符串返回空字符串', () => {
    expect(formatTimeStr('')).toBe('')
  })

  it('无匹配时间模式时返回原字符串', () => {
    expect(formatTimeStr('no-time-here')).toBe('no-time-here')
  })

  it('已是 HH:MM:SS 格式保持不变', () => {
    expect(formatTimeStr('12:30:45')).toBe('12:30:45')
  })

  it('不匹配非两位数字的时间片段时返回原字符串', () => {
    expect(formatTimeStr('1:2:3')).toBe('1:2:3')
  })
})
