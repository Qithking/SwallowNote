/**
 * cursor-anchor 回归测试（dev-fix：光标位置恢复）。
 *
 * 锚点结构 = PM 光标位置 + 前后各 20 字符上下文纯文本；
 * 恢复时上下文校验失败（文档被外部修改）则跳过，避免光标落到错误位置。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  captureCursorAnchor,
  validateCursorAnchor,
  setCursorAnchorCache,
  getCursorAnchorCache,
  clearCursorAnchorCache,
} from '../cursor-anchor'
import type { CursorAnchor } from '../cursor-anchor'

/** 简易 PM doc mock：pos i 映射到 text[i-1]（pos=1 为文本起点），无块分隔 */
function makeDoc(text: string) {
  return {
    content: { size: text.length + 2 },
    textBetween(from: number, to: number, _blockSeparator?: string, _leafText?: string | null) {
      const s = Math.max(0, from - 1)
      const e = Math.max(s, Math.min(to - 1, text.length))
      return text.slice(s, e)
    },
  }
}

describe('captureCursorAnchor', () => {
  it('捕获光标位置与前后上下文（窗口各 20 字符）', () => {
    const text = 'A'.repeat(30) + 'CURSOR' + 'B'.repeat(30)
    const doc = makeDoc(text)
    const pos = 31 // mock 中 pos i → text[i-1]，pos=31 即 'C' 之前
    const anchor = captureCursorAnchor({ from: pos, to: pos }, doc)

    expect(anchor.pos).toBe(pos)
    expect(anchor.before.length).toBeLessThanOrEqual(20)
    expect(anchor.after.length).toBeLessThanOrEqual(20)
    expect(anchor.before).toBe('A'.repeat(20))
    expect(anchor.after.startsWith('CURSOR')).toBe(true)
  })

  it('文档起点处 before 为空、pos clamp 到 [0, size]', () => {
    const doc = makeDoc('hello world')
    const anchor = captureCursorAnchor({ from: 1, to: 1 }, doc)
    expect(anchor.pos).toBe(1)
    expect(anchor.before).toBe('')
    expect(anchor.after.startsWith('hello')).toBe(true)
  })

  it('pos 超界时 clamp 到 content.size', () => {
    const doc = makeDoc('hello')
    const anchor = captureCursorAnchor({ from: 999, to: 999 }, doc)
    expect(anchor.pos).toBe(7) // content.size = 5 + 2
  })
})

describe('validateCursorAnchor', () => {
  const text = 'A'.repeat(30) + 'CURSOR' + 'B'.repeat(30)

  it('文档未变时校验通过', () => {
    const doc = makeDoc(text)
    const anchor = captureCursorAnchor({ from: 31, to: 31 }, doc)
    expect(validateCursorAnchor(doc, anchor)).toBe(true)
  })

  it('文档被外部修改（光标附近内容变化）时校验失败', () => {
    const doc = makeDoc(text)
    const anchor = captureCursorAnchor({ from: 31, to: 31 }, doc)
    const modified = makeDoc(text.replace('CURSOR', 'REDACTED'))
    expect(validateCursorAnchor(modified, anchor)).toBe(false)
  })

  it('pos 超出新文档边界时校验失败', () => {
    const doc = makeDoc(text)
    const anchor = captureCursorAnchor({ from: 31, to: 31 }, doc)
    const shorter = makeDoc('short')
    expect(validateCursorAnchor(shorter, anchor)).toBe(false)
  })

  it('null 锚点与非法 pos 校验失败', () => {
    const doc = makeDoc(text)
    expect(validateCursorAnchor(doc, null)).toBe(false)
    expect(validateCursorAnchor(doc, undefined)).toBe(false)
    expect(validateCursorAnchor(doc, { pos: -1, before: '', after: '' })).toBe(false)
    expect(validateCursorAnchor(doc, { pos: 1.5, before: '', after: '' })).toBe(false)
  })
})

describe('cursor anchor 缓存', () => {
  beforeEach(() => {
    clearCursorAnchorCache('tab-1')
  })

  it('set/get/clear 基本语义', () => {
    const anchor: CursorAnchor = { pos: 3, before: 'ab', after: 'cd' }
    expect(getCursorAnchorCache('tab-1')).toBeUndefined()
    setCursorAnchorCache('tab-1', anchor)
    expect(getCursorAnchorCache('tab-1')).toBe(anchor)
    clearCursorAnchorCache('tab-1')
    expect(getCursorAnchorCache('tab-1')).toBeUndefined()
  })
})
