import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores'
import { ShortcutKey, parseKeyEvent, findShortcutConflictDetailed, formatShortcutForDisplay, getShortcutKey } from '@/lib/shortcuts'
import { usePluginCommands } from '@/lib/plugin-hooks'
import type { PluginCommand } from '@/types/plugin'
import { RotateCcw } from 'lucide-react'

interface ShortcutRecorderProps {
  shortcutKey: ShortcutKey
}

export function ShortcutRecorder({ shortcutKey }: ShortcutRecorderProps) {
  const { t } = useTranslation()
  const { customShortcuts, pluginCommandShortcuts, setShortcut, resetShortcut } = useUIStore()
  const [recording, setRecording] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build a label map for all registered plugin commands so that
  // findShortcutConflictDetailed can show *which* plugin command
  // clashes, not just the raw binding key.
  const pluginCommands = usePluginCommands()
  const pluginCommandLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const cmd of pluginCommands) {
      const entry = cmd as PluginCommand & { __pluginId: string }
      labels[`${entry.__pluginId}:${cmd.id}`] = cmd.label
    }
    return labels
  }, [pluginCommands])

  const currentValue = getShortcutKey(shortcutKey, customShortcuts)
  const isDefault = !customShortcuts[shortcutKey]

  const handleStartRecording = useCallback(() => {
    setRecording(true)
    setConflict(null)
  }, [])

  const handleStopRecording = useCallback(() => {
    setRecording(false)
    setConflict(null)
  }, [])

  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        handleStopRecording()
        return
      }

      const parsed = parseKeyEvent(e)
      if (!parsed) return

      // Use the detailed conflict checker so both built-in and
      // plugin-command clashes are detected.
      const found = findShortcutConflictDetailed(
        shortcutKey,
        parsed,
        customShortcuts,
        pluginCommandShortcuts,
        pluginCommandLabels,
      )

      setShortcut(shortcutKey, parsed)
      handleStopRecording()

      // Set conflict AFTER handleStopRecording (which clears conflict)
      // so the message survives into the idle state.
      if (found) {
        if (found.source.kind === 'plugin-command') {
          setConflict(found.message)
        } else {
          setConflict(t('settings.shortcuts.conflict', { key: t(`settings.shortcuts.${found.source.key}`) }))
        }
      } else {
        setConflict(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, shortcutKey, customShortcuts, pluginCommandShortcuts, pluginCommandLabels, setShortcut, handleStopRecording, t])

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
      <div
        onClick={handleStartRecording}
        className="cursor-pointer"
      >
        {recording ? (
          <Badge variant="outline" className="font-mono text-xs px-2 py-1 border-primary text-primary animate-pulse">
            {t('settings.shortcuts.recording')}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={`font-mono text-xs px-2 py-1 ${conflict ? 'border-yellow-500 text-yellow-500' : ''}`}
          >
            {formatShortcutForDisplay(currentValue)}
          </Badge>
        )}
      </div>
      {conflict && (
        <span className="text-xs text-yellow-500">
          {conflict}
        </span>
      )}
      {!isDefault && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            resetShortcut(shortcutKey)
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
