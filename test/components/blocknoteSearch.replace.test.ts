/**
 * BlockNote 替换逻辑真实集成测试
 * 用真实 BlockNoteEditor 验证 replaceCurrentMatch / replaceAllMatches
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import {
  getBNProseMirrorView,
  findAllMatches,
  replaceCurrentMatch,
  replaceAllMatches,
} from '@/components/editors/blocknoteSearch'

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }
})

describe('blocknoteSearch replace (真实 BlockNoteEditor)', () => {
  let editor: BlockNoteEditor

  beforeEach(() => {
    editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
  })

  afterEach(() => {
    editor._tiptapEditor.destroy()
  })

  it('replaceCurrentMatch 应替换当前匹配', () => {
    const view = getBNProseMirrorView(editor)
    expect(view).not.toBeNull()
    const matches = findAllMatches(view!.state.doc as any, 'hello', { caseSensitive: false })
    expect(matches.length).toBe(2)

    replaceCurrentMatch(view!, matches, 'hi')

    const text = view!.state.doc.textBetween(0, view!.state.doc.content.size)
    expect(text).toBe('hi world hello')
  })

  it('replaceAllMatches 应替换所有匹配', () => {
    const view = getBNProseMirrorView(editor)
    expect(view).not.toBeNull()
    const matches = findAllMatches(view!.state.doc as any, 'hello', { caseSensitive: false })

    const count = replaceAllMatches(view!, matches, 'hi')

    expect(count).toBe(2)
    const text = view!.state.doc.textBetween(0, view!.state.doc.content.size)
    expect(text).toBe('hi world hi')
  })
})
