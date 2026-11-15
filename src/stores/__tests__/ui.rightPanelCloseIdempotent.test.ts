/**
 * 右面板关闭幂等性单测（bug: 切换到应用设置时窗口宽度变小）。
 *
 * 根因：ActivityBar 设置按钮在右面板未打开时也会调用 setRightPanelType(null)
 * （确保右面板关闭），而 setRightPanelType 的 null 分支缺少幂等保护，
 * 无条件执行 adjustWindowWidthForPanel(false, panelWidth) 把窗口收窄
 * rightPanelWidth(400px)，即使右面板本就没打开。
 *
 * 期望语义：setRightPanelType(null) = 「确保右面板关闭」——
 * 已关闭时应为 no-op，不得再次收窄窗口。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUIStore } from '@/stores'

// mock 窗口 API：innerSize 1200×800、scaleFactor 1（逻辑像素=物理像素），
// setSize 用 vi.fn 记录调用，断言窗口是否被缩放
const setSizeMock = vi.fn((_size: { width: number; height: number }) => Promise.resolve())
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    isFullscreen: () => Promise.resolve(false),
    innerSize: () => Promise.resolve({ width: 1200, height: 800 }),
    scaleFactor: () => Promise.resolve(1),
    setSize: setSizeMock,
  }),
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}))

// jsdom 的 innerWidth 是原型只读 getter，用 defineProperty 覆盖为可写
const setViewportWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
}

/** 等待一轮宏任务,确保 async action 链执行完毕 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  setSizeMock.mockClear()
  // 视口宽度与「真关闭」路径的收敛目标(1200-400=800)一致，轮询第一轮即收敛
  setViewportWidth(800)
  useUIStore.setState({ rightPanelType: null })
})

describe('setRightPanelType(null) 幂等性', () => {
  it('右面板已关闭时调用 null：窗口不得被收窄（no-op）', async () => {
    expect(useUIStore.getState().rightPanelType).toBeNull()
    await useUIStore.getState().setRightPanelType(null)
    await flushMicrotasks()
    expect(setSizeMock).not.toHaveBeenCalled()
    expect(useUIStore.getState().rightPanelType).toBeNull()
  })

  it('右面板打开时调用 null：窗口收窄面板宽（正常关闭路径不受影响）', async () => {
    useUIStore.setState({ rightPanelType: 'history' })
    await useUIStore.getState().setRightPanelType(null)
    await flushMicrotasks()
    expect(setSizeMock).toHaveBeenCalledTimes(1)
    // 1200 - 400 = 800，高度不变
    expect(setSizeMock.mock.calls[0][0].width).toBe(800)
    expect(setSizeMock.mock.calls[0][0].height).toBe(800)
    expect(useUIStore.getState().rightPanelType).toBeNull()
  })
})
