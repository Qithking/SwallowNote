/**
 * 右分隔条拖拽（右面板宽度持久化）——usePanelResize seam。
 *
 * 需求：拖拽 Editor 与右面板之间的分隔条时仅更新面板宽度（编辑区由 flex:1
 * 自动吸收差值，窗口总宽不变），宽度持久化，下次打开面板按上次宽度展示。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePanelResize } from '@/hooks/usePanelResize'
import { useUIStore } from '@/stores'

function flushRaf() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

describe('usePanelResize 右分隔条拖拽（Editor ↔ 右面板）', () => {
  beforeEach(() => {
    useUIStore.setState({ rightPanelWidth: 250 } as never)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
  })

  it('拖拽到 clientX=800：面板宽 = 1200-800=400（编辑区由 flex 吸收差值）', async () => {
    const { result } = renderHook(() => usePanelResize(() => Promise.resolve()))
    act(() => { result.current.handleMouseDownRight() })
    act(() => {
      // mousemove 监听注册在 document 上（usePanelResize effect），须 dispatch 到 document
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }))
    })
    await flushRaf()

    expect(useUIStore.getState().rightPanelWidth).toBe(400)

    act(() => { document.dispatchEvent(new MouseEvent('mouseup')) })
  })

  it('拖拽越界钳制：clientX=1400 → 面板宽下限 150', async () => {
    const { result } = renderHook(() => usePanelResize(() => Promise.resolve()))
    act(() => { result.current.handleMouseDownRight() })

    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1400 })) })
    await flushRaf()

    expect(useUIStore.getState().rightPanelWidth).toBe(150)

    act(() => { document.dispatchEvent(new MouseEvent('mouseup')) })
  })

  it('editorWidth 机制已删除（编辑区宽度由 flex 布局决定，窗口随面板开合自适应）', () => {
    expect('editorWidth' in useUIStore.getState()).toBe(false)
  })
})
