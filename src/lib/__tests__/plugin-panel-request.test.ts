/**
 * P1.4 面板一次性请求管道单测。
 *
 * 覆盖方案 §6.3 的管道语义：
 * 1. openPluginPanel 写入 rightPanelType / activeRightPanelPluginId / pendingPluginRequest
 * 2. payload 缺省（undefined）时清空残留 pending，防旧 payload 泄漏到下次打开
 * 3. 连续触发以最新请求覆盖
 * 4. backend 权限联动预热：有权限调 prewarm_plugin、无权限不调、失败静默
 * 5. createPluginPanelProps 注入 pendingRequest：仅归属本插件时透出 payload
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { openPluginPanel, createPluginPanelProps } from '../plugin-utils'
import { useUIStore, usePluginStore } from '@/stores'
import { setGranted, clearAll } from '../plugin-permission-guard'

// setRightPanelType 现为 async(开面板先加宽窗口再渲染,防闪动),mock 窗口 API 让
// resize 链在本文件内确定性完成,断言前 flush microtask 等状态写入落定。
// 另需视口宽度与 mock 的 resize 目标(1200+400=1600)一致:解锁前会轮询等待
// webview 视口收敛,不设则走 150ms 超时兜底,flush 一轮等不到状态落定
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    isFullscreen: () => Promise.resolve(false),
    innerSize: () => Promise.resolve({ width: 1200, height: 800 }),
    scaleFactor: () => Promise.resolve(1),
    setSize: () => Promise.resolve(),
  }),
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}))

// jsdom 的 innerWidth 是原型只读 getter，用 defineProperty 覆盖为可写
const setViewportWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
}

/** 等待一轮宏任务,确保所有已排队的 microtask(async action 链)执行完毕 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const PID = 'test-plugin'

/** setup.ts 全局 core mock 的 invoke（默认 resolved undefined） */
const invokeMock = vi.mocked(invoke)

beforeEach(() => {
  clearAll()
  setViewportWidth(1600) // 与 mock resize 目标一致，视口轮询第一轮即收敛
  useUIStore.setState({ rightPanelType: null, pendingPluginRequest: null })
  usePluginStore.setState({ activeRightPanelPluginId: null })
})

describe('openPluginPanel：面板请求管道写入', () => {
  it('写入 rightPanelType=plugin:<id>、激活插件、pending 透传 payload', async () => {
    openPluginPanel(PID, { text: 'hi' })
    await flushMicrotasks()
    expect(useUIStore.getState().rightPanelType).toBe(`plugin:${PID}`)
    expect(usePluginStore.getState().activeRightPanelPluginId).toBe(PID)
    expect(useUIStore.getState().pendingPluginRequest).toEqual({
      pluginId: PID,
      payload: { text: 'hi' },
    })
  })

  it('payload 缺省：清空残留 pending（防旧 payload 泄漏），面板仍正常打开', async () => {
    openPluginPanel(PID, { stale: true })
    expect(useUIStore.getState().pendingPluginRequest).not.toBeNull()
    openPluginPanel(PID)
    await flushMicrotasks()
    expect(useUIStore.getState().pendingPluginRequest).toBeNull()
    expect(useUIStore.getState().rightPanelType).toBe(`plugin:${PID}`)
    expect(usePluginStore.getState().activeRightPanelPluginId).toBe(PID)
  })

  it('连续触发：以最新请求覆盖', () => {
    openPluginPanel(PID, { v: 1 })
    openPluginPanel(PID, { v: 2 })
    expect(useUIStore.getState().pendingPluginRequest).toEqual({
      pluginId: PID,
      payload: { v: 2 },
    })
  })
})

describe('openPluginPanel：backend 权限联动预热', () => {
  it('有 backend 权限：调用 prewarm_plugin（仅拉起进程，无 JSON-RPC）', async () => {
    setGranted(PID, ['backend'])
    openPluginPanel(PID, 'x')
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prewarm_plugin', { pluginId: PID })
    })
  })

  it('无 backend 权限：不预热', async () => {
    openPluginPanel(PID, 'x')
    await Promise.resolve()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('预热失败静默：openPluginPanel 不抛错，rejection 内部消化', async () => {
    setGranted(PID, ['backend'])
    invokeMock.mockRejectedValueOnce(new Error('spawn failed'))
    expect(() => openPluginPanel(PID, 'x')).not.toThrow()
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prewarm_plugin', { pluginId: PID })
    })
  })
})

describe('createPluginPanelProps：pendingRequest 注入', () => {
  it('pending 归属本插件：透出 payload', () => {
    useUIStore.setState({ pendingPluginRequest: { pluginId: PID, payload: 'sel-data' } })
    const props = createPluginPanelProps(PID, true, () => {})
    expect(props.pendingRequest).toBe('sel-data')
  })

  it('pending 归属其他插件：注入 null', () => {
    useUIStore.setState({ pendingPluginRequest: { pluginId: 'other', payload: 'x' } })
    const props = createPluginPanelProps(PID, true, () => {})
    expect(props.pendingRequest).toBeNull()
  })

  it('无 pending：注入 null', () => {
    const props = createPluginPanelProps(PID, true, () => {})
    expect(props.pendingRequest).toBeNull()
  })

  it('显式传入请求状态（组件订阅重渲染路径）：归属过滤后透出最新 payload', () => {
    // PanelContent 订阅 UIStore 后把状态显式传入（面板已挂载时连续触发的送达路径）
    useUIStore.setState({ pendingPluginRequest: { pluginId: PID, payload: { v: 2 } } })
    const props = createPluginPanelProps(
      PID,
      true,
      () => {},
      '',
      '',
      useUIStore.getState().pendingPluginRequest,
    )
    expect(props.pendingRequest).toEqual({ v: 2 })

    // 归属其他插件：注入 null
    useUIStore.setState({ pendingPluginRequest: { pluginId: 'other', payload: 'x' } })
    const propsOther = createPluginPanelProps(
      PID,
      true,
      () => {},
      '',
      '',
      useUIStore.getState().pendingPluginRequest,
    )
    expect(propsOther.pendingRequest).toBeNull()
  })
})
