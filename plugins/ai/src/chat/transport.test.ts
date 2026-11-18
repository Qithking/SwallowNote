/**
 * TauriChatTransport 单测（P2.4）：
 * - chunk 转换：{text} 增量 → start / text-start / text-delta / message-metadata / finish
 * - 未配置模型直接拒绝
 * - apiKey 经 getSecure 编排（model:<id>）
 * - abortSignal 触发 → stopStream（onStart 前 abort 的窗口由 onStart 补发覆盖）
 * - 后端错误帧 → error chunk 交 useChat
 */
import { describe, it, expect, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  TauriChatTransport,
  toBackendMessages,
  extractText,
  type BackendStreamChunk,
  type StreamChatResult,
  type TauriTransportDeps,
} from './transport'
import type { InvokeBackendStreamOptions } from '@swallow-note/plugin-sdk'

type ChunkSink = (chunk: BackendStreamChunk) => void

/** 构造受控的 invokeBackendStream 桩：捕获 onChunk/onStart/args，手动推进 */
function makeStreamStub() {
  let sink: ChunkSink | undefined
  let fireStart: ((requestId: number) => void) | undefined
  let resolveResult: ((r: StreamChatResult) => void) | undefined
  const invoke = vi.fn(
    async (
      _cmd: string,
      _args: Record<string, unknown> | undefined,
      onChunk: ChunkSink,
      options?: InvokeBackendStreamOptions,
    ) => {
      sink = onChunk
      fireStart = (id) => options?.onStart?.({ requestId: id })
      return new Promise<StreamChatResult>((resolve) => {
        resolveResult = resolve
      })
    },
  )
  return {
    invoke,
    pushText: (t: string) => sink?.({ text: t }),
    start: (id = 1) => fireStart?.(id),
    finish: (r: StreamChatResult = { ok: true }) => resolveResult?.(r),
    /** invoke 已被调用、事件句柄就绪（sendMessages 先 await getApiKey 再发起流） */
    armed: () => sink !== undefined && fireStart !== undefined && resolveResult !== undefined,
  }
}

const userMsg: UIMessage = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: '你好' }],
}

function makeDeps(overrides: Partial<Parameters<typeof TauriChatTransport.prototype.sendMessages>[0]> = {}) {
  const stub = makeStreamStub()
  const deps = {
    invokeBackend: vi.fn(async () => ({ cancelled: true })),
    // vi.fn 推断为具体签名，断言对齐 TauriTransportDeps 的泛型签名
    invokeBackendStream: stub.invoke as unknown as TauriTransportDeps['invokeBackendStream'],
    getModelId: (): string | null => 'model-1',
    getApiKey: vi.fn(async () => 'sk-test'),
    stub,
  }
  return deps
}

function collectChunks(
  transport: TauriChatTransport,
  messages: UIMessage[],
  abortSignal?: AbortSignal,
  body?: { roleKey?: string },
) {
  const chunks: unknown[] = []
  const promise = transport
    .sendMessages({ messages, abortSignal, body })
    .then((stream) => {
      const reader = stream.getReader()
      const pull = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) return
        chunks.push(value)
        return pull()
      }
      return pull()
    })
  return { chunks, promise }
}

describe('toBackendMessages / extractText', () => {
  it('拼接 text parts 并保留 role', () => {
    const msg: UIMessage = {
      id: 'x',
      role: 'assistant',
      parts: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }],
    }
    expect(extractText(msg)).toBe('第一段\n第二段')
    expect(toBackendMessages([userMsg, msg])).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '第一段\n第二段' },
    ])
  })
})

describe('TauriChatTransport.sendMessages', () => {
  it('未配置模型时抛错', async () => {
    const deps = makeDeps()
    deps.getModelId = () => null
    const transport = new TauriChatTransport(deps)
    await expect(transport.sendMessages({ messages: [userMsg] })).rejects.toThrow(
      '请先在设置中添加模型',
    )
  })

  it('chunk 序列正确且 apiKey/modelId/messages 组装进参数', async () => {
    const deps = makeDeps()
    const transport = new TauriChatTransport(deps)
    const { chunks, promise } = collectChunks(transport, [userMsg])
    await vi.waitFor(() => expect(deps.stub.armed()).toBe(true))

    deps.stub.start(7)
    deps.stub.pushText('你')
    deps.stub.pushText('好')
    deps.stub.finish({ ok: true, omitted: 0 })

    await promise
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'message-metadata',
      'finish',
    ])
    expect(deps.getApiKey).toHaveBeenCalledWith('model-1')
    expect(deps.invokeBackendStream).toHaveBeenCalledWith(
      'streamChat',
      {
        modelId: 'model-1',
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: '你好' }],
      },
      expect.any(Function),
      expect.objectContaining({ firstChunkTimeoutSecs: 90 }),
    )
    const meta = chunks.find((c) => (c as { type: string }).type === 'message-metadata')
    expect((meta as { messageMetadata: unknown }).messageMetadata).toEqual({
      stopped: undefined,
      omitted: 0,
    })
  })

  it('abortSignal 触发后调 stopStream', async () => {
    const deps = makeDeps()
    const transport = new TauriChatTransport(deps)
    const controller = new AbortController()
    const { promise } = collectChunks(transport, [userMsg], controller.signal)
    await vi.waitFor(() => expect(deps.stub.armed()).toBe(true))

    deps.stub.start(42)
    controller.abort()
    deps.stub.finish({ ok: true, stopped: true })

    await promise
    expect(deps.invokeBackend).toHaveBeenCalledWith('stopStream', { requestId: 42 })
  })

  it('onStart 前 abort：通道建立时补发 stopStream', async () => {
    const deps = makeDeps()
    const transport = new TauriChatTransport(deps)
    const controller = new AbortController()
    const { promise } = collectChunks(transport, [userMsg], controller.signal)
    await vi.waitFor(() => expect(deps.stub.armed()).toBe(true))

    controller.abort()
    deps.stub.start(9)
    deps.stub.finish({ ok: true, stopped: true })

    await promise
    expect(deps.invokeBackend).toHaveBeenCalledWith('stopStream', { requestId: 9 })
  })

  it('后端错误帧 → error chunk（errorText 透传）', async () => {
    const deps = makeDeps()
    deps.invokeBackendStream = vi.fn(async () => {
      throw new Error('模型不存在')
    })
    const transport = new TauriChatTransport(deps)
    const { chunks, promise } = collectChunks(transport, [userMsg])
    await promise
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toEqual(['start', 'error'])
    expect((chunks[1] as { errorText: string }).errorText).toBe('模型不存在')
  })

  it('body.roleKey 透传进 streamChat 参数（P2.5 角色动作）', async () => {
    const deps = makeDeps()
    const transport = new TauriChatTransport(deps)
    const { promise } = collectChunks(transport, [userMsg], undefined, { roleKey: 'polish' })
    await vi.waitFor(() => expect(deps.stub.armed()).toBe(true))
    deps.stub.start(1)
    deps.stub.finish({ ok: true })
    await promise
    expect(deps.invokeBackendStream).toHaveBeenCalledWith(
      'streamChat',
      {
        modelId: 'model-1',
        apiKey: 'sk-test',
        messages: [{ role: 'user', content: '你好' }],
        roleKey: 'polish',
      },
      expect.any(Function),
      expect.objectContaining({ firstChunkTimeoutSecs: 90 }),
    )
  })
})
