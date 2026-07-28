import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readScrollTop, restoreScrollTop, SCROLL_CONTAINER_SELECTOR, findScrollContainer } from '@/lib/scroll-position'

describe('scroll-position helper', () => {
  let container: HTMLElement
  let viewport: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    container.setAttribute('data-testid', 'editor-container')
    viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    container.appendChild(viewport)
    document.body.appendChild(container)
  })

  describe('readScrollTop', () => {
    it('reads scrollTop from the viewport inside the given container', () => {
      Object.defineProperty(viewport, 'scrollTop', { value: 250, configurable: true, writable: true })
      expect(readScrollTop(container)).toBe(250)
    })

    it('returns null when no viewport found in container', () => {
      container.removeChild(viewport)
      expect(readScrollTop(container)).toBeNull()
    })

    it('returns 0 when scrollTop is 0', () => {
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })
      expect(readScrollTop(container)).toBe(0)
    })
  })

  describe('restoreScrollTop', () => {
    it('sets scrollTop on the viewport immediately when scrollHeight > clientHeight', async () => {
      Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })

      await restoreScrollTop(container, 300)
      expect(viewport.scrollTop).toBe(300)
    })

    it('clamps scrollTop to scrollHeight - clientHeight when target exceeds max', async () => {
      Object.defineProperty(viewport, 'scrollHeight', { value: 800, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })

      await restoreScrollTop(container, 9999)
      expect(viewport.scrollTop).toBe(300) // 800 - 500
    })

    it('does nothing when no viewport found', async () => {
      container.removeChild(viewport)
      await restoreScrollTop(container, 300)
      // 应静默跳过，不抛异常
    })

    it('re-queries viewport each poll iteration (handles editor remount)', async () => {
      // 初始 viewport scrollHeight 不够（内容未渲染）
      Object.defineProperty(viewport, 'scrollHeight', { value: 100, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })

      const promise = restoreScrollTop(container, 300, 500)

      // 立即替换 viewport（模拟编辑器 remount 后新 viewport 出现，内容已渲染）
      container.removeChild(viewport)
      const newViewport = document.createElement('div')
      newViewport.setAttribute('data-radix-scroll-area-viewport', '')
      Object.defineProperty(newViewport, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(newViewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(newViewport, 'scrollTop', { value: 0, configurable: true, writable: true })
      container.appendChild(newViewport)

      await promise
      expect(newViewport.scrollTop).toBe(300)
    })

    it('gives up after timeout when scrollHeight never exceeds clientHeight', async () => {
      vi.useFakeTimers()
      Object.defineProperty(viewport, 'scrollHeight', { value: 100, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })

      const promise = restoreScrollTop(container, 300, 100) // 100ms 超时
      vi.advanceTimersByTime(200)
      await promise
      expect(viewport.scrollTop).toBe(0) // 未恢复
      vi.useRealTimers()
    })

    it('does nothing when savedScrollTop is 0 or null', async () => {
      Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })

      await restoreScrollTop(container, 0)
      expect(viewport.scrollTop).toBe(0)
      await restoreScrollTop(container, null)
      expect(viewport.scrollTop).toBe(0)
    })
  })

  describe('SCROLL_CONTAINER_SELECTOR', () => {
    it('is the Radix ScrollArea viewport selector', () => {
      expect(SCROLL_CONTAINER_SELECTOR).toBe('[data-radix-scroll-area-viewport]')
    })
  })

  // ── CodeEditor (.cm-scroller) 支持 ─────────────────────────────
  // CodeMirror 的 basicSetup 默认主题给 .cm-scroller 设置了 overflow:auto,
  // 使其成为 CodeEditor 的实际滚动容器（嵌套在 Radix viewport 内部）。
  // Radix viewport 的 scrollTop 永远为 0，必须检测 .cm-scroller。
  describe('CodeEditor .cm-scroller support', () => {
    let cmScroller: HTMLElement

    beforeEach(() => {
      // 模拟 CodeEditor DOM 结构:
      // container > [data-radix-scroll-area-viewport] > div > .cm-editor > .cm-scroller
      document.body.innerHTML = ''
      container = document.createElement('div')
      viewport = document.createElement('div')
      viewport.setAttribute('data-radix-scroll-area-viewport', '')
      const wrapper = document.createElement('div')
      const cmEditor = document.createElement('div')
      cmEditor.className = 'cm-editor'
      cmScroller = document.createElement('div')
      cmScroller.className = 'cm-scroller'
      cmEditor.appendChild(cmScroller)
      wrapper.appendChild(cmEditor)
      viewport.appendChild(wrapper)
      container.appendChild(viewport)
      document.body.appendChild(container)
    })

    it('findScrollContainer returns .cm-scroller when it exists (CodeEditor)', () => {
      const found = findScrollContainer(container)
      expect(found).toBe(cmScroller)
    })

    it('findScrollContainer returns Radix viewport when .cm-scroller absent (MarkdownEditor)', () => {
      // 移除 cm-scroller
      cmScroller.remove()
      const found = findScrollContainer(container)
      expect(found).toBe(viewport)
    })

    it('readScrollTop reads from .cm-scroller, not Radix viewport (CodeEditor)', () => {
      // Radix viewport scrollTop 永远为 0
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })
      // .cm-scroller 才有实际滚动位置
      Object.defineProperty(cmScroller, 'scrollTop', { value: 420, configurable: true, writable: true })

      expect(readScrollTop(container)).toBe(420)
    })

    it('restoreScrollTop sets scrollTop on .cm-scroller, not Radix viewport (CodeEditor)', async () => {
      Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true, writable: true })
      Object.defineProperty(viewport, 'scrollHeight', { value: 500, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })
      Object.defineProperty(cmScroller, 'scrollTop', { value: 0, configurable: true, writable: true })
      Object.defineProperty(cmScroller, 'scrollHeight', { value: 2000, configurable: true })
      Object.defineProperty(cmScroller, 'clientHeight', { value: 500, configurable: true })

      await restoreScrollTop(container, 350)
      // .cm-scroller 的 scrollTop 应被设置
      expect(cmScroller.scrollTop).toBe(350)
      // Radix viewport 不应被改动
      expect(viewport.scrollTop).toBe(0)
    })
  })
})
