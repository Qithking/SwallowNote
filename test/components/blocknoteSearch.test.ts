/**
 * getBNProseMirrorView helper 测试
 * Source: plan/editor-find-replace step 6, AC-15
 */
import { describe, it, expect, vi } from 'vitest'
import { getBNProseMirrorView, scrollMatchIntoView } from '@/components/editors/blocknoteSearch'

describe('getBNProseMirrorView', () => {
  it('should return null when editor is null', () => {
    expect(getBNProseMirrorView(null as any)).toBeNull()
  })

  it('should return null when editor is undefined', () => {
    expect(getBNProseMirrorView(undefined as any)).toBeNull()
  })

  it('should return null when _tiptapEditor is missing', () => {
    const editor = {} as any
    expect(getBNProseMirrorView(editor)).toBeNull()
  })

  it('should return null when _tiptapEditor.view is missing', () => {
    const editor = { _tiptapEditor: {} } as any
    expect(getBNProseMirrorView(editor)).toBeNull()
  })

  it('should return view when _tiptapEditor.view exists', () => {
    const fakeView = { id: 'fake-view' }
    const editor = { _tiptapEditor: { view: fakeView } } as any
    expect(getBNProseMirrorView(editor)).toBe(fakeView)
  })

  it('should return null when accessing _tiptapEditor throws', () => {
    const editor = {
      get _tiptapEditor() { throw new Error('blocked') },
    } as any
    expect(getBNProseMirrorView(editor)).toBeNull()
  })
})

describe('scrollMatchIntoView', () => {
  it('应通过 ScrollArea viewport 的 scrollTo 滚动匹配位置到中心', () => {
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    viewport.scrollTop = 0
    const scrollToSpy = vi.fn()
    viewport.scrollTo = scrollToSpy
    // mock getBoundingClientRect: viewport 在屏幕 top=100, height=400
    viewport.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400, x: 0, y: 100, toJSON: () => {} } as any)

    const dom = document.createElement('div')
    viewport.appendChild(dom)

    const fakeView = {
      dom,
      coordsAtPos: () => ({ top: 300, bottom: 320, left: 10, right: 50 }),
      dispatch: vi.fn(),
      state: { tr: { scrollIntoView: () => ({}) } },
    } as any

    scrollMatchIntoView(fakeView, 5)

    // offset = 300 - 100 + 0 - 400/2 = 0
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('无 viewport 时应回退到 scrollIntoView', () => {
    const scrollIntoViewTr = { scrollIntoView: vi.fn(() => 'scrolled-tr') }
    const dispatchSpy = vi.fn()
    const fakeView = {
      dom: document.createElement('div'),
      coordsAtPos: () => ({ top: 300, bottom: 320, left: 10, right: 50 }),
      dispatch: dispatchSpy,
      state: { tr: scrollIntoViewTr },
    } as any

    scrollMatchIntoView(fakeView, 5)

    expect(scrollIntoViewTr.scrollIntoView).toHaveBeenCalled()
    expect(dispatchSpy).toHaveBeenCalledWith('scrolled-tr')
  })
})
