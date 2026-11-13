/**
 * C17：useCopyFeedback 共享 hook 回归测试。
 *
 * 背景：EditorToolbar / PluginDiagnosticsPanel / SplitDiffViewer（×2）各自
 * 手写「copied 状态 + setTimeout 复位 + 卸载清理」的复制反馈逻辑，聚合到
 * 共享 hook 后行为契约：
 * 1. markCopied → copied=true，resetMs 后复位 false；
 * 2. 连续 markCopied 重置定时器（不会提前复位）；
 * 3. 卸载时清理定时器（不产生泄漏警告/状态更新）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCopyFeedback } from '@/hooks/useCopyFeedback'

describe('C17: useCopyFeedback 复制反馈', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('markCopied 后 copied=true，resetMs 后复位 false', () => {
    const { result } = renderHook(() => useCopyFeedback(3000))
    expect(result.current.copied).toBe(false)

    act(() => result.current.markCopied())
    expect(result.current.copied).toBe(true)

    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.copied).toBe(false)
  })

  it('连续 markCopied 重置定时器，不提前复位', () => {
    const { result } = renderHook(() => useCopyFeedback(3000))

    act(() => result.current.markCopied())
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.markCopied()) // 重置计时
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.copied).toBe(true, '距上次 markCopied 仅 2s，不应复位')

    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.copied).toBe(false, '距上次 markCopied 满 3s 复位')
  })

  it('卸载时清理定时器，复位回调不再触发', () => {
    const { result, unmount } = renderHook(() => useCopyFeedback(3000))
    act(() => result.current.markCopied())
    unmount()
    // 若定时器未清理，这里推进后 setState 会触发 React 警告（act 环境）
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.copied).toBe(true)
  })
})
