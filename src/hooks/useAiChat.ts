/**
 * useAiChat - 封装 AIView 的 useChat 集成、stopRef 与模型初始化逻辑。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { getAiProxyUrl } from '@/lib/ai'
import { restartAiProxy } from '@/lib/tauri'
import { logger } from '@/lib/logger'
import type { AiModelConfig } from '@/lib/ai'

export function useAiChat({
  aiPort,
  activeAiModelId,
  aiModels,
  defaultAiModelId,
  setActiveAiModel,
}: {
  aiPort: number
  activeAiModelId: string
  aiModels: AiModelConfig[]
  defaultAiModelId: string
  setActiveAiModel: (id: string) => void
}) {
  // ref 让 mount-only useEffect 读取最新 aiPort / activeAiModelId，避免 stale closure
  const aiPortRef = useRef(aiPort)
  aiPortRef.current = aiPort
  const activeAiModelIdRef = useRef(activeAiModelId)
  activeAiModelIdRef.current = activeAiModelId

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: getAiProxyUrl(aiPort),
    }),
  })

  const { messages, status, stop, error, sendMessage, setMessages } = chat
  const isLoading = status === 'submitted' || status === 'streaming'

  // Stop any in-flight AI stream on unmount so callbacks don't update state (R-M4)
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    return () => {
      stopRef.current()
    }
  }, [])

  // 模型初始化: 无 active 或不在列表时设默认; 重启代理
  useEffect(() => {
    const currentActiveAiModelId = activeAiModelIdRef.current
    const currentAiPort = aiPortRef.current
    if ((!currentActiveAiModelId || !aiModels.find((m) => m.id === currentActiveAiModelId)) && aiModels.length > 0) {
      const defaultModel = defaultAiModelId && aiModels.find((m) => m.id === defaultAiModelId)
      setActiveAiModel(defaultModel ? defaultModel.id : aiModels[0].id)
    }
    if (currentActiveAiModelId) {
      const model = aiModels.find((m) => m.id === currentActiveAiModelId)
      if (model) {
        const apiKey = model._decryptedApiKey || ''
        restartAiProxy(model.provider, apiKey, model.baseUrl, model.model, currentAiPort).catch((e) => logger.error('ai-view', 'Failed to restart AI proxy:', e))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    messages,
    status,
    stop,
    error,
    sendMessage,
    setMessages,
    isLoading,
    activeAiModelIdRef,
  }
}
