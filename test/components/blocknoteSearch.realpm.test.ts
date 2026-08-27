/**
 * findAllMatches 真实 ProseMirror document 集成测试
 * 不使用 mock,用 prosemirror-model 创建真实 doc > paragraph > text 结构
 * 验证 nodesBetween 的真实递归行为
 */
import { describe, it, expect } from 'vitest'
import { Schema, Node } from 'prosemirror-model'
import { findAllMatches } from '@/components/editors/blocknoteSearch'

// 简单 schema: doc > paragraph > text,与 BlockNote 段落结构一致
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
})

function makeDoc(text: string): Node {
  return schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : []),
  ])
}

function makeMultiParagraphDoc(): Node {
  return schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('hello world')]),
    schema.node('paragraph', null, [schema.text('hello again')]),
  ])
}

describe('findAllMatches (真实 ProseMirror document)', () => {
  it('应在单段落文档中找到匹配', () => {
    const doc = makeDoc('hello world hello')
    const matches = findAllMatches(doc as any, 'hello', { caseSensitive: false })
    // doc pos: 0=doc开始, 1=paragraph内容开始
    // "hello" 在 pos 1-6 和 pos 13-18
    expect(matches).toEqual([
      { from: 1, to: 6 },
      { from: 13, to: 18 },
    ])
  })

  it('应在多段落文档中找到所有段落的匹配', () => {
    const doc = makeMultiParagraphDoc()
    const matches = findAllMatches(doc as any, 'hello', { caseSensitive: false })
    // 段落1 nodeSize=13(2+11),占 pos 0-13; 内容 "hello world" 在 pos 1-12
    // 段落2 从 pos 13 开始,内容 "hello again" 在 pos 14-25
    // "hello" 在段落1: pos 1-6, 段落2: pos 14-19
    expect(matches.length).toBe(2)
    expect(matches[0]).toEqual({ from: 1, to: 6 })
    expect(matches[1]).toEqual({ from: 14, to: 19 })
  })

  it('空查询应返回空数组', () => {
    const doc = makeDoc('hello world')
    expect(findAllMatches(doc as any, '', { caseSensitive: false })).toEqual([])
  })

  it('无匹配应返回空数组', () => {
    const doc = makeDoc('hello world')
    expect(findAllMatches(doc as any, 'xyz', { caseSensitive: false })).toEqual([])
  })

  it('应支持大小写敏感', () => {
    const doc = makeDoc('Hello HELLO hello')
    const insensitive = findAllMatches(doc as any, 'hello', { caseSensitive: false })
    const sensitive = findAllMatches(doc as any, 'hello', { caseSensitive: true })
    expect(insensitive.length).toBe(3)
    expect(sensitive).toEqual([{ from: 13, to: 18 }])
  })
})
