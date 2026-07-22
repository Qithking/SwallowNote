import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores'
import {
  parseKeyEvent,
  findShortcutConflictDetailed,
  formatShortcutForDisplay,
  type ShortcutConflict,
} from '@/lib/shortcuts'
import { RotateCcw } from 'lucide-react'
import type { PluginCommand } from '@/types/plugin'

interface PluginCommandRecorderProps {
  /** Stable `<pluginId>:<commandId>` key used to look up the binding. */
  bindingKey: string
  /** The plugin command whose shortcut we're recording. */
  command: PluginCommand
}

/**
 * Recorder for a single plugin-command keyboard binding.
 *
 * Mirrors the built-in `ShortcutRecorder` UX (click-to-record, badge
 * pulses while listening, click-outside cancels, Esc aborts) but
 * routes through `findShortcutConflictDetailed` so the conflict
 * banner can call out plugin-command clashes, not just built-in
 * shortcuts.
 *
 * Conflict resolution policy: a conflict is *shown* in the UI and
 * the binding is still written to the store. The store doesn't
 * reject the write because (a) the user can still want a binding
 * even if it shadows a built-in (they might disable the built-in
 * later) and (b) the keyboard handler resolves ties with a defined
 * precedence order (built-ins win over plugin commands), so a
 * "conflicting" plugin command is *not* actually reachable while
 * the built-in is bound.
 */
export function PluginCommandRecorder({ bindingKey, command }: PluginCommandRecorderProps) {
  const { t } = useTranslation()
  const {
    customShortcuts,
    pluginCommandShortcuts,
    setPluginCommandShortcut,
    resetPluginCommandShortcut,
  } = useUIStore(
    useShallow((s) => ({
      customShortcuts: s.customShortcuts,
      pluginCommandShortcuts: s.pluginCommandShortcuts,
      setPluginCommandShortcut: s.setPluginCommandShortcut,
      resetPluginCommandShortcut: s.resetPluginCommandShortcut,
    })),
  )
  const [recording, setRecording] = useState(false)
  const [conflict, setConflict] = useState<ShortcutConflict | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentValue = pluginCommandShortcuts[bindingKey]
  const isBound = !!currentValue

  const handleStartRecording = useCallback(() => {
    setRecording(true)
    setConflict(null)
  }, [])

  const handleStopRecording = useCallback(() => {
    setRecording(false)
  }, [])

  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 仅在实际处理按键时调用 preventDefault

      if (e.key === 'Escape') {
        // Escape 取消录制并消费事件
        e.preventDefault()
        e.stopPropagation()
        handleStopRecording()
        return
      }

      const parsed = parseKeyEvent(e)
      if (!parsed) {
        // 纯修饰键放行，不阻止默认行为
        return
      }

      // 确认 chord 后消费事件并阻止冒泡
      e.preventDefault()
      e.stopPropagation()

      // 构建标签映射供冲突提示显示
      const labels: Record<string, string> = {}
      labels[bindingKey] = command.label

      const found = findShortcutConflictDetailed(
        bindingKey,
        parsed,
        customShortcuts,
        pluginCommandShortcuts,
        labels
      )
      setConflict(found)
      setPluginCommandShortcut(bindingKey, parsed)
      handleStopRecording()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    recording,
    bindingKey,
    command.label,
    customShortcuts,
    pluginCommandShortcuts,
    setPluginCommandShortcut,
    handleStopRecording,
  ])

  useEffect(() => {
    if (!recording) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleStopRecording()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [recording, handleStopRecording])

  return (
    <div ref={containerRef} className="flex items-center gap-2">
      <div onClick={handleStartRecording} className="cursor-pointer">
        {recording ? (
          <Badge
            variant="outline"
            className="font-mono text-xs px-2 py-1 border-primary text-primary animate-pulse"
          >
            {t('settings.shortcuts.recording')}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={`font-mono text-xs px-2 py-1 ${
              conflict ? 'border-yellow-500 text-yellow-500' : ''
            }`}
          >
            {currentValue ? formatShortcutForDisplay(currentValue) : t('settings.pluginCommands.unbound')}
          </Badge>
        )}
      </div>
      {conflict && (
        <span className="text-xs text-yellow-500">{conflict.message}</span>
      )}
      {isBound && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            resetPluginCommandShortcut(bindingKey)
            setConflict(null)
          }}
          title={t('settings.shortcuts.reset')}
        >
          <RotateCcw size={12} />
        </Button>
      )}
    </div>
  )
}
