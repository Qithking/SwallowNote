/**
 * invokePluginBackendStream 桥接单测（P2.4）：
 * - start 事件经 options.onStart 下发宿主 requestId（通用停止通道）
 * - chunk 事件逐块回调 onChunk；done/error 仅记日志不回调
 * - Promise 以响应帧结果（invoke 返回值）终结
 * - 无 backend 权限时拒绝
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 共享 mock 状态：vi.mock 工厂经 hoisted 状态与测试通信
const mocks = vi.hoisted(() => {
  const messageHandlers: Array<(msg: { event: string; data: unknown }) => void> = []
  let capturedArgs: Record<string, unknown> | undefined
  return {
    messageHandlers,
    get capturedArgs() {
      return capturedArgs
    },
    setCaptured(args: Record<string, unknown>) {
      capturedArgs = args
    },
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args: Record<string, unknown>) => {
    mocks.setCaptured(args)
    return { ok: true }
  }),
  // class 形式才能被 new；构造时注册到 messageHandlers 供测试模拟宿主推送
  Channel: class {
    onmessage?: (msg: { event: string; data: unknown }) => void
    constructor() {
      mocks.messageHandlers.push((msg) => this.onmessage?.(msg))
    }
  },
}))

import { invokePluginBackendStream } from '@/lib/plugin-stream'
import { setGranted } from '@/lib/plugin-permission-guard'

describe('invokePluginBackendStream', () => {
  beforeEach(() => {
    mocks.messageHandlers.length = 0
    
    setGranted('test-plugin', ['backend'])
  })

  it('start 事件经 onStart 下发 requestId，chunk 逐块回调，Promise 以响应帧结果终结', async () => {
    const chunks: unknown[] = []
    const onStart = vi.fn()
    const done = invokePluginBackendStream<{ text: string }, { ok: boolean }>(
      'test-plugin',
      'streamChat',
      { modelId: 'm1' },
      (c) => chunks.push(c),
      { onStart },
    )

    // 宿主先推 start（携带 requestId），再推 chunk / done。
    // 注意 invokeBackendStream 内部是动态 import，Channel 在微任务后才构造，
    // 需等待注册完成再模拟宿主推送。
    await vi.waitFor(() => expect(mocks.messageHandlers.length).toBe(1))
    mocks.messageHandlers[0]({ event: 'start', data: { requestId: 7 } })
    mocks.messageHandlers[0]({ event: 'chunk', data: { text: '你' } })
    mocks.messageHandlers[0]({ event: 'chunk', data: { text: '好' } })
    mocks.messageHandlers[0]({ event: 'done', data: { omitted: 0 } })

    await expect(done).resolves.toEqual({ ok: true })
    expect(onStart).toHaveBeenCalledWith({ requestId: 7 })
    expect(chunks).toEqual([{ text: '你' }, { text: '好' }])
    expect(mocks.capturedArgs).toMatchObject({ pluginId: 'test-plugin', command: 'streamChat' })
  })

  it('start 事件 requestId 非数字时不回调 onStart', async () => {
    const onStart = vi.fn()
    const done = invokePluginBackendStream('test-plugin', 'cmd', undefined, () => {}, { onStart })
    await vi.waitFor(() => expect(mocks.messageHandlers.length).toBe(1))
    mocks.messageHandlers[0]({ event: 'start', data: { requestId: 'not-a-number' } })
    mocks.messageHandlers[0]({ event: 'done', data: null })
    await expect(done).resolves.toEqual({ ok: true })
    expect(onStart).not.toHaveBeenCalled()
  })

  it('未提供 onStart 时 start 事件被安全忽略', async () => {
    const done = invokePluginBackendStream('test-plugin', 'cmd', undefined, () => {})
    await vi.waitFor(() => expect(mocks.messageHandlers.length).toBe(1))
    mocks.messageHandlers[0]({ event: 'start', data: { requestId: 1 } })
    mocks.messageHandlers[0]({ event: 'done', data: null })
    await expect(done).resolves.toEqual({ ok: true })
  })

  it('无 backend 权限时抛 PluginPermissionDeniedError', async () => {
    setGranted('test-plugin', [])
    await expect(
      invokePluginBackendStream('test-plugin', 'cmd', undefined, () => {}),
    ).rejects.toThrow(/missing permission: backend/)
  })
})
