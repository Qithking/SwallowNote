/**
 * 右面板开合时窗口自适应宽度（编辑区宽度不变）——ui store seam。
 *
 * 需求：应用初始后第一次打开右面板，编辑区宽度不变，窗口宽度自动加宽以
 * 适应面板（默认 400px）；关闭面板时窗口收窄同等宽度。后续拖拽产生的
 * 面板宽度变化持久化，下次打开按上次宽度展示。
 *
 * 顺序契约（防闪动）：
 * ① 窗口加宽先于面板渲染——DOM 未变时窗口已就位；
 * ② 窗口 resize 之前同步派发锁宽事件（right-panel-transition-start），编辑区
 *    显式锁定当前宽度后 webview 重排不动，杜绝「编辑区 flex 瞬时变宽再缩回」
 *    的跳动；面板渲染/卸载完成后派发解锁事件（right-panel-transition-end）。
 * ③ 解锁必须等待 webview 视口宽度收敛到目标——setSize 的 Promise resolve 不代表
 *    DOM 视口已更新（跨进程异步），解锁早于视口更新会让 flex-1 编辑区在旧视口
 *    宽度下瞬间扩展（关闭方向闪动）。
 * 关闭方向对称：锁宽 → 卸载面板 → 收窄窗口 → （视口收敛后）解锁。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUIStore } from '@/stores'

const mockState = vi.hoisted(() => ({
  maximized: false,
  fullscreen: false,
  windowWidth: 1200, // 物理像素（mock scaleFactor=1，等于逻辑像素）
  windowHeight: 800,
}))

const setSizeMock = vi.hoisted(() => vi.fn())

// jsdom 的 innerWidth 是原型只读 getter，用 defineProperty 覆盖为可写以模拟视口
const setViewportWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
}

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(mockState.maximized),
    isFullscreen: () => Promise.resolve(mockState.fullscreen),
    innerSize: () => Promise.resolve({ width: mockState.windowWidth, height: mockState.windowHeight }),
    scaleFactor: () => Promise.resolve(1),
    setSize: setSizeMock,
  }),
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}))

// 模块加载时的原始默认值（各测试文件隔离模块注册表，此处未被 setState 污染）
const initialRightPanelWidth = useUIStore.getState().rightPanelWidth

describe('ui store 右面板开合窗口自适应（编辑区宽度不变）', () => {
  let order: string[]
  let offTransition: () => void

  beforeEach(() => {
    mockState.maximized = false
    mockState.fullscreen = false
    mockState.windowWidth = 1200
    setSizeMock.mockClear()
    useUIStore.setState({ rightPanelType: null, rightPanelWidth: 400 } as never)

    // 记录锁宽事件与窗口 resize 的发生顺序
    order = []
    setViewportWidth(mockState.windowWidth)
    setSizeMock.mockImplementation(async (size: { width: number }) => {
      order.push(`setSize:type=${useUIStore.getState().rightPanelType}`)
      // 模拟真实窗口 resize 同步更新视口宽度（即时收敛路径）
      setViewportWidth(size.width)
    })
    const onStart = () => order.push('lock')
    const onEnd = () => order.push('unlock')
    window.addEventListener('right-panel-transition-start', onStart)
    window.addEventListener('right-panel-transition-end', onEnd)
    offTransition = () => {
      window.removeEventListener('right-panel-transition-start', onStart)
      window.removeEventListener('right-panel-transition-end', onEnd)
    }
  })

  afterEach(() => {
    offTransition()
  })

  it('默认面板宽度 400', () => {
    expect(initialRightPanelWidth).toBe(400)
  })

  it('打开面板：锁宽先于 resize、resize 先于面板渲染、最后解锁，窗口 1200 → 1600', async () => {
    await useUIStore.getState().setRightPanelType('directory')
    // 锁宽同步生效后再 resize（编辑区重排时不动），面板渲染后才解锁
    expect(order).toEqual(['lock', 'setSize:type=null', 'unlock'])
    expect(useUIStore.getState().rightPanelType).toBe('directory')
    expect(setSizeMock.mock.calls[0][0].width).toBe(1600)
    expect(setSizeMock.mock.calls[0][0].height).toBe(800)
  })

  it('关闭面板：锁宽 → 卸载面板 → 收窄窗口 → 解锁，窗口 1600 → 1200', async () => {
    mockState.windowWidth = 1600
    useUIStore.setState({ rightPanelType: 'directory' } as never)
    await useUIStore.getState().setRightPanelType(null)
    expect(order).toEqual(['lock', 'setSize:type=null', 'unlock'])
    expect(useUIStore.getState().rightPanelType).toBeNull()
    expect(setSizeMock.mock.calls[0][0].width).toBe(1200)
  })

  it('最大化时跳过窗口调整，锁宽/解锁仍成对执行，面板状态仍切换', async () => {
    mockState.maximized = true
    await useUIStore.getState().setRightPanelType('directory')
    expect(setSizeMock).not.toHaveBeenCalled()
    expect(order).toEqual(['lock', 'unlock'])
    expect(useUIStore.getState().rightPanelType).toBe('directory')
  })

  it('打开面板：解锁必须等待视口收敛到目标宽度（setSize resolve ≠ 视口已更新）', async () => {
    // 滞后模式：setSize 只记录顺序，不更新视口（跨进程异步由 30ms 定时器模拟）
    setSizeMock.mockImplementation(async (size: { width: number }) => {
      order.push(`setSize:type=${useUIStore.getState().rightPanelType}`)
    })
    setViewportWidth(1200)
    let viewportAtUnlock = 0
    const onEndRecord = () => {
      viewportAtUnlock = window.innerWidth
    }
    window.addEventListener('right-panel-transition-end', onEndRecord)
    const timer = setTimeout(() => setViewportWidth(1600), 30)
    try {
      await useUIStore.getState().setRightPanelType('directory')
      expect(order).toEqual(['lock', 'setSize:type=null', 'unlock'])
      expect(viewportAtUnlock).toBe(1600)
    } finally {
      clearTimeout(timer)
      window.removeEventListener('right-panel-transition-end', onEndRecord)
    }
  })

  it('关闭面板：解锁必须等待视口收敛到目标宽度（1600 → 1200 滞后场景）', async () => {
    setSizeMock.mockImplementation(async (size: { width: number }) => {
      order.push(`setSize:type=${useUIStore.getState().rightPanelType}`)
    })
    mockState.windowWidth = 1600
    setViewportWidth(1600)
    useUIStore.setState({ rightPanelType: 'directory' } as never)
    let viewportAtUnlock = 0
    const onEndRecord = () => {
      viewportAtUnlock = window.innerWidth
    }
    window.addEventListener('right-panel-transition-end', onEndRecord)
    const timer = setTimeout(() => setViewportWidth(1200), 30)
    try {
      await useUIStore.getState().setRightPanelType(null)
      expect(order).toEqual(['lock', 'setSize:type=null', 'unlock'])
      expect(viewportAtUnlock).toBe(1200)
    } finally {
      clearTimeout(timer)
      window.removeEventListener('right-panel-transition-end', onEndRecord)
    }
  })

  it('视口永不收敛时超时兜底解锁，不悬挂锁宽', async () => {
    setViewportWidth(1200) // 打开目标 1600，视口永不更新 → 走超时兜底
    await useUIStore.getState().setRightPanelType('directory')
    expect(order).toEqual(['lock', 'setSize:type=null', 'unlock'])
    expect(useUIStore.getState().rightPanelType).toBe('directory')
  })
})
