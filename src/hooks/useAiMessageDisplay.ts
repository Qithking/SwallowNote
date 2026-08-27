/**
 * useAiMessageDisplay - 右键消息展示文本映射子系统。
 * 拥有 contextMenu/pendingDisplay 4 个 ref 与 FIFO 匹配 effect。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useRef, useEffect } from 'react'

export function useAiMessageDisplay<T extends { id: string; role: string }>(messages: T[]) {
  // 右键消息的展示文本映射，避免显示全文
  const contextMenuDisplayTexts = useRef<Map<string, string>>(new Map())
  // 待映射展示文本: 以发送时生成的稳定 correlation id 为 key，避免 history 头部插入错位
  const pendingDisplayTexts = useRef<Map<string, string>>(new Map())
  // 发送顺序队列: 按 FIFO 将 pending 展示文本匹配到新出现的 user 消息
  const pendingDisplayTextQueue = useRef<Array<string>>([])
  // 已匹配过展示文本的 user 消息 id 集合，避免重复匹配
  const displayTextMappedIds = useRef<Set<string>>(new Set())

  // 当 messages 变化时，按 FIFO 把待映射展示文本匹配到新出现的 user 消息
  useEffect(() => {
    if (pendingDisplayTextQueue.current.length === 0) return
    const unmapped = messages.filter(
      (msg) => msg.role === 'user' && !displayTextMappedIds.current.has(msg.id)
    )
    while (pendingDisplayTextQueue.current.length > 0 && unmapped.length > 0) {
      const correlationId = pendingDisplayTextQueue.current.shift()!
      const msg = unmapped.shift()!
      const displayText = pendingDisplayTexts.current.get(correlationId)
      if (displayText !== undefined) {
        contextMenuDisplayTexts.current.set(msg.id, displayText)
        pendingDisplayTexts.current.delete(correlationId)
      }
      displayTextMappedIds.current.add(msg.id)
    }
  }, [messages])

  return {
    contextMenuDisplayTexts,
    pendingDisplayTexts,
    pendingDisplayTextQueue,
    displayTextMappedIds,
  }
}
