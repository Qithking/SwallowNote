/**
 * useBlockNoteSearch 真实 BlockNoteEditor 集成测试
 * 验证完整搜索流程: plugin 注册 → setQuery → decorations 应用
 * 不使用 mock,捕获生产环境真实行为
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { BlockNoteEditor } from '@blocknote/core'
import { useBlockNoteSearch } from '@/components/editors/useBlockNoteSearch'

describe('useBlockNoteSearch 真实集成', () => {
  it('应注册 plugin 并在 setQuery 后产生匹配计数', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    try {
      const { result } = renderHook(() => useBlockNoteSearch({ editor }))

      // 初始状态: 0 匹配
      expect(result.current.matchCount.total).toBe(0)

      act(() => {
        result.current.setQuery('hello', { caseSensitive: false })
      })

      // 期望: 2 个匹配
      expect(result.current.matchCount.total).toBe(2)
      expect(result.current.matchCount.current).toBe(1)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })

  it('应在多段落文档中找到所有匹配', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello again' }] },
      ],
    })
    try {
      const { result } = renderHook(() => useBlockNoteSearch({ editor }))

      act(() => {
        result.current.setQuery('hello', { caseSensitive: false })
      })

      expect(result.current.matchCount.total).toBe(2)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })

  it('clear 后应重置匹配计数', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
    })
    try {
      const { result } = renderHook(() => useBlockNoteSearch({ editor }))

      act(() => {
        result.current.setQuery('hello', { caseSensitive: false })
      })
      expect(result.current.matchCount.total).toBe(1)

      act(() => {
        result.current.clear()
      })
      expect(result.current.matchCount.total).toBe(0)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })

  it('replaceNext 替换后应跳到下一匹配,而不是回到第一个', () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'a a a' }] }],
    })
    try {
      const { result } = renderHook(() => useBlockNoteSearch({ editor }))

      act(() => {
        result.current.setQuery('a', { caseSensitive: false })
      })
      expect(result.current.matchCount.total).toBe(3)
      expect(result.current.matchCount.current).toBe(1)

      // replaceText 仍为 'a',doc 不变,但期望跳到下一个匹配
      act(() => {
        result.current.replaceNext('a')
      })

      // 期望当前为第 2 个匹配,而非回到第 1 个
      expect(result.current.matchCount.current).toBe(2)
      expect(result.current.matchCount.total).toBe(3)
    } finally {
      editor._tiptapEditor.destroy()
    }
  })
})
