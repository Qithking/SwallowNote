/**
 * 滚动位置保存/恢复 helper
 *
 * 用于 tab 切换和关闭应用时读取当前编辑器滚动容器的 scrollTop，
 * 以及 tab 内容渲染完成后恢复 scrollTop。
 */
/** Radix ScrollArea 的 viewport 选择器（MarkdownEditor 和 CodeEditor 共用） */
export const SCROLL_CONTAINER_SELECTOR = '[data-radix-scroll-area-viewport]'

/** CodeMirror 的滚动容器选择器（CodeEditor 专用） */
const CM_SCROLLER_SELECTOR = '.cm-scroller'

/**
 * 在给定容器内查找实际滚动容器。
 *
 * CodeEditor (CodeMirror) 的 .cm-scroller 有 overflow:auto（basicSetup 默认主题），
 * 是实际滚动容器，嵌套在 Radix viewport 内部。Radix viewport 的 scrollTop 永远为 0。
 * MarkdownEditor (BlockNote) 的 .bn-editor 没有 overflow:auto，
 * Radix viewport 是实际滚动容器。
 *
 * 优先检测 .cm-scroller，不存在时回退到 Radix viewport。
 *
 * @param container 编辑器容器 DOM 元素
 * @returns 滚动容器元素，不存在时返回 null
 */
export function findScrollContainer(container: HTMLElement): HTMLElement | null {
  // CodeEditor: .cm-scroller 是实际滚动容器
  const cmScroller = container.querySelector<HTMLElement>(CM_SCROLLER_SELECTOR)
  if (cmScroller) return cmScroller
  // MarkdownEditor: Radix viewport 是实际滚动容器
  return container.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR)
}

/**
 * 从给定容器内读取滚动容器的当前 scrollTop。
 * @param container 编辑器容器 DOM 元素
 * @returns scrollTop 值（px），容器不存在时返回 null
 */
export function readScrollTop(container: HTMLElement | null): number | null {
  if (!container) return null
  const viewport = findScrollContainer(container)
  if (!viewport) return null
  return viewport.scrollTop
}

/**
 * 在给定容器内恢复滚动位置。
 * 每次轮询重新查询 viewport（处理编辑器 remount 导致 viewport DOM 元素变化），
 * 等 scrollHeight 稳定（连续 STABLE_THRESHOLD 次不变）后再设置 scrollTop，
 * 避免 BlockNote 异步分批渲染时 scrollHeight 持续增长导致 scrollTop 被 clamp 到错误值。
 * 超时放弃（默认 3000ms，留足 BlockNote 异步解析时间）。
 *
 * @param container 编辑器容器 DOM 元素
 * @param savedScrollTop 要恢复的 scrollTop 值；0 或 null 时不执行恢复
 * @param timeoutMs 超时毫秒数，默认 3000
 */
export function restoreScrollTop(
  container: HTMLElement | null,
  savedScrollTop: number | null | undefined,
  timeoutMs = 3000,
): Promise<void> {
  if (!container) return Promise.resolve()
  if (!savedScrollTop || savedScrollTop <= 0) return Promise.resolve()

  const start = Date.now()
  // scrollHeight 连续不变的次数阈值（~3 帧 ≈ 48ms 稳定后才 restore）
  const STABLE_THRESHOLD = 3
  let lastScrollHeight = 0
  let stableCount = 0

  return new Promise<void>((resolve) => {
    const tryRestore = () => {
      // 每次轮询重新查询滚动容器（编辑器 remount 后 DOM 元素会变化）
      const viewport = findScrollContainer(container)
      if (!viewport) {
        // 编辑器还没 mount，继续等待
        if (Date.now() - start >= timeoutMs) {
          resolve()
          return
        }
        requestAnimationFrame(tryRestore)
        return
      }
      const { scrollHeight, clientHeight } = viewport
      // 内容还没渲染到可滚动状态，继续等待
      if (scrollHeight <= clientHeight) {
        if (Date.now() - start >= timeoutMs) {
          resolve()
          return
        }
        requestAnimationFrame(tryRestore)
        return
      }
      // scrollHeight 仍在变化（BlockNote 异步分批渲染中），等稳定后再 restore
      if (scrollHeight !== lastScrollHeight) {
        lastScrollHeight = scrollHeight
        stableCount = 0
        if (Date.now() - start >= timeoutMs) {
          // 超时 fallback：用当前 scrollHeight restore（比不 restore 好）
          const clampedTop = Math.min(savedScrollTop, scrollHeight - clientHeight)
          viewport.scrollTop = clampedTop
          resolve()
          return
        }
        requestAnimationFrame(tryRestore)
        return
      }
      // scrollHeight 未变化，累加稳定计数
      stableCount++
      if (stableCount >= STABLE_THRESHOLD) {
        // 内容渲染稳定，restore scrollTop（此时不会被错误 clamp）
        const clampedTop = Math.min(savedScrollTop, scrollHeight - clientHeight)
        viewport.scrollTop = clampedTop
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        const clampedTop = Math.min(savedScrollTop, scrollHeight - clientHeight)
        viewport.scrollTop = clampedTop
        resolve()
        return
      }
      requestAnimationFrame(tryRestore)
    }
    tryRestore()
  })
}
