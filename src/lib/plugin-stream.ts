/**
 * 插件后端流式调用桥接：封装 Tauri Channel + `invoke_plugin_stream` 命令。
 *
 * 协议（ADR-0002）：后端在 JSON-RPC 响应帧之外，可向 stdout 写通知帧
 * `{"method":"swallow/stream","params":{"requestId":<请求id>,"event":"chunk"|"done"|"error","data":...}}`；
 * 宿主按 requestId 将通知帧路由到对应 Channel 推送到前端。
 * invoke 的 Promise 仍由响应帧终结（返回最终结果 R）。
 */
import { assertPermission } from './plugin-permission-guard'
import { logger } from './logger'

/** 经 Channel 推送到前端的事件载荷（与 Rust 侧 StreamEvent 对齐）。 */
interface PluginStreamEvent {
  event: 'start' | 'chunk' | 'done' | 'error'
  data: unknown
}

/** `invokeBackendStream` 可选项。 */
export interface InvokeBackendStreamOptions {
  /** 流式首块超时秒数（默认 90s，与宿主 STREAM_FIRST_CHUNK_TIMEOUT 一致）。 */
  firstChunkTimeoutSecs?: number
  /** 通道建立时回调，携带宿主生成的 requestId——插件可据此调用后端自身
   *  的取消命令（如 AI 插件的 stopStream）实现流式中断（通用停止通道）。 */
  onStart?: (info: { requestId: number }) => void
}

/**
 * 调用插件后端流式命令：onChunk 逐块回调增量，Promise resolve 为后端
 * 最终响应（响应帧 result）。done/error 通知帧是后端语义信号，由调用方
 * 结合最终响应处理；调用失败（超时/进程退出/后端 JSON-RPC error）时 reject。
 */
export async function invokePluginBackendStream<T = unknown, R = unknown>(
  pluginId: string,
  command: string,
  args: Record<string, unknown> | undefined,
  onChunk: (chunk: T) => void,
  options?: InvokeBackendStreamOptions,
): Promise<R> {
  assertPermission(pluginId, 'backend', `invoke backend stream command "${command}"`)
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<PluginStreamEvent>()
  channel.onmessage = (msg) => {
    // chunk 逐块回调；start 下发 requestId（通用停止通道）；
    // done/error 的调用语义由响应帧终结，仅记日志。
    if (msg.event === 'chunk') {
      onChunk(msg.data as T)
    } else if (msg.event === 'start') {
      const requestId = (msg.data as { requestId?: unknown } | null)?.requestId
      if (typeof requestId === 'number') options?.onStart?.({ requestId })
    } else {
      logger.debug(
        'plugin-stream',
        `[${pluginId}] stream "${command}" received ${msg.event} event`,
      )
    }
  }
  const start = performance.now()
  let success = true
  let errorMsg: string | undefined
  try {
    return (await invoke('invoke_plugin_stream', {
      pluginId,
      command,
      args,
      stream: channel,
      firstChunkTimeoutSecs: options?.firstChunkTimeoutSecs,
    })) as R
  } catch (err) {
    success = false
    errorMsg = String(err)
    throw err
  } finally {
    const durationMs = performance.now() - start
    void import('./plugin-telemetry').then(({ recordBackendMetric }) => {
      recordBackendMetric(pluginId, command, durationMs, success, errorMsg)
    })
  }
}
