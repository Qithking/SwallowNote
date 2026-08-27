/**
 * useAiMessageTrimming - 内存消息超限裁剪逻辑。
 * 拥有 pruneAuxiliaryRefs 与裁剪 effect; 共享 ref 由主壳传入。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useEffect, type MutableRefObject } from 'react'
import { getMessageText } from '@/lib/ai-utils'
import { saveAiMessage } from '@/lib/tauri'
import { logger } from '@/lib/logger'

export function useAiMessageTrimming<T extends { id: string; role: string; parts?: Array<{ type: string; text?: string }> }>({
  messages,
  isLoading,
  setMessages,
  savedMessageIds,
  contextMenuDisplayTexts,
  displayTextMappedIds,
  setMessageTimestamps,
  pendingUserTimestampsByCount,
  activeAiModelIdRef,
}: {
  messages: T[]
  isLoading: boolean
  setMessages: (msgs: T[]) => void
  savedMessageIds: MutableRefObject<Set<string>>
  contextMenuDisplayTexts: MutableRefObject<Map<string, string>>
  displayTextMappedIds: MutableRefObject<Set<string>>
  setMessageTimestamps: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  pendingUserTimestampsByCount: MutableRefObject<Map<number, string>>
  activeAiModelIdRef: MutableRefObject<string>
}) {
  const MAX_IN_MEMORY_MESSAGES = 100

  // 集中清理按 id 索引的辅助容器: 裁剪 messages 时同步释放对应数据，避免只增不删内存泄漏
  const pruneAuxiliaryRefs = (trimmedIds: string[]) => {
    for (const id of trimmedIds) {
      savedMessageIds.current.delete(id)
      contextMenuDisplayTexts.current.delete(id)
      displayTextMappedIds.current.delete(id)
    }
    // messageTimestamps 是 useState，需通过 setter 构造新对象以触发渲染
    if (trimmedIds.length > 0) {
      const idSet = new Set(trimmedIds)
      setMessageTimestamps((prev) => {
        const next: Record<string, string> = {}
        let changed = false
        for (const key in prev) {
          if (idSet.has(key)) {
            changed = true
          } else {
            next[key] = prev[key]
          }
        }
        return changed ? next : prev
      })
    }
  }

  // Trim in-memory messages when they exceed the limit to prevent unbounded memory growth
  useEffect(() => {
    if (messages.length <= MAX_IN_MEMORY_MESSAGES) return
    // Don't trim during active streaming to avoid disrupting the response
    if (isLoading) return
    const discardCount = messages.length - MAX_IN_MEMORY_MESSAGES
    const toDiscard = messages.slice(0, discardCount)
    // 裁剪前先把待裁剪的 user 消息 flush 到 DB，失败则跳过裁剪保留在内存，下次 effect 重新尝试
    let cancelled = false
    const flushAndTrim = async () => {
      for (const msg of toDiscard) {
        if (msg.role === 'user' && !savedMessageIds.current.has(msg.id)) {
          const text = getMessageText(msg)
          if (text) {
            try {
              await saveAiMessage('user', text, activeAiModelIdRef.current || '')
              savedMessageIds.current.add(msg.id)
            } catch (e) {
              logger.error('ai-view', 'Failed to flush user message before trim, skipping trim:', e)
              return
            }
          }
        }
      }
      if (cancelled) return
      const trimmed = messages.slice(messages.length - MAX_IN_MEMORY_MESSAGES)
      pruneAuxiliaryRefs(toDiscard.map((m) => m.id))
      // 裁剪后 countAtSend 索引失效，清空整个 Map 避免误赋 timestamp
      pendingUserTimestampsByCount.current.clear()
      setMessages(trimmed)
    }
    flushAndTrim()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isLoading])
}
