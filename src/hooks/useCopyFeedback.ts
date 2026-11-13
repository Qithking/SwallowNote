/**
 * C17：复制反馈共享 hook。
 *
 * 统一「复制成功 → copied=true → 定时复位」模式，并在卸载时清理定时器。
 * 原先 EditorToolbar / PluginDiagnosticsPanel / SplitDiffViewer（远端与本地
 * 两份）各自手写相同逻辑，行为一致故聚合到此处。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopyFeedback(resetMs = 3000) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 卸载时清理定时器，避免对已卸载组件的 setState
  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  const markCopied = useCallback(() => {
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])

  return { copied, markCopied }
}
