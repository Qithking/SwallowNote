/**
 * CodeEditor 查找/替换集成测试
 *
 * 复现 bug:
 * 1. CodeMirror 模式下按 Mod-f 不应打开原生搜索面板,应统一使用自定义 UI
 * 2. 自定义搜索 UI 的按钮点击应派发预期事件
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

/** 条件轮询等待 CodeMirror 初始化完成 */
const waitForCmReady = () => waitFor(() => {
  const editorDom = document.querySelector('.cm-editor')
  if (!editorDom) throw new Error('CodeMirror editor not ready')
  return editorDom
}, { timeout: 2000 })

const openSearchPanelMock = vi.fn()

vi.mock('@codemirror/search', async () => {
  const actual = await vi.importActual<typeof import('@codemirror/search')>('@codemirror/search')
  return {
    ...actual,
    openSearchPanel: (view: any) => {
      openSearchPanelMock(view)
      return actual.openSearchPanel(view)
    },
  }
})

import { CodeEditor } from '@/components/editors/CodeEditor'
import { FindReplacePanel } from '@/components/FindReplacePanel'

describe('CodeEditor find/replace integration', () => {
  let toggleEventSpy: ((e: Event) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    openSearchPanelMock.mockClear()
    toggleEventSpy = null
    window.addEventListener('editor:toggle-find-replace', (e) => {
      toggleEventSpy?.(e)
    })
  })

  afterEach(() => {
    window.removeEventListener('editor:toggle-find-replace', (e) => {
      toggleEventSpy?.(e)
    })
  })

  it('按 Mod-f 不应触发 CodeMirror 原生 openSearchPanel,而应派发 editor:toggle-find-replace', async () => {
    const spy = vi.fn()
    toggleEventSpy = spy

    render(
      <CodeEditor
        content="hello world"
        filename="test.ts"
        onChange={vi.fn()}
      />,
    )

    const editorDom = await waitForCmReady()

    // CodeMirror keymap 需要 focus 在编辑器内才能触发
    const cmContent = editorDom.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    ;(cmContent as HTMLElement).focus()

    fireEvent.keyDown(cmContent!, { key: 'f', code: 'KeyF', ctrlKey: true })

    expect(spy).toHaveBeenCalled()
    expect(openSearchPanelMock).not.toHaveBeenCalled()
  })

  it('不应渲染 CodeMirror 原生搜索面板 .cm-search', async () => {
    render(
      <CodeEditor
        content="hello world"
        filename="test.ts"
        onChange={vi.fn()}
      />,
    )

    await waitForCmReady()

    expect(document.querySelector('.cm-search')).toBeNull()
  })

  it('按 Shift-F3 不应触发 CodeMirror 原生 findPrevious,而应派发 editor:find-replace:find-prev', async () => {
    const spy = vi.fn()
    window.addEventListener('editor:find-replace:find-prev', spy)

    render(
      <CodeEditor
        content="hello world"
        filename="test.ts"
        onChange={vi.fn()}
      />,
    )

    const editorDom = await waitForCmReady()
    const cmContent = editorDom.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    ;(cmContent as HTMLElement).focus()

    fireEvent.keyDown(cmContent!, { key: 'F3', code: 'F3', shiftKey: true })

    expect(spy).toHaveBeenCalled()
    window.removeEventListener('editor:find-replace:find-prev', spy)
  })

  it('没有查询时按 F3 不应打开原生搜索面板', async () => {
    render(
      <CodeEditor
        content="hello world"
        filename="test.ts"
        onChange={vi.fn()}
      />,
    )

    const editorDom = await waitForCmReady()
    const cmContent = editorDom.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    ;(cmContent as HTMLElement).focus()

    fireEvent.keyDown(cmContent!, { key: 'F3', code: 'F3' })

    expect(openSearchPanelMock).not.toHaveBeenCalled()
    expect(document.querySelector('.cm-search')).toBeNull()
  })

  it('端到端:通过事件流应能替换文档内容', async () => {
    const onChangeSpy = vi.fn()
    render(
      <CodeEditor
        content="hello world hello"
        filename="test.ts"
        onChange={onChangeSpy}
      />,
    )

    await waitForCmReady()

    // 1. 派发查询事件
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
        detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
      }))
    })

    // 2. 派发替换文本事件
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:replace-text', {
        detail: { text: 'hi' },
      }))
    })

    // 3. 派发替换下一个事件
    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:replace-next', {
        detail: { text: 'hi' },
      }))
    })

    // 验证 onChange 被调用且文档内容已更改
    expect(onChangeSpy).toHaveBeenCalled()
    const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0]
    expect(lastCall).toBe('hi world hello')
  })

  it('端到端:通过事件流应能全部替换文档内容', async () => {
    const onChangeSpy = vi.fn()
    render(
      <CodeEditor
        content="hello world hello"
        filename="test.ts"
        onChange={onChangeSpy}
      />,
    )

    await waitForCmReady()

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:query', {
        detail: { text: 'hello', caseSensitive: false, wholeWord: false, regexp: false },
      }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent('editor:find-replace:replace-all', {
        detail: { text: 'hi' },
      }))
    })

    expect(onChangeSpy).toHaveBeenCalled()
    const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0]
    expect(lastCall).toBe('hi world hi')
  })
})
