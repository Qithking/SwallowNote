/**
 * useCodeMirrorSearch 真实 CodeMirror 集成测试
 * 不 mock @codemirror/search,验证替换功能在真实 EditorView 上工作
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { search } from '@codemirror/search'
import { useCodeMirrorSearch } from '@/components/editors/useCodeMirrorSearch'

describe('useCodeMirrorSearch integration', () => {
  it('应能在真实 CodeMirror 文档中替换下一个匹配项', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello world hello',
        extensions: [search({ top: true })],
      }),
    })
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
        // setQuery 已自动选中第一个匹配,replaceNext 应直接替换
        result.current.replaceNext('hi')
      })
      expect(view.state.doc.toString()).toBe('hi world hello')
    } finally {
      view.destroy()
    }
  })

  it('应能在真实 CodeMirror 文档中替换全部匹配项', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello world hello',
        extensions: [search({ top: true })],
      }),
    })
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'hello', caseSensitive: false, wholeWord: false, regexp: false })
        result.current.replaceAll('hi')
      })
      expect(view.state.doc.toString()).toBe('hi world hi')
    } finally {
      view.destroy()
    }
  })

  it('替换后应更新匹配计数', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'foo foo foo',
        extensions: [search({ top: true })],
      }),
    })
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount.total).toBe(3)
      act(() => {
        result.current.replaceNext('bar')
      })
      expect(result.current.matchCount.total).toBe(2)
    } finally {
      view.destroy()
    }
  })

  it('findNext 后当前匹配索引应递增并循环', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'foo bar foo baz foo',
        extensions: [search({ top: true })],
      }),
    })
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount).toEqual({ current: 1, total: 3 })
      act(() => {
        result.current.findNext()
      })
      expect(view.state.selection.main.from).toBe(8)
      expect(result.current.matchCount).toEqual({ current: 2, total: 3 })
      act(() => {
        result.current.findNext()
      })
      expect(result.current.matchCount).toEqual({ current: 3, total: 3 })
      act(() => {
        result.current.findNext()
      })
      expect(result.current.matchCount).toEqual({ current: 1, total: 3 })
    } finally {
      view.destroy()
    }
  })

  it('findPrev 后当前匹配索引应递减并循环', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'foo bar foo baz foo',
        extensions: [search({ top: true })],
      }),
    })
    try {
      const { result } = renderHook(() => useCodeMirrorSearch({ viewRef: { current: view } } as any))
      act(() => {
        result.current.setQuery({ text: 'foo', caseSensitive: false, wholeWord: false, regexp: false })
      })
      expect(result.current.matchCount).toEqual({ current: 1, total: 3 })
      act(() => {
        result.current.findPrev()
      })
      expect(result.current.matchCount).toEqual({ current: 3, total: 3 })
      act(() => {
        result.current.findPrev()
      })
      expect(result.current.matchCount).toEqual({ current: 2, total: 3 })
    } finally {
      view.destroy()
    }
  })
})
