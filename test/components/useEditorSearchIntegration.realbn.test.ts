/**
 * useEditorSearchIntegration BlockNote 端到端测试
 * 用真实 BlockNoteEditor 验证事件桥接: query 事件 → match-count 事件
 * 不渲染完整 MarkdownEditor(避免 jsdom 缺少 getClientRects)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { BlockNoteEditor } from '@blocknote/core'
import { useEditorSearchIntegration } from '@/components/editors/useEditorSearchIntegration'

// jsdom 缺少 matchMedia
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

describe('useEditorSearchIntegration BlockNote 端到端', () => {
  let editor: BlockNoteEditor
  let matchCountHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    matchCountHandler = vi.fn()
    window.addEventListener('editor:find-replace:match-count', matchCountHandler)
  })

  afterEach(() => {
    window.removeEventListener('editor:find-replace:match-count', matchCountHandler)
    editor._tiptapEditor.destroy()
  })

  it('BlockNote 模式: query 事件应触发 match-count 事件,total=2', () => {
    renderHook(() => useEditorSearchIntegration({
      editorType: 'blocknote',
      editor,
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
        detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
      }))
    })

    expect(matchCountHandler).toHaveBeenCalled()
    const lastCall = matchCountHandler.mock.calls[matchCountHandler.mock.calls.length - 1][0]
    expect(lastCall.detail.total).toBe(2)
    expect(lastCall.detail.current).toBe(1)
  })

  it('BlockNote 模式: 空查询应触发 total=0', () => {
    renderHook(() => useEditorSearchIntegration({
      editorType: 'blocknote',
      editor,
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
        detail: { text: '', caseSensitive: false, wholeWord: false, regexp: false },
      }))
    })

    expect(matchCountHandler).toHaveBeenCalled()
    const lastCall = matchCountHandler.mock.calls[matchCountHandler.mock.calls.length - 1][0]
    expect(lastCall.detail.total).toBe(0)
  })

  it('BlockNote 模式: find-next 事件应工作', () => {
    renderHook(() => useEditorSearchIntegration({
      editorType: 'blocknote',
      editor,
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
        detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
      }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
    })

    // find-next 应触发 match-count 更新
    expect(matchCountHandler).toHaveBeenCalled()
    const lastCall = matchCountHandler.mock.calls[matchCountHandler.mock.calls.length - 1][0]
    expect(lastCall.detail.total).toBe(2)
  })
})
