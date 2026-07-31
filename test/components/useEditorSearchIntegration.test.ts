/**
 * useEditorSearchIntegration hook 测试
 * Source: plan/editor-find-replace step 8
 *
 * 验证 MarkdownEditor/CodeEditor 的事件桥接:
 * - 监听 editor:find-replace:* 事件并调用对应 hook 方法
 * - hook 状态变化时派发 editor:find-replace:match-count 事件
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEditorSearchIntegration, setSharedFindReplaceQuery, setSharedFindReplaceText } from '@/components/editors/useEditorSearchIntegration'

// Mock useBlockNoteSearch hook
const mockBlockNoteSearchApi = {
  setQuery: vi.fn(),
  setReplaceText: vi.fn(),
  findNext: vi.fn(),
  findPrev: vi.fn(),
  replaceNext: vi.fn(),
  replaceAll: vi.fn(),
  clear: vi.fn(),
  getMatchCount: vi.fn(() => ({ current: 0, total: 0 })),
  matchCount: { current: 0, total: 0 } as { current: number; total: number },
}

vi.mock('@/components/editors/useBlockNoteSearch', () => ({
  useBlockNoteSearch: () => mockBlockNoteSearchApi,
}))

// Mock useCodeMirrorSearch hook
const mockCodeMirrorSearchApi = {
  setQuery: vi.fn(),
  setReplaceText: vi.fn(),
  findNext: vi.fn(),
  findPrev: vi.fn(),
  replaceNext: vi.fn(),
  replaceAll: vi.fn(),
  getMatchCount: vi.fn(() => ({ current: 0, total: 0 })),
  matchCount: { current: 0, total: 0 } as { current: number; total: 0 },
}

vi.mock('@/components/editors/useCodeMirrorSearch', () => ({
  useCodeMirrorSearch: () => mockCodeMirrorSearchApi,
}))

describe('useEditorSearchIntegration', () => {
  let matchCountHandler: ((e: Event) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    setSharedFindReplaceQuery('', { caseSensitive: false, wholeWord: false, regexp: false })
    setSharedFindReplaceText('')
    matchCountHandler = null
    window.addEventListener('editor:find-replace:match-count', (e) => {
      matchCountHandler?.(e)
    })
  })

  afterEach(() => {
    window.removeEventListener('editor:find-replace:match-count', (e) => {
      matchCountHandler?.(e)
    })
  })

  it('监听 editor:find-replace:query 事件应调用 hook.setQuery', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
      detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
    }))
    expect(mockBlockNoteSearchApi.setQuery).toHaveBeenCalledWith('hello', { caseSensitive: false })
  })

  it('监听 editor:find-replace:find-next 事件应调用 hook.findNext', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
    expect(mockBlockNoteSearchApi.findNext).toHaveBeenCalled()
  })

  it('监听 editor:find-replace:find-prev 事件应调用 hook.findPrev', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-prev'))
    expect(mockBlockNoteSearchApi.findPrev).toHaveBeenCalled()
  })

  it('监听 editor:find-replace:clear 事件应调用 hook.clear', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:clear'))
    expect(mockBlockNoteSearchApi.clear).toHaveBeenCalled()
  })

  it('CM 模式: 监听 editor:find-replace:replace-text 应调用 hook.setReplaceText', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'codemirror', viewRef: { current: null } as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', {
      detail: { text: 'world' },
    }))
    expect(mockCodeMirrorSearchApi.setReplaceText).toHaveBeenCalledWith('world')
  })

  it('BN 模式: 监听 editor:find-replace:replace-text 应调用 hook.setReplaceText', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', {
      detail: { text: 'world' },
    }))
    expect(mockBlockNoteSearchApi.setReplaceText).toHaveBeenCalledWith('world')
  })

  it('CM 模式: 监听 editor:find-replace:replace-next 应调用 hook.replaceNext', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'codemirror', viewRef: { current: null } as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-next', {
      detail: { text: 'world' },
    }))
    expect(mockCodeMirrorSearchApi.replaceNext).toHaveBeenCalledWith('world')
  })

  it('CM 模式: 监听 editor:find-replace:replace-all 应调用 hook.replaceAll', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'codemirror', viewRef: { current: null } as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:replace-all', {
      detail: { text: 'world' },
    }))
    expect(mockCodeMirrorSearchApi.replaceAll).toHaveBeenCalledWith('world')
  })

  it('CM 模式: 监听 editor:find-replace:query 应调用 hook.setQuery (含 4 个选项)', () => {
    renderHook(() => useEditorSearchIntegration({ editorType: 'codemirror', viewRef: { current: null } as any }))
    window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
      detail: { text: 'foo', caseSensitive: true, wholeWord: true, regexp: false },
    }))
    expect(mockCodeMirrorSearchApi.setQuery).toHaveBeenCalledWith({
      text: 'foo', caseSensitive: true, wholeWord: true, regexp: false,
    })
  })

  it('CM/BN 切换后新编辑器应自动同步已存在的查询文本', () => {
    // 先模拟用户已输入查询文本(共享状态已设置)
    setSharedFindReplaceQuery('shared-query', { caseSensitive: true, wholeWord: false, regexp: false })
    // 再 mount BN 编辑器,应自动调用 setQuery 同步已有查询
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    expect(mockBlockNoteSearchApi.setQuery).toHaveBeenCalledWith('shared-query', { caseSensitive: true })
  })

  it('CM/BN 切换后新编辑器应自动同步已存在的替换文本', () => {
    // 先模拟用户在 CM 侧输入查询与替换文本
    setSharedFindReplaceQuery('shared-query', { caseSensitive: false, wholeWord: false, regexp: false })
    setSharedFindReplaceText('shared-replace')
    // 再 mount BN 编辑器,应自动调用 setReplaceText 同步替换文本
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    expect(mockBlockNoteSearchApi.setReplaceText).toHaveBeenCalledWith('shared-replace')
  })

  it('matchCount 变化时应派发 editor:find-replace:match-count 事件', () => {
    mockBlockNoteSearchApi.matchCount = { current: 2, total: 5 }
    const spy = vi.fn()
    window.addEventListener('editor:find-replace:match-count', spy)
    renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    // Wait for useEffect to fire
    expect(spy).toHaveBeenCalled()
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail
    expect(detail).toEqual({ current: 2, total: 5 })
    window.removeEventListener('editor:find-replace:match-count', spy)
    mockBlockNoteSearchApi.matchCount = { current: 0, total: 0 }
  })

  it('卸载时应移除所有事件监听器', () => {
    const { unmount } = renderHook(() => useEditorSearchIntegration({ editorType: 'blocknote', editor: {} as any }))
    unmount()
    // 事件不应再触发
    mockBlockNoteSearchApi.findNext.mockClear()
    window.dispatchEvent(new CustomEvent('editor:find-replace:find-next'))
    expect(mockBlockNoteSearchApi.findNext).not.toHaveBeenCalled()
  })
})
