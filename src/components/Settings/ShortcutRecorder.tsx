import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores'
import { ShortcutKey, parseKeyEvent, findShortcutConflict, formatShortcutForDisplay, getShortcutKey } from '@/lib/shortcuts'
import { RotateCcw } from 'lucide-react'

interface ShortcutRecorderProps {
  shortcutKey: ShortcutKey
}

export function ShortcutRecorder({ shortcutKey }: ShortcutRecorderProps) {
  const { t } = useTranslation()
  const { customShortcuts, setShortcut, resetShortcut } = useUIStore()
  const [recording, setRecording] = useState(false)
  const [conflict, setConflict] = useState<ShortcutKey | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

      const conflictKey = findShortcutConflict(shortcutKey, parsed, customShortcuts)
      setConflict(conflictKey)
      setShortcut(shortcutKey, parsed)
      handleStopRecording()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, shortcutKey, customShortcuts, setShortcut, handleStopRecording])

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
          {t('settings.shortcuts.conflict', { key: t(`settings.shortcuts.${conflict}`) })}
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
