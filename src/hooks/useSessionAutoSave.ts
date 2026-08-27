/**
 * useSessionAutoSave — 会话自动保存 hook
 * 监听编辑器标签页变化和面板宽度变化，500ms 防抖触发保存；
 * 监听 save-session-now 事件立即保存。
 * 从 App.tsx 提取，保持行为不变。
 */
import { useEffect } from 'react'
import { useEditorStore, useUIStore } from '@/stores'
import { logger } from '@/lib/logger'

export function useSessionAutoSave(saveSessionStateNow: () => Promise<void>) {
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
        saveTimer = null
      }, 500)
    }

    // 仅在 tabs 切片变化时触发保存，避免 cursorPosition 等无关状态变更无谓触发防抖保存
    const unsubscribeTabs = useEditorStore.subscribe(s => s.tabs, scheduleSave)

    // 面板宽度变化时也触发保存（拖拽缩放后即使无标签变化也能持久化）
    const unsubscribeUI = useUIStore.subscribe((state, prevState) => {
      if (state.sidebarWidth !== prevState.sidebarWidth ||
          state.rightPanelWidth !== prevState.rightPanelWidth) {
        scheduleSave()
      }
    })

    // Listen for save-session-now events (e.g., before install & restart)
    const handleSaveSessionNow = () => {
      saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
    }
    window.addEventListener('save-session-now', handleSaveSessionNow)

    return () => {
      unsubscribeTabs()
      unsubscribeUI()
      window.removeEventListener('save-session-now', handleSaveSessionNow)
      if (saveTimer) clearTimeout(saveTimer)
    }
  }, [saveSessionStateNow])
}
