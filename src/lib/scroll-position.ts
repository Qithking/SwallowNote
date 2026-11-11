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
 * 每次轮询重新查询 viewport（处理编辑器 remount 导致 viewport DOM 元素变化）。
 *
 * 关键：不能在「首次可滚」的第一帧就设置——BlockNote 的图片/mermaid/代码高亮
 * 等是异步渲染的，scrollHeight 会持续增长，过早恢复会导致位置偏上。
 * 因此等待渲染稳定（scrollHeight 连续多帧不变且图片加载完成）后再设置；
 * 超时兜底按当前高度尽力恢复，避免大文件/慢图永不恢复。
 *
 * @param container 编辑器容器 DOM 元素
 * @param savedScrollTop 要恢复的 scrollTop 值；0 或 null 时不执行恢复
 * @param timeoutMs 超时毫秒数，默认 3000
 * @param signal 取消信号：tab 快速切换时调用方可中止旧恢复链，
 *               防止把旧 tab 的位置写到已被新 tab 复用的容器上
 */
export function restoreScrollTop(
  container: HTMLElement | null,
  savedScrollTop: number | null | undefined,
  timeoutMs = 3000,
  signal?: AbortSignal,
): Promise<void> {
  if (!container) return Promise.resolve()
  if (!savedScrollTop || savedScrollTop <= 0) return Promise.resolve()

  const start = Date.now()
  /** 连续 N 帧 scrollHeight 不变视为渲染稳定（约 64ms 稳定窗） */
  const STABLE_FRAMES = 4
  let lastHeight = -1
  let stableFrames = 0

  /** 容器内所有 <img> 均加载完成（complete 含加载失败），没有图片时恒真 */
  const imagesReady = () => {
    const imgs = container.querySelectorAll('img')
    for (const img of imgs) {
      if (!(img instanceof HTMLImageElement) || !img.complete) return false
    }
    return true
  }

  return new Promise<void>((resolve) => {
    const tryRestore = () => {
      if (signal?.aborted) {
        resolve()
        return
      }
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
      if (scrollHeight <= clientHeight) {
        // 内容不足一屏（或尚未渲染），无可滚；等待，超时放弃
        if (Date.now() - start >= timeoutMs) {
          resolve()
          return
        }
        requestAnimationFrame(tryRestore)
        return
      }
      // 高度仍在增长或图片未加载完 → 渲染未稳定，等稳定后再恢复
      if (scrollHeight !== lastHeight || !imagesReady()) {
        lastHeight = scrollHeight
        stableFrames = 0
        if (Date.now() - start >= timeoutMs) {
          // 超时兜底：按当前高度尽力恢复
          viewport.scrollTop = Math.min(savedScrollTop, scrollHeight - clientHeight)
          resolve()
          return
        }
        requestAnimationFrame(tryRestore)
        return
      }
      stableFrames++
      if (stableFrames >= STABLE_FRAMES || Date.now() - start >= timeoutMs) {
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
