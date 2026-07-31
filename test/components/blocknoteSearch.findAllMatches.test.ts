/**
 * buildFindDecorations 测试:扫描文档构建查找高亮位置
 * Source: plan/editor-find-replace step 6
 */
import { describe, it, expect } from 'vitest'
import { findAllMatches } from '@/components/editors/blocknoteSearch'

// 最小 ProseMirror doc mock:模拟 doc > paragraph > text 嵌套结构
// nodesBetween 先访问段落节点(非文本),回调返回 false 时不递归进入子节点
function makeDoc(text: string) {
  return {
    textBetween: (from: number, to: number) => text.slice(from, to),
    nodesBetween: (_from: number, _to: number, onNode: (node: any, pos: number) => boolean | void) => {
      // 段落节点(pos=0,非文本)
      const shouldRecurse = onNode({ isText: false, text: null, childCount: 1 }, 0)
      if (shouldRecurse !== false) {
        // 文本节点(pos=0,简化:与段落共享 pos 使匹配位置从 0 开始)
        onNode({ text, isText: true, childCount: 0 }, 0)
      }
    },
    nodeSize: text.length,
    content: { size: text.length },
  } as any
}

// 模拟两段文本的 ProseMirror doc:
// doc pos 0-1 为文档边界,pos 1-6 为第一段 "Hello",
// pos 6-7 为段落边界,pos 8-13 为第二段 "World",pos 13-14 为文档结束。
// textBetween 返回 "Hello\nWorld"(与真实 ProseMirror 行为一致)。
function makeTwoParagraphDoc() {
  return {
    textBetween: (_from: number, _to: number, blockSeparator?: string) =>
      `Hello${blockSeparator ?? ''}World`,
    nodesBetween: (_from: number, _to: number, onNode: (node: any, pos: number) => boolean | void) => {
      // 段落 1 (pos=0)
      const recurse1 = onNode({ isText: false, text: null, childCount: 1 }, 0)
      if (recurse1 !== false) {
        onNode({ text: 'Hello', isText: true, childCount: 0 }, 1)
      }
      // 段落 2 (pos=7)
      const recurse2 = onNode({ isText: false, text: null, childCount: 1 }, 7)
      if (recurse2 !== false) {
        onNode({ text: 'World', isText: true, childCount: 0 }, 8)
      }
    },
    nodeSize: 14,
    content: { size: 12 },
  } as any
}

describe('findAllMatches', () => {
  it('should return empty array for empty query', () => {
    const doc = makeDoc('hello world')
    expect(findAllMatches(doc, '', { caseSensitive: false })).toEqual([])
  })

  it('should return empty array for no match', () => {
    const doc = makeDoc('hello world')
    expect(findAllMatches(doc, 'xyz', { caseSensitive: false })).toEqual([])
  })

  it('should find single match', () => {
    const doc = makeDoc('hello world')
    const matches = findAllMatches(doc, 'hello', { caseSensitive: false })
    expect(matches).toEqual([{ from: 0, to: 5 }])
  })

  it('should find multiple matches', () => {
    const doc = makeDoc('foo bar foo baz foo')
    const matches = findAllMatches(doc, 'foo', { caseSensitive: false })
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
      { from: 16, to: 19 },
    ])
  })

  it('should find overlapping-safe matches (non-overlapping)', () => {
    const doc = makeDoc('aaa')
    const matches = findAllMatches(doc, 'aa', { caseSensitive: false })
    // 非重叠匹配:只匹配 [0,2],不匹配 [1,3]
    expect(matches).toEqual([{ from: 0, to: 2 }])
  })

  it('should be case-insensitive when caseSensitive=false', () => {
    const doc = makeDoc('Hello HELLO hello')
    const matches = findAllMatches(doc, 'hello', { caseSensitive: false })
    expect(matches).toHaveLength(3)
    expect(matches[0]).toEqual({ from: 0, to: 5 })
    expect(matches[1]).toEqual({ from: 6, to: 11 })
    expect(matches[2]).toEqual({ from: 12, to: 17 })
  })

  it('should be case-sensitive when caseSensitive=true', () => {
    const doc = makeDoc('Hello HELLO hello')
    const matches = findAllMatches(doc, 'hello', { caseSensitive: true })
    expect(matches).toEqual([{ from: 12, to: 17 }])
  })

  it('should return doc positions for multi-paragraph document (not text positions)', () => {
    const doc = makeTwoParagraphDoc()
    const matches = findAllMatches(doc, 'World', { caseSensitive: false })
    // 文本偏移中 World 位于 6-11,但 doc 偏移应为 8-13(两段结构)
    expect(matches).toEqual([{ from: 8, to: 13 }])
  })
})
