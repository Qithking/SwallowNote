/**
 * BlockNote 替换 marks 保留测试
 * Source: plan/editor-find-replace step 1, AC-16
 */
import { describe, it, expect } from 'vitest'
import { Schema, Node } from 'prosemirror-model'
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import { replaceCurrentMatch, replaceAllMatches, findAllMatches } from '@/components/editors/blocknoteSearch'

// 带 marks 的 schema,模拟 BlockNote 常见 marks
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
  marks: {
    strong: { toDOM: () => ['strong', 0] },
    em: { toDOM: () => ['em', 0] },
    link: {
      attrs: { href: {} },
      toDOM: mark => ['a', { href: mark.attrs.href }, 0],
    },
  },
})

function makeDoc(children: Node[]): Node {
  return schema.node('doc', null, [schema.node('paragraph', null, children)])
}

function createView(doc: Node): EditorView {
  return new EditorView(null, {
    state: EditorState.create({ doc }),
  })
}

describe('replaceCurrentMatch preserves marks', () => {
  it('应保留粗体 mark', () => {
    const bold = schema.mark('strong')
    const doc = makeDoc([schema.text('hello world', [bold])])
    const view = createView(doc)
    const matches = findAllMatches(view.state.doc as any, 'hello', { caseSensitive: false })
    expect(matches.length).toBe(1)

    replaceCurrentMatch(view as any, matches, 'hi')

    const paragraph = view.state.doc.child(0)
    expect(paragraph.textContent).toBe('hi world')
    // 替换后的文本节点与剩余 mark 文本合并为一个节点,因此检查合并后的节点带 mark
    const mergedNode = paragraph.child(0)
    expect(mergedNode.text).toBe('hi world')
    expect(mergedNode.marks.some(m => m.type.name === 'strong')).toBe(true)
  })

  it('应保留链接 mark 及其 href 属性', () => {
    const link = schema.mark('link', { href: 'https://example.com' })
    const doc = makeDoc([schema.text('hello world', [link])])
    const view = createView(doc)
    const matches = findAllMatches(view.state.doc as any, 'hello', { caseSensitive: false })

    replaceCurrentMatch(view as any, matches, 'hi')

    const mergedNode = view.state.doc.child(0).child(0)
    expect(mergedNode.text).toBe('hi world')
    const linkMark = mergedNode.marks.find(m => m.type.name === 'link')
    expect(linkMark).toBeDefined()
    expect(linkMark?.attrs.href).toBe('https://example.com')
  })

  it('无 marks 的纯文本替换后不应凭空添加 marks', () => {
    const doc = makeDoc([schema.text('hello world')])
    const view = createView(doc)
    const matches = findAllMatches(view.state.doc as any, 'hello', { caseSensitive: false })

    replaceCurrentMatch(view as any, matches, 'hi')

    const paragraph = view.state.doc.child(0)
    expect(paragraph.textContent).toBe('hi world')
    // ProseMirror 会合并相邻无 mark 文本节点,因此检查所有子节点均无 marks
    for (let i = 0; i < paragraph.childCount; i++) {
      expect(paragraph.child(i).marks.length).toBe(0)
    }
  })
})

describe('replaceAllMatches preserves marks', () => {
  it('应保留每个匹配位置的 mark', () => {
    const bold = schema.mark('strong')
    const doc = makeDoc([schema.text('hello world hello', [bold])])
    const view = createView(doc)
    const matches = findAllMatches(view.state.doc as any, 'hello', { caseSensitive: false })
    expect(matches.length).toBe(2)

    replaceAllMatches(view as any, matches, 'hi')

    const paragraph = view.state.doc.child(0)
    expect(paragraph.textContent).toBe('hi world hi')
    const mergedNode = paragraph.child(0)
    expect(mergedNode.text).toBe('hi world hi')
    expect(mergedNode.marks.some(m => m.type.name === 'strong')).toBe(true)
  })
})
