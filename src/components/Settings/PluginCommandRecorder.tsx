import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  } = useUIStore()
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
      // M14 (Wave D review): the previous implementation called
      // `e.preventDefault()` + `e.stopPropagation()` *unconditionally*
      // and only then branched on Escape / `parseKeyEvent`. That
      // meant a bare modifier press (Ctrl / Shift / Alt / Meta) —
      // which `parseKeyEvent` returns `null` for — still had the
      // event swallowed, breaking any subsequent `Ctrl+S` /
      // `Cmd+Shift+P` / etc. the user wanted to fire while the
      // recorder badge was active.
      //
      // The fix is to gate the consume: first decide whether we
      // are *going* to do something with the key, and only then
      // call `preventDefault` + `stopPropagation`. Pure modifier
      // presses fall through to the bottom of the function (and
      // out to the window), so the user's chain of `Ctrl`-then-`K`
      // keystrokes still reaches the rest of the app.

      if (e.key === 'Escape') {
        // Escape is the explicit "cancel recording" signal; we
        // do consume it (the user pressed Esc inside our dialog
        // chrome), and we use the same preventDefault contract
        // we always had.
        e.preventDefault()
        e.stopPropagation()
        handleStopRecording()
        return
      }

      const parsed = parseKeyEvent(e)
      if (!parsed) {
        // Modifier-only key (Ctrl / Shift / Alt / Meta) or any
        // other event `parseKeyEvent` declines to interpret. Do
        // *not* preventDefault or stopPropagation — let the
        // event bubble so e.g. `Ctrl+S` (which the user might
        // have already started composing before the recorder
        // was clicked) still reaches the global handler.
        return
      }

      // We have a real chord and we are going to commit it.
      // From here on the event is ours; preventDefault +
      // stopPropagation mirrors the original behaviour and
      // stops the chord from also firing its built-in
      // command (e.g. committing a Ctrl+P while also opening
      // the command palette).
      e.preventDefault()
      e.stopPropagation()

      // Build a quick label map so the conflict banner can show
      // *which* other command clashes. The conflict detector only
      // needs the *other* commands' labels, not our own.
      const labels: Record<string, string> = {}
      // For now we don't have a registry snapshot here; the labels
      // are read from `command.label` for the current command and
      // the conflict detector's built-in map covers the rest.
      // Cross-plugin labels would require plumbing the
      // `usePluginCommands()` snapshot down; we accept the
      // limitation (a conflict still shows the binding key, which
      // is unique) to keep this component self-contained.
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
