/**
 * useAiScroll - 消息列表滚动到底的节流逻辑与滚动容器 ref。
 * 拥有 messagesEndRef、scrollViewportRef、scrollToBottomTimerRef 与 scroll effect。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { useRef, useEffect, useCallback } from 'react'

export function useAiScroll<T>(messages: T[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  // Throttled scroll-to-bottom: avoids excessive scroll calls during streaming
  const scrollToBottomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollToBottomTimerRef.current) return
    scrollToBottomTimerRef.current = setTimeout(() => {
      scrollToBottomTimerRef.current = null
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [])

  useEffect(() => {
    scrollToBottom()
    return () => {
      if (scrollToBottomTimerRef.current) {
        clearTimeout(scrollToBottomTimerRef.current)
        scrollToBottomTimerRef.current = null
      }
    }
  }, [messages, scrollToBottom])

  return { messagesEndRef, scrollViewportRef }
}
