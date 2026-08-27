/**
 * useAiHistory - AI 对话历史加载、分页加载更多、滚动监听、assistant 消息自动保存。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useState, useRef, useEffect, useCallback, type MutableRefObject, type RefObject } from 'react'
import type { UIMessage } from 'ai'
import { loadAiMessages, saveAiMessage } from '@/lib/tauri'
import { logger } from '@/lib/logger'
import { getMessageText } from '@/lib/ai-utils'

export function useAiHistory({
  isConfigured,
  status,
  messages,
  setMessages,
  savedMessageIds,
  setMessageTimestamps,
  scrollViewportRef,
  activeAiModelId,
}: {
  isConfigured: boolean
  status: string
  messages: UIMessage[]
  setMessages: (updater: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void
  savedMessageIds: MutableRefObject<Set<string>>
  setMessageTimestamps: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  scrollViewportRef: RefObject<HTMLDivElement | null>
  activeAiModelId: string
}) {
  const [oldestDbId, setOldestDbId] = useState<number | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const historyLoadedRef = useRef(false)
  const historyReadyRef = useRef(false)

  // 初始加载历史
  useEffect(() => {
    if (historyLoadedRef.current || !isConfigured) return
    historyLoadedRef.current = true
    const loadHistory = async () => {
      try {
        const dbMessages = await loadAiMessages(undefined, 30)
        if (dbMessages.length > 0) {
          const chatMessages = dbMessages.reverse().map((msg) => ({
            id: `db-${msg.id}`,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }],
          }))
          setMessages(chatMessages)
          const timestamps: Record<string, string> = {}
          dbMessages.forEach((msg) => {
            savedMessageIds.current.add(`db-${msg.id}`)
            timestamps[`db-${msg.id}`] = msg.created_at
          })
          setMessageTimestamps((prev) => ({ ...prev, ...timestamps }))
          setOldestDbId(dbMessages[0].id)
          setHasMoreHistory(dbMessages.length >= 30)
        }
      } catch (e) {
        logger.error('ai-view', 'Failed to load AI chat history:', e)
      } finally {
        historyReadyRef.current = true
      }
    }
    loadHistory()
  }, [isConfigured])

  // assistant 消息完成后自动保存到 DB
  useEffect(() => {
    if (status !== 'ready') return
    if (messages.length === 0) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant' && !savedMessageIds.current.has(lastMsg.id)) {
      const text = getMessageText(lastMsg)
      if (text) {
        savedMessageIds.current.add(lastMsg.id)
        const now = new Date()
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        setMessageTimestamps((prev) => ({ ...prev, [lastMsg.id]: timeStr }))
        saveAiMessage('assistant', text, activeAiModelId || '').catch((e) => logger.error('ai-view', 'Failed to save AI assistant message:', e))
      }
    }
  }, [status])

  // 分页加载更多历史
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingHistory || !hasMoreHistory || oldestDbId === null) return
    setIsLoadingHistory(true)
    try {
      const viewport = scrollViewportRef.current
      const prevScrollHeight = viewport?.scrollHeight || 0

      const dbMessages = await loadAiMessages(oldestDbId, 30)
      if (dbMessages.length > 0) {
        const chatMessages = dbMessages.reverse().map((msg) => ({
          id: `db-${msg.id}`,
          role: msg.role as 'user' | 'assistant',
          parts: [{ type: 'text' as const, text: msg.content }],
        }))
        setMessages((prev) => [...chatMessages, ...prev])
        const timestamps: Record<string, string> = {}
        dbMessages.forEach((msg) => {
          savedMessageIds.current.add(`db-${msg.id}`)
          timestamps[`db-${msg.id}`] = msg.created_at
        })
        setMessageTimestamps((prev) => ({ ...prev, ...timestamps }))
        setOldestDbId(dbMessages[0].id)
        setHasMoreHistory(dbMessages.length >= 30)

        requestAnimationFrame(() => {
          if (viewport) {
            const newScrollHeight = viewport.scrollHeight
            viewport.scrollTop = newScrollHeight - prevScrollHeight
          }
        })
      } else {
        setHasMoreHistory(false)
      }
    } catch (e) {
      logger.error('ai-view', 'Failed to load more history:', e)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [isLoadingHistory, hasMoreHistory, oldestDbId])

  // 滚动到顶部时触发加载更多
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const handleScroll = () => {
      if (viewport.scrollTop < 50 && hasMoreHistory && !isLoadingHistory) {
        loadMoreHistory()
      }
    }
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory])

  return {
    isLoadingHistory,
    historyReadyRef,
  }
}
