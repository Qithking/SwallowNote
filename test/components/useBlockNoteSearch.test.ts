/**
 * useBlockNoteSearch hook 测试
 * Source: plan/editor-find-replace step 5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBlockNoteSearch } from '@/components/editors/useBlockNoteSearch'

// Mock getBNProseMirrorView
vi.mock('@/components/editors/blocknoteSearch', async () => {
  const actual = await vi.importActual('@/components/editors/blocknoteSearch')
  return {
    ...actual,
    getBNProseMirrorView: vi.fn(),
  }
})

// Mock TextSelection.create 避免 ResolvedPos 完整结构依赖(库代码不需测试)
vi.mock('prosemirror-state', async () => {
  const actual = await vi.importActual('prosemirror-state')
  return {
    ...actual,
    TextSelection: {
      ...actual.TextSelection,
      create: (_doc: any, from: number, to: number = from) =>
        ({ from, to, anchor: from, head: to }),
    },
  }
})

import { getBNProseMirrorView } from '@/components/editors/blocknoteSearch'

// ProseMirror view mock:模拟 doc > paragraph > text 真实嵌套结构
// nodesBetween 先访问段落节点,回调返回 false 时不递归进入子节点(与真实 PM 一致)
const mockDoc = {
  textBetween: (from: number, to: number) => 'hello world hello'.slice(from, to),
  nodesBetween: (_from: number, _to: number, onNode: (node: any, pos: number) => boolean | void) => {
    // 段落节点(pos=0,非文本)
    const shouldRecurse = onNode({ isText: false, text: null, childCount: 1 }, 0)
    if (shouldRecurse !== false) {
      // 文本节点(pos=1)
      onNode({ text: 'hello world hello', isText: true, childCount: 0 }, 1)
    }
  },
  nodeSize: 19,
  content: { size: 17 },
  // TextSelection.create 需要 doc.resolve(pos) 返回含 pos 的对象
  resolve: (pos: number) => ({ pos }),
}
const mockDispatch = vi.fn()
const mockView = {
  state: {
    doc: mockDoc,
    // ProseMirror selection 没有 main 属性,直接是 from/to/anchor/head
    selection: { from: 0, to: 0, anchor: 0, head: 0 },
    tr: {
      setSelection: vi.fn(() => mockView.state.tr),
      scrollIntoView: vi.fn(() => mockView.state.tr),
    },
  },
  dispatch: mockDispatch,
} as any

describe('useBlockNoteSearch', () => {
  beforeEach(() => {
    vi.mocked(getBNProseMirrorView).mockReturnValue(mockView)
    mockDispatch.mockClear()
  })

  it('should expose search API functions', () => {
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    expect(typeof result.current.setQuery).toBe('function')
    expect(typeof result.current.findNext).toBe('function')
    expect(typeof result.current.findPrev).toBe('function')
    expect(typeof result.current.getMatchCount).toBe('function')
    expect(typeof result.current.clear).toBe('function')
  })

  it('should no-op when view is null (AC-15)', () => {
    vi.mocked(getBNProseMirrorView).mockReturnValue(null)
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
      result.current.findNext()
      result.current.findPrev()
    })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('should update matches when setQuery is called', () => {
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })
    // 'hello world hello' 有 2 个 'hello'
    const count = result.current.getMatchCount()
    expect(count.total).toBe(2)
  })

  it('should dispatch transaction on findNext', () => {
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })
    act(() => {
      result.current.findNext()
    })
    expect(mockDispatch).toHaveBeenCalled()
  })

  it('findNext 在当前匹配选中时不应停留,应跳到下一个匹配', () => {
    // 文本 'hello world hello' 中第一个 hello 在 [1,6],第二个在 [13,18]
    const viewWithSelection = {
      ...mockView,
      state: {
        ...mockView.state,
        selection: { from: 1, to: 6, anchor: 1, head: 6 },
      },
    }
    vi.mocked(getBNProseMirrorView).mockReturnValue(viewWithSelection)
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })
    act(() => {
      result.current.findNext()
    })
    expect(mockView.state.tr.setSelection).toHaveBeenCalledWith(expect.objectContaining({ from: 13, to: 18 }))
  })

  it('should clear matches when clear is called', () => {
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })
    expect(result.current.getMatchCount().total).toBe(2)
    act(() => {
      result.current.clear()
    })
    expect(result.current.getMatchCount().total).toBe(0)
  })

  it('should be case-insensitive when caseSensitive=false', () => {
    const doc = {
      textBetween: (from: number, to: number) => 'Hello HELLO hello'.slice(from, to),
      nodesBetween: (_from: number, _to: number, onNode: (node: any, pos: number) => boolean | void) => {
        const shouldRecurse = onNode({ isText: false, text: null, childCount: 1 }, 0)
        if (shouldRecurse !== false) {
          onNode({ text: 'Hello HELLO hello', isText: true, childCount: 0 }, 1)
        }
      },
      nodeSize: 19,
      content: { size: 17 },
      resolve: (pos: number) => ({ pos }),
    }
    vi.mocked(getBNProseMirrorView).mockReturnValue({ ...mockView, state: { ...mockView.state, doc } } as any)
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })
    expect(result.current.getMatchCount().total).toBe(3)
  })

  it('should be case-sensitive when caseSensitive=true', () => {
    const doc = {
      textBetween: (from: number, to: number) => 'Hello HELLO hello'.slice(from, to),
      nodesBetween: (_from: number, _to: number, onNode: (node: any, pos: number) => boolean | void) => {
        const shouldRecurse = onNode({ isText: false, text: null, childCount: 1 }, 0)
        if (shouldRecurse !== false) {
          onNode({ text: 'Hello HELLO hello', isText: true, childCount: 0 }, 1)
        }
      },
      nodeSize: 19,
      content: { size: 17 },
      resolve: (pos: number) => ({ pos }),
    }
    vi.mocked(getBNProseMirrorView).mockReturnValue({ ...mockView, state: { ...mockView.state, doc } } as any)
    const { result } = renderHook(() => useBlockNoteSearch({ editor: {} as any }))
    act(() => {
      result.current.setQuery('hello', { caseSensitive: true })
    })
    expect(result.current.getMatchCount().total).toBe(1)
  })
})
