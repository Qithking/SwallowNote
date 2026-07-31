/**
 * countMatches 真实 CodeMirror 集成测试
 * 验证不同查询条件下的匹配计数
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { search } from '@codemirror/search'
import { useCodeMirrorSearch } from '@/components/editors/useCodeMirrorSearch'

function createView(doc: string) {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [search({ top: true })],
    }),
  })
}

describe('useCodeMirrorSearch countMatches integration', () => {
  it('应在简单文档中正确计数', () => {
    const view = createView('hello world hello')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(2)
    } finally {
      view.destroy()
    }
  })

  it('应正确统计不存在的文本匹配数为 0', () => {
    const view = createView('hello world')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'xyz', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(0)
    } finally {
      view.destroy()
    }
  })

  it('应正确统计跨行匹配', () => {
    const view = createView('hello\nworld\nhello')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(2)
    } finally {
      view.destroy()
    }
  })

  it('大小写敏感时应区分大小写', () => {
    const view = createView('Hello HELLO hello')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: true, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(1)
    } finally {
      view.destroy()
    }
  })

  it('大小写不敏感时应忽略大小写', () => {
    const view = createView('Hello HELLO hello')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(3)
    } finally {
      view.destroy()
    }
  })

  it('全词匹配时不应匹配子串', () => {
    const view = createView('hello helloworld hello')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: true, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(2)
    } finally {
      view.destroy()
    }
  })

  it('正则模式应正确计数', () => {
    const view = createView('foo123 bar456 foo789')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'foo[0-9]+', caseSensitive: false, wholeWord: false, regexp: true })
      })
      expect(result.current.matchCount.total).toBe(2)
    } finally {
      view.destroy()
    }
  })

  it('搜索文本在开头和结尾重复时应正确计数', () => {
    const view = createView('foo foo foo')
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(3)
    } finally {
      view.destroy()
    }
  })
})
