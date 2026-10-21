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

const PID = 'test-plugin'

/** setup.ts 全局 core mock 的 invoke（默认 resolved undefined） */
const invokeMock = vi.mocked(invoke)

beforeEach(() => {
  clearAll()
  useUIStore.setState({ rightPanelType: null, pendingPluginRequest: null })
  usePluginStore.setState({ activeRightPanelPluginId: null })
})

describe('openPluginPanel：面板请求管道写入', () => {
  it('写入 rightPanelType=plugin:<id>、激活插件、pending 透传 payload', () => {
    openPluginPanel(PID, { text: 'hi' })
    expect(useUIStore.getState().rightPanelType).toBe(`plugin:${PID}`)
    expect(usePluginStore.getState().activeRightPanelPluginId).toBe(PID)
    expect(useUIStore.getState().pendingPluginRequest).toEqual({
      pluginId: PID,
      payload: { text: 'hi' },
    })
  })

  it('payload 缺省：清空残留 pending（防旧 payload 泄漏），面板仍正常打开', () => {
    openPluginPanel(PID, { stale: true })
    expect(useUIStore.getState().pendingPluginRequest).not.toBeNull()
    openPluginPanel(PID)
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
