/**
 * useBlockNoteSearch StrictMode 精确复现测试
 * 模拟 React.StrictMode 的 mount → unmount → mount 时序
 * 验证 plugin 注册是否在 double-mount 后正确工作
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { BlockNoteEditor } from '@blocknote/core'
import { useBlockNoteSearch } from '@/components/editors/useBlockNoteSearch'
import { findReplacePluginKey } from '@/components/editors/blocknoteSearch'

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

describe('useBlockNoteSearch StrictMode 精确复现', () => {
  let editor: BlockNoteEditor
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    editor = BlockNoteEditor.create({
      initialContent: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    editor._tiptapEditor.destroy()
  })

  it('StrictMode double-mount 不应产生 registerPlugin 错误', () => {
    // 模拟 StrictMode: mount → unmount → mount
    const { unmount } = renderHook(() => useBlockNoteSearch({ editor }))

    // 第一次 mount 的 cleanup
    unmount()

    // 第二次 mount
    const { result } = renderHook(() => useBlockNoteSearch({ editor }))

    // 验证没有 registerPlugin failed 警告
    const warnCalls = consoleWarnSpy.mock.calls.map(c => String(c[0]))
    const hasRegisterError = warnCalls.some(msg => msg.includes('registerPlugin failed'))
    expect(hasRegisterError).toBe(false)
  })

  it('StrictMode double-mount 后 plugin 应正确注册且搜索有效', () => {
    const { unmount } = renderHook(() => useBlockNoteSearch({ editor }))
    unmount()

    const { result } = renderHook(() => useBlockNoteSearch({ editor }))

    act(() => {
      result.current.setQuery('hello', { caseSensitive: false })
    })

    // 验证 plugin 在 editor 中存在
    const tiptap = (editor as any)._tiptapEditor
    const plugins = tiptap.state.plugins
    const hasFindReplacePlugin = plugins.some((p: any) => p.key.startsWith('findReplace'))
    expect(hasFindReplacePlugin).toBe(true)

    // 验证匹配数
    expect(result.current.matchCount.total).toBe(2)
  })
})
