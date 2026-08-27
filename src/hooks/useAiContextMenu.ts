/**
 * useAiContextMenu - 处理右键菜单触发的 AI 对话请求。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { UIMessage } from 'ai'
import { saveAiMessage, type AiRolePrompt } from '@/lib/tauri'
import { logger } from '@/lib/logger'
import { type AiContextMenuRequest } from '@/stores'

export function useAiContextMenu({
  aiContextMenuRequest,
  isConfigured,
  setAiContextMenuRequest,
  setRightPanelType,
  setActiveRoleKey,
  messages,
  pendingUserTimestampsByCount,
  trimPendingTimestampsLRU,
  pendingDisplayTexts,
  pendingDisplayTextQueue,
  aiRolePrompts,
  sendMessage,
  activeAiModelId,
  historyReadyRef,
}: {
  aiContextMenuRequest: AiContextMenuRequest | null
  isConfigured: boolean
  setAiContextMenuRequest: (req: null) => void
  setRightPanelType: (type: 'ai') => void
  setActiveRoleKey: (key: string) => void
  messages: UIMessage[]
  pendingUserTimestampsByCount: MutableRefObject<Map<number, string>>
  trimPendingTimestampsLRU: () => void
  pendingDisplayTexts: MutableRefObject<Map<string, string>>
  pendingDisplayTextQueue: MutableRefObject<string[]>
  aiRolePrompts: AiRolePrompt[]
  sendMessage: (msg: { text: string }, opts?: { body: { systemPrompt: string } }) => void
  activeAiModelId: string
  historyReadyRef: MutableRefObject<boolean>
}) {
  const processedRequestIds = useRef<Set<string>>(new Set())
  const MAX_PROCESSED_IDS = 100

  useEffect(() => {
    if (!aiContextMenuRequest || !isConfigured) return

    const requestId = aiContextMenuRequest.id
    if (processedRequestIds.current.has(requestId)) return
    processedRequestIds.current.add(requestId)
    if (processedRequestIds.current.size > MAX_PROCESSED_IDS) {
      const iter = processedRequestIds.current.values()
      processedRequestIds.current.delete(iter.next().value!)
    }

    setAiContextMenuRequest(null)

    const { roleKey, roleName, hasSelection, content, lineRange, filePath } = aiContextMenuRequest

    setRightPanelType('ai')

    let displayMessage: string
    if (hasSelection && lineRange) {
      displayMessage = `[${roleName}] ${filePath} (L${lineRange[0]}-L${lineRange[1]})`
    } else {
      displayMessage = `[${roleName}] ${filePath}`
    }

    const aiContent = `${displayMessage}\n\n${content}`

    setActiveRoleKey(roleKey)

    const doSend = () => {
      const now = new Date()
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      const countBeforeSend = messages.length
      pendingUserTimestampsByCount.current.set(countBeforeSend, timeStr)
      trimPendingTimestampsLRU()

      const correlationId = crypto.randomUUID()
      pendingDisplayTexts.current.set(correlationId, displayMessage)
      pendingDisplayTextQueue.current.push(correlationId)

      const rolePrompt = aiRolePrompts.find((p) => p.role_key === roleKey)
      const systemPrompt = rolePrompt?.prompt || ''

      if (systemPrompt) {
        sendMessage({ text: aiContent }, { body: { systemPrompt } })
      } else {
        sendMessage({ text: aiContent })
      }

      saveAiMessage('user', displayMessage, activeAiModelId || '').catch((e) => logger.error('ai-view', 'Failed to save AI user message:', e))
    }

    if (historyReadyRef.current) {
      doSend()
    } else {
      let checkInterval: ReturnType<typeof setInterval> | null = null
      let safetyTimeout: ReturnType<typeof setTimeout> | null = null

      checkInterval = setInterval(() => {
        if (historyReadyRef.current) {
          if (checkInterval) clearInterval(checkInterval)
          if (safetyTimeout) clearTimeout(safetyTimeout)
          doSend()
        }
      }, 50)

      safetyTimeout = setTimeout(() => {
        if (checkInterval) clearInterval(checkInterval)
        if (!historyReadyRef.current) {
          historyReadyRef.current = true
          doSend()
        }
      }, 3000)

      return () => {
        if (checkInterval) clearInterval(checkInterval)
        if (safetyTimeout) clearTimeout(safetyTimeout)
      }
    }
  }, [aiContextMenuRequest]) // eslint-disable-line react-hooks/exhaustive-deps
}
