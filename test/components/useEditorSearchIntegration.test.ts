/**
 * useEditorSearchIntegration hook 测试
 *
 * 验证事件桥接:监听 editor:find-replace:* 事件并转发到 EditorSearchAdapter。
 * 改造后 useEditorSearchIntegration 接收统一 adapter,不再区分编辑器类型。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useEditorSearchIntegration,
  setSharedFindReplaceQuery,
  setSharedFindReplaceText,
  type EditorSearchAdapter,
} from '@/components/editors/useEditorSearchIntegration'

function makeMockAdapter(overrides: Partial<EditorSearchAdapter> = {}): EditorSearchAdapter {
  return {
    setQuery: vi.fn(),
    setReplaceText: vi.fn(),
    findNext: vi.fn(),
    findPrev: vi.fn(),
    replaceNext: vi.fn(),
    replaceAll: vi.fn(),
    clear: vi.fn(),
    matchCount: { current: 0, total: 0 },
    ...overrides,
  }
}

describe('useEditorSearchIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSharedFindReplaceQuery('', { caseSensitive: false, wholeWord: false, regexp: false })
    setSharedFindReplaceText('')
  })

  it('监听 editor:find-replace:query 事件应调用 adapter.setQuery', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
      detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
    }))
    expect(adapter.setQuery).toHaveBeenCalledWith('hello', {
      caseSensitive: false, wholeWord: false, regexp: false,
    })
  })

  it('监听 editor:find-replace:find-next 事件应调用 adapter.findNext', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
    expect(adapter.findNext).toHaveBeenCalled()
  })

  it('监听 editor:find-replace:find-prev 事件应调用 adapter.findPrev', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-prev'))
    expect(adapter.findPrev).toHaveBeenCalled()
  })

  it('监听 editor:find-replace:clear 事件应调用 adapter.clear', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
    expect(adapter.clear).toHaveBeenCalled()
  })

  it('监听 editor:find-replace:replace-text 应调用 adapter.setReplaceText', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', {
      detail: { text: 'world' },
    }))
    expect(adapter.setReplaceText).toHaveBeenCalledWith('world')
  })

  it('监听 editor:find-replace:replace-next 应调用 adapter.replaceNext', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-next', {
      detail: { text: 'world' },
    }))
    expect(adapter.replaceNext).toHaveBeenCalledWith('world')
  })

  it('监听 editor:find-replace:replace-all 应调用 adapter.replaceAll', () => {
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-all', {
      detail: { text: 'world' },
    }))
    expect(adapter.replaceAll).toHaveBeenCalledWith('world')
  })

  it('CM/BN 切换后新编辑器应自动同步已存在的查询文本', () => {
    setSharedFindReplaceQuery('shared-query', { caseSensitive: true, wholeWord: false, regexp: false })
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    expect(adapter.setQuery).toHaveBeenCalledWith('shared-query', {
      caseSensitive: true, wholeWord: false, regexp: false,
    })
  })

  it('CM/BN 切换后新编辑器应自动同步已存在的替换文本', () => {
    setSharedFindReplaceQuery('shared-query', { caseSensitive: false, wholeWord: false, regexp: false })
    setSharedFindReplaceText('shared-replace')
    const adapter = makeMockAdapter()
    renderHook(() => useEditorSearchIntegration(adapter))
    expect(adapter.setReplaceText).toHaveBeenCalledWith('shared-replace')
  })

  it('matchCount 变化时应派发 editor:find-replace:match-count 事件', () => {
    const adapter = makeMockAdapter({ matchCount: { current: 2, total: 5 } })
    const spy = vi.fn()
    window.addEventListener('editor:find-replace:match-count', spy)
    renderHook(() => useEditorSearchIntegration(adapter))
    expect(spy).toHaveBeenCalled()
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail
    expect(detail).toEqual({ current: 2, total: 5 })
    window.removeEventListener('editor:find-replace:match-count', spy)
  })

  it('卸载时应移除所有事件监听器', () => {
    const adapter = makeMockAdapter()
    const { unmount } = renderHook(() => useEditorSearchIntegration(adapter))
    unmount()
    ;(adapter.findNext as ReturnType<typeof vi.fn>).mockClear()
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
    expect(adapter.findNext).not.toHaveBeenCalled()
  })
})
