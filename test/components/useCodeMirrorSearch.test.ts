/**
 * useCodeMirrorSearch hook 测试
 * Source: plan/editor-find-replace step 4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirrorSearch } from '@/components/editors/useCodeMirrorSearch'
import { findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search'

// CodeMirror search 函数 mock — 使用真实 SearchCursor/RegExpCursor,仅 mock 副作用函数
vi.mock('@codemirror/search', async () => {
  const actual = await vi.importActual<typeof import('@codemirror/search')>('@codemirror/search')
  return {
    ...actual,
    setSearchQuery: { of: vi.fn((q: any) => ({ type: 'setSearchQuery', value: q }) ) },
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    replaceNext: vi.fn(),
    replaceAll: vi.fn(),
  }
})

const mockDispatch = vi.fn()
const mockView = {
  dispatch: mockDispatch,
  state: {},
} as any

describe('useCodeMirrorSearch', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    vi.mocked(findNext).mockClear()
    vi.mocked(findPrevious).mockClear()
    vi.mocked(replaceNext).mockClear()
    vi.mocked(replaceAll).mockClear()
  })

  it('should expose search API functions', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    expect(typeof result.current.setQuery).toBe('function')
    expect(typeof result.current.findNext).toBe('function')
    expect(typeof result.current.findPrev).toBe('function')
    expect(typeof result.current.replaceNext).toBe('function')
    expect(typeof result.current.replaceAll).toBe('function')
    expect(typeof result.current.getMatchCount).toBe('function')
  })

  it('should dispatch setSearchQuery when setQuery is called', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: true, wholeWord: false, regexp: false })
    })
    expect(mockDispatch).toHaveBeenCalled()
    const call = mockDispatch.mock.calls[0][0]
    expect(call.effects).toBeDefined()
  })

  it('should no-op when view is null', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: null } } as any))
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      result.current.findNext()
      result.current.findPrev()
      result.current.replaceNext('bar')
      result.current.replaceAll('bar')
    })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('view 初始为空时 setQuery 保存查询,view 可用后 findNext 应先 dispatch setSearchQuery 再查找', () => {
    const viewRef = { current: null as any }
    const { result, rerender } = renderHook(
      ({ viewRef }) => useCodeMirrorSearch({ viewRef }),
      { initialProps: { viewRef } },
    )
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: true, wholeWord: false, regexp: false })
    })
    // view 未初始化时不应 dispatch
    expect(mockDispatch).not.toHaveBeenCalled()

    // 模拟 CodeMirror 初始化完成
    viewRef.current = mockView
    rerender({ viewRef: { current: mockView } })

    act(() => {
      result.current.findNext()
    })
    // findNext 应先设置 search query,再调用 CM findNext
    expect(mockDispatch).toHaveBeenCalled()
    expect(findNext).toHaveBeenCalledWith(mockView)
  })

  it('view 初始为空时 setQuery 保存查询,view 可用后应自动重新计算匹配数', async () => {
    const text = 'foo foo foo'
    const makeIter = (slice: string) => {
      let emitted = false
      const iter: any = {
        done: false,
        value: '',
        lineBreak: false,
        next() {
          if (emitted) {
            iter.done = true
            iter.value = undefined
          } else {
            emitted = true
            iter.value = slice
            iter.lineBreak = false
          }
          return iter
        },
      }
      return iter
    }
    const mockDoc = {
      toString: () => text,
      length: text.length,
      sliceString: (from: number, to: number) => text.slice(from, to),
      iterRange: (from: number, to: number) => makeIter(text.slice(from, to)),
      iter: () => makeIter(text),
      lineAt: (_pos: number) => ({ from: 0, to: text.length, text }),
    }
    const viewWithDoc = {
      ...mockView,
      state: { doc: mockDoc },
    } as any
    const viewRef = { current: null as any }
    const { result, rerender } = renderHook(
      ({ viewRef }) => useCodeMirrorSearch({ viewRef }),
      { initialProps: { viewRef } },
    )
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
    })
    // view 未初始化时计数为 0
    expect(result.current.matchCount.total).toBe(0)

    // 模拟 CodeMirror 初始化完成
    viewRef.current = viewWithDoc
    rerender({ viewRef: { current: viewWithDoc } })

    // 等待 useEffect 中的轮询应用 query
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current.matchCount.total).toBe(3)
  })

  it('should call findNext when query is set', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      result.current.findNext()
    })
    expect(findNext).toHaveBeenCalledWith(mockView)
  })

  it('should no-op findNext when query is empty', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    act(() => {
      result.current.findNext()
    })
    expect(findNext).not.toHaveBeenCalled()
  })

  it('should dispatch setSearchQuery and call replaceNext when query is set', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      result.current.replaceNext('replacement')
    })
    // 先 dispatch setSearchQuery(含 replace 文本),再调用 replaceNext
    expect(mockDispatch).toHaveBeenCalled()
    expect(replaceNext).toHaveBeenCalledWith(mockView)
  })

  it('should no-op replaceNext when query is empty', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    act(() => {
      result.current.replaceNext('replacement')
    })
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(replaceNext).not.toHaveBeenCalled()
  })

  it('should return default match count when view is empty', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    let count
    act(() => {
      count = result.current.getMatchCount()
    })
    expect(count).toEqual({ current: 0, total: 0 })
  })

  it('should compute match count after setQuery by scanning the doc', () => {
    // Simulate a doc with 3 matches of "foo" — CM Text-like mock with iterRange
    const text = 'foo bar foo baz foo'
    // CM Text iterator pattern: iter.value is set AFTER iter.next() is called
    const makeIter = (slice: string) => {
      let emitted = false
      const iter: any = {
        done: false,
        value: '',
        lineBreak: false,
        next() {
          if (emitted) {
            iter.done = true
            iter.value = undefined
          } else {
            emitted = true
            iter.value = slice
            iter.lineBreak = false
          }
          return iter
        },
      }
      return iter
    }
    const mockDoc = {
      toString: () => text,
      length: text.length,
      sliceString: (from: number, to: number) => text.slice(from, to),
      iterRange: (from: number, to: number) => makeIter(text.slice(from, to)),
      iter: () => makeIter(text),
      lineAt: (_pos: number) => ({ from: 0, to: text.length, text }),
    }
    const viewWithDoc = {
      ...mockView,
      state: { doc: mockDoc },
    } as any
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: viewWithDoc } } as any))
    act(() => {
      result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
    })
    const count = result.current.getMatchCount()
    expect(count.total).toBe(3)
  })

  it('should expose matchCount as state for reactive UI updates', () => {
    const text = 'hello hello'
    const makeIter = (slice: string) => {
      let emitted = false
      const iter: any = {
        done: false,
        value: '',
        lineBreak: false,
        next() {
          if (emitted) {
            iter.done = true
            iter.value = undefined
          } else {
            emitted = true
            iter.value = slice
            iter.lineBreak = false
          }
          return iter
        },
      }
      return iter
    }
    const mockDoc = {
      toString: () => text,
      length: text.length,
      sliceString: (from: number, to: number) => text.slice(from, to),
      iterRange: (from: number, to: number) => makeIter(text.slice(from, to)),
      iter: () => makeIter(text),
      lineAt: (_pos: number) => ({ from: 0, to: text.length, text }),
    }
    const viewWithDoc = {
      ...mockView,
      state: { doc: mockDoc },
    } as any
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: viewWithDoc } } as any))
    // Before setQuery, matchCount is 0/0
    expect(result.current.matchCount).toEqual({ current: 0, total: 0 })
    act(() => {
      result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
    })
    // After setQuery, matchCount.total reflects the number of matches
    expect(result.current.matchCount.total).toBe(2)
  })

  it('正则无效时应派发 editor:find-replace:error 事件', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    const spy = vi.fn()
    window.addEventListener('editor:find-replace:error', spy)
    act(() => {
      result.current.setQuery({ text: '(', caseSensitive: false, wholeWord: false, regexp: true })
    })
    window.removeEventListener('editor:find-replace:error', spy)
    expect(result.current.matchCount).toEqual({ current: 0, total: 0 })
    expect(spy).toHaveBeenCalled()
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail
    expect(detail.message).toBe('editorToolbar.findReplace.invalidRegex')
  })

  it('返回值不应包含 queryError 属性', () => {
    const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: mockView } } as any))
    expect('queryError' in result.current).toBe(false)
  })

})
