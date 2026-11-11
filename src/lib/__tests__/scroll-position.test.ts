/**
 * scroll-position 回归测试
 *
 * 核心 bug：restoreScrollTop 在「内容首次可滚」的第一帧就设置 scrollTop 并结束，
 * 但 BlockNote（预览模式）的图片/mermaid/代码高亮等是异步渲染的，scrollHeight
 * 会持续增长 → 恢复发生在早期高度上，位置偏上（用户报「接近但偏移」）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { restoreScrollTop } from '../scroll-position'

/** 手动 rAF 队列：完全控制帧推进，不依赖真实时间 */
let rafCallbacks: Map<number, () => void>
let rafSeq: number

/** 推进 n 帧（每帧执行后清空微任务，让 promise 链稳定；并推进虚拟时钟 100ms/帧） */
async function flushFrames(n: number) {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(100)
    const cbs = [...rafCallbacks.values()]
    rafCallbacks.clear()
    for (const cb of cbs) cb()
    await Promise.resolve()
  }
}

interface ViewportFixture {
  container: HTMLElement
  setScrollHeight: (h: number) => void
  getScrollTop: () => number
}

/** 构造 MarkdownEditor 形态的容器（Radix viewport 为滚动容器），尺寸完全可控 */
function createEditorFixture(clientHeight = 500): ViewportFixture {
  const container = document.createElement('div')
  const viewport = document.createElement('div')
  viewport.setAttribute('data-radix-scroll-area-viewport', '')
  container.appendChild(viewport)

  let scrollHeight = 0
  let scrollTop = 0
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  Object.defineProperty(viewport, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })
  Object.defineProperty(viewport, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v },
  })

  return {
    container,
    setScrollHeight: (h: number) => { scrollHeight = h },
    getScrollTop: () => scrollTop,
  }
}

describe('restoreScrollTop', () => {
  beforeEach(() => {
    // 虚拟时钟仅 mock Date（restoreScrollTop 内部用 Date.now() 判断超时），
    // rAF 由上方手动 stub 全权接管，避免 fake timers 的 rAF 与之冲突
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    rafCallbacks = new Map()
    rafSeq = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafSeq
      rafCallbacks.set(id, () => cb(0))
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('内容渐进渲染（scrollHeight 后续增长）时，最终滚动位置应对齐 savedTop', async () => {
    const f = createEditorFixture()
    // 帧1 时内容只渲染了一部分：可滚，但 scrollHeight - clientHeight = 600 < savedTop 800
    f.setScrollHeight(1100)
    const p = restoreScrollTop(f.container, 800)

    await flushFrames(1)
    // 内容渲染完成（图片加载等）：总高度增长到 3000
    f.setScrollHeight(3000)
    await flushFrames(10)
    await p

    // 期望恢复到保存时的位置 800（对齐内容锚点），而不是早期高度下的 600
    expect(f.getScrollTop()).toBe(800)
  })

  it('内容一次性渲染完成时仍能正确恢复（回归保护）', async () => {
    const f = createEditorFixture()
    f.setScrollHeight(3000)
    const p = restoreScrollTop(f.container, 800)

    await flushFrames(10)
    await p

    expect(f.getScrollTop()).toBe(800)
  })

  it('内容比视口短（不可滚）时不设置 scrollTop', async () => {
    const f = createEditorFixture()
    f.setScrollHeight(400)
    const p = restoreScrollTop(f.container, 800)

    // 推进到超过 3000ms 超时（每帧 100ms 虚拟时间）
    await flushFrames(35)
    await p

    expect(f.getScrollTop()).toBe(0)
  })

  it('savedTop 为 0 或 null 时不执行恢复', async () => {
    const f = createEditorFixture()
    f.setScrollHeight(3000)

    await restoreScrollTop(f.container, 0)
    await restoreScrollTop(f.container, null)

    expect(f.getScrollTop()).toBe(0)
    expect(rafCallbacks.size).toBe(0)
  })

  it('abort 信号触发后立即停止且不再改写 scrollTop', async () => {
    const f = createEditorFixture()
    f.setScrollHeight(1100)
    const controller = new AbortController()
    const p = restoreScrollTop(f.container, 800, 3000, controller.signal)

    await flushFrames(1)
    controller.abort()
    f.setScrollHeight(3000)
    await flushFrames(10)
    await p

    // 取消后不得把旧 tab 的位置写到（已被新 tab 复用的）容器上
    expect(f.getScrollTop()).toBe(0)
    expect(rafCallbacks.size).toBe(0)
  })
})
