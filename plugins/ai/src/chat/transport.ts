/**
 * TauriChatTransport（P2.4）：AI SDK v6 `ChatTransport` 的插件后端实现。
 *
 * 数据流：useChat → sendMessages（UIMessage[]）→ 后端 streamChat
 * （{modelId, apiKey, messages}，见方案 §6.10）→ invokeBackendStream 通知帧
 * → 转换为 UIMessageChunk 流交回 useChat。
 *
 * 停止通道：宿主 start 事件下发 requestId（onStart 捕获），abortSignal 触发时
 * 调后端 stopStream 取消（后端置位 cancel → 尽快收尾为 stopped-done）。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { InvokeBackendStreamOptions } from '@swallow-note/plugin-sdk'

/** 后端 streamChat 通知帧 chunk 载荷：{"text": "..."} */
export interface BackendStreamChunk {
  text?: string
}

/** streamChat 响应帧 result（chat.rs）：{ok, stopped?, omitted?} */
export interface StreamChatResult {
  ok?: boolean
  /** 用户停止（B7 cancel 置位收尾） */
  stopped?: boolean
  /** 上下文截断丢弃的字符数（§6.9） */
  omitted?: number
}

/** 后端 ChatMessage（context.rs）：role 透传，content 为纯文本 */
export interface BackendChatMessage {
  role: string
  content: string
}

/** transport 外部依赖（由面板层注入，便于测试与解耦） */
export interface TauriTransportDeps {
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  invokeBackendStream: <T = unknown, R = unknown>(
    command: string,
    args: Record<string, unknown> | undefined,
    onChunk: (chunk: T) => void,
    options?: InvokeBackendStreamOptions
  ) => Promise<R>
  /** 当前选中模型 id（发送时实时取）；null 表示未配置模型 */
  getModelId: () => string | null
  /** 读取模型 API key（secureStorage `model:<id>`；未配置返回 null） */
  getApiKey: (modelId: string) => Promise<string | null>
}

/** 从 UIMessage 提取纯文本（拼接全部 text part） */
export function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

/** UIMessage[] → 后端 messages（role/content） */
export function toBackendMessages(messages: UIMessage[]): BackendChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: extractText(m) }))
}

/** 对话文本 part 的固定 id（单文本块渲染，无多段需求） */
const TEXT_PART_ID = 'reply'

export class TauriChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly deps: TauriTransportDeps) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
    /** AI SDK ChatRequestOptions.body 透传：角色动作经此携带 roleKey（P2.5，§6.6 双层提示词由后端拼装） */
    body?: { roleKey?: string }
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, body } = options
    const modelId = this.deps.getModelId()
    if (!modelId) {
      throw new Error('请先在设置中添加模型')
    }
    const apiKey = (await this.deps.getApiKey(modelId)) ?? ''

    // 停止编排：start 事件捕获 requestId；abort 时调后端 stopStream。
    // 「abort 先于通道建立」的窗口由 onStart 内补发覆盖。
    let requestId: number | undefined
    let aborted = false
    const stopNow = () => {
      if (requestId !== undefined) {
        void this.deps.invokeBackend('stopStream', { requestId }).catch(() => {})
      }
    }
    abortSignal?.addEventListener(
      'abort',
      () => {
        aborted = true
        stopNow()
      },
      { once: true },
    )

    const streamOptions: InvokeBackendStreamOptions = {
      // 首块超时 90s（方案 D14：适配推理模型首 token 常超 30s）
      firstChunkTimeoutSecs: 90,
      onStart: (info) => {
        requestId = info.requestId
        if (aborted) stopNow()
      },
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        const push = (chunk: UIMessageChunk) => controller.enqueue(chunk)
        push({ type: 'start' })
        let textStarted = false
        const endText = () => {
          if (textStarted) {
            push({ type: 'text-end', id: TEXT_PART_ID })
            textStarted = false
          }
        }
        try {
          const result = await this.deps.invokeBackendStream<
            BackendStreamChunk,
            StreamChatResult
          >(
            'streamChat',
            {
              modelId,
              apiKey,
              messages: toBackendMessages(messages),
              // 角色动作：roleKey 进 streamChat 参数（后端解析透传，P2.6 拼装双层提示词）
              ...(body?.roleKey ? { roleKey: body.roleKey } : {}),
            },
            (chunk) => {
              const text = chunk?.text ?? ''
              if (text === '') return
              if (!textStarted) {
                push({ type: 'text-start', id: TEXT_PART_ID })
                textStarted = true
              }
              push({ type: 'text-delta', id: TEXT_PART_ID, delta: text })
            },
            streamOptions,
          )
          endText()
          // stopped/omitted 经 message-metadata 传递，UI 在 onFinish 中读取
          push({
            type: 'message-metadata',
            messageMetadata: { stopped: result?.stopped, omitted: result?.omitted },
          })
          push({ type: 'finish' })
          controller.close()
        } catch (e) {
          endText()
          // 错误经 error chunk 交给 useChat（chat.error 呈现错误横幅）
          push({
            type: 'error',
            errorText: e instanceof Error ? e.message : String(e),
          })
          controller.close()
        }
      },
      // 中途取消读取（useChat.stop 已先触发 abortSignal → stopStream）
      cancel() {},
    })
  }

  /** 无重连语义：刷新/切换会话历史直接从数据库加载 */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
