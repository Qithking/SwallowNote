/**
 * BlockNote 搜索真实集成测试
 * 用真实 BlockNoteEditor 验证 getBNProseMirrorView + findAllMatches 端到端
 * 不使用 mock,捕获生产环境真实行为
 */
import { describe, it, expect, vi } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { getBNProseMirrorView, findAllMatches } from '@/components/editors/blocknoteSearch'

// 真实 BlockNoteEditor 创建可能需要 DOM,jsdom 环境应足够
describe('BlockNote 搜索真实集成', () => {
  it('getBNProseMirrorView 应从真实 BlockNoteEditor 取出 ProseMirror view', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    try {
      const view = getBNProseMirrorView(editor)
      // 真实 BlockNoteEditor 必须有 _tiptapEditor.view
      expect(view).not.toBeNull()
      expect(view!.state.doc).toBeDefined()
      expect(view!.state.doc.content).toBeDefined()
      expect(view!.state.doc.content.size).toBeGreaterThan(0)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })

  it('findAllMatches 应在真实 BlockNote doc 中找到匹配', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    try {
      const view = getBNProseMirrorView(editor)
      expect(view).not.toBeNull()
      const matches = findAllMatches(view!.state.doc as any, 'hello', { caseSensitive: false })
      // "hello" 出现 2 次
      expect(matches.length).toBe(2)
      // 验证位置在合理范围内(doc 内)
      const docSize = view!.state.doc.content.size
      matches.forEach(m => {
        expect(m.from).toBeGreaterThanOrEqual(0)
        expect(m.to).toBeLessThanOrEqual(docSize)
      })
    } finally {
      editor._tiptapEditor.destroy()
    }
  })

  it('findAllMatches 应在多段落真实 BlockNote doc 中找到所有匹配', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello again' }] },
      ],
    })
    try {
      const view = getBNProseMirrorView(editor)
      expect(view).not.toBeNull()
      const matches = findAllMatches(view!.state.doc as any, 'hello', { caseSensitive: false })
      expect(matches.length).toBe(2)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })
})
