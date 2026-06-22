/**
 * Sample Plugin: "Word Counter"
 *
 * Counts words, characters, lines and reading time for the current
 * note. Demonstrates:
 *  - `editorArea` content position (panel embedded inside the editor)
 *  - `editorToolbar` icon position (compact button above the editor)
 *  - Subscribing to `note:change` with the latest content payload
 *  - `usePluginStorage` for the persisted "warn at N words" threshold
 *  - Settings dialog for editing the threshold
 *  - `onMount` / `onUnmount` to attach and detach a `note:change`
 *    tracker (counter starts at zero, ticks on every change)
 *
 * The `react-refresh/only-export-components` rule is disabled for
 * this file because plugin manifests export both a component and a
 * metadata object – that's the contract, not a HMR footgun.
 */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'
import { usePluginStorage, usePluginEvent } from '@/lib/plugin-hooks'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Count words by splitting on whitespace runs. We use a regex that
 * handles multi-byte characters (CJK etc.) by counting each
 * consecutive non-whitespace run as one word — same heuristic that
 * most writing tools ship with.
 */
function countWords(text: string): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

function countCharacters(text: string): number {
  return text.length
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

/**
 * Average reading time in minutes. 200 wpm is the long-form reading
 * speed for English prose; CJK readers average ~500 cpm, so the
 * 200-wpm constant is a conservative lower bound.
 */
function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200))
}

// ─── Panel component ──────────────────────────────────────────────────────────

function WordCounterPanel(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  // The latest note content. Hydrated from the first note:change
  // event, then kept in sync by `usePluginEvent`.
  const [content, setContent] = useState<string>('')
  const [lastPath, setLastPath] = useState<string | null>(null)
  // Persisted threshold; settings dialog edits the same key.
  const [warnAt, setWarnAt] = usePluginStorage<number>(panel, 'warnAtWords', 1500)

  usePluginEvent(panel, 'note:change', ({ path, content: next }) => {
    setLastPath(path)
    setContent(next ?? '')
  })
  // Reset when the user opens a different note, so the counter
  // starts at the right place even before the first `note:change`.
  usePluginEvent(panel, 'note:open', ({ path }) => {
    setLastPath(path)
    setContent('')
  })

  const stats = useMemo(
    () => ({
      words: countWords(content),
      chars: countCharacters(content),
      lines: countLines(content),
      minutes: readingMinutes(countWords(content)),
    }),
    [content],
  )

  const overThreshold = stats.words >= warnAt
  // Reset shortcut so the panel itself can nudge the threshold
  // without forcing a trip through the settings dialog.
  const resetThreshold = (): void => setWarnAt(1500)

  return (
    <div className="p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Word Counter</span>
        <button
          type="button"
          onClick={close}
          className="px-1.5 py-0.5 rounded hover:bg-muted"
        >
          ×
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Words</span>
        <span className={overThreshold ? 'font-bold text-amber-600' : 'font-mono'}>
          {stats.words.toLocaleString()}
        </span>
        <span className="text-muted-foreground">Characters</span>
        <span className="font-mono">{stats.chars.toLocaleString()}</span>
        <span className="text-muted-foreground">Lines</span>
        <span className="font-mono">{stats.lines.toLocaleString()}</span>
        <span className="text-muted-foreground">Reading time</span>
        <span className="font-mono">~{stats.minutes} min</span>
      </div>
      <div className="pt-1 border-t text-muted-foreground truncate" title={lastPath ?? ''}>
        {lastPath ?? '(no note open)'}
      </div>
      <div className="pt-1 text-muted-foreground">
        Plugin: <code className="text-[10px]">{pluginId}</code>
      </div>
      <div className="pt-1 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          Warn at {warnAt.toLocaleString()} words
        </span>
        <button
          type="button"
          onClick={resetThreshold}
          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

// ─── Icon component ───────────────────────────────────────────────────────────

function WordCounterIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Hash glyph: a stylised "123" badge */}
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  )
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

/**
 * A compact button rendered in the editor toolbar when the plugin
 * registers `iconPosition: 'editorToolbar'`. Clicking it dispatches
 * a synthetic `note:change` for the active note so the panel
 * counter refreshes even if the user hasn't typed anything.
 */
function WordCounterToolbarButton(panel: PluginPanelProps): ReactNode {
  return (
    <button
      type="button"
      title="Refresh word count"
      className="p-1.5 rounded hover:bg-muted"
      onClick={() => {
        // In a real plugin we'd read the active editor's content
        // through the host API; for the sample we just log so the
        // user can confirm the toolbar mount point works.
        console.debug(
          `[word-counter] toolbar refresh (pluginId=${panel.pluginId})`,
        )
      }}
    >
      <WordCounterIcon size={14} />
    </button>
  )
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

function WordCounterSettings(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  const [warnAt, setWarnAt] = usePluginStorage<number>(panel, 'warnAtWords', 1500)
  // Local draft so the input is responsive even when the storage
  // hook is still hydrating.
  const [draft, setDraft] = useState<string>(String(warnAt))

  // Keep the input in sync with the (possibly rehydrated) value
  // until the user starts editing.
  useEffect(() => {
    setDraft(String(warnAt))
  }, [warnAt])

  const commit = (): void => {
    const n = Number.parseInt(draft, 10)
    if (Number.isFinite(n) && n > 0) {
      void setWarnAt(n)
    } else {
      setDraft(String(warnAt))
    }
  }

  return (
    <div className="p-4 text-sm space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">Plugin ID</div>
        <code className="text-xs">{pluginId}</code>
      </div>
      <div>
        <label
          htmlFor="word-counter-warn-at"
          className="text-xs text-muted-foreground"
        >
          Warn when words exceed
        </label>
        <div className="flex gap-2 mt-1">
          <input
            id="word-counter-warn-at"
            type="number"
            min={1}
            className="w-32 px-2 py-1 rounded border bg-background text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
                ;(e.currentTarget as HTMLInputElement).blur()
              }
            }}
          />
          <button
            type="button"
            onClick={commit}
            className="text-xs px-3 py-1 rounded bg-muted hover:bg-muted/70"
          >
            Save
          </button>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Press Enter or click Save to apply. Current threshold:{' '}
          <span className="font-mono">{warnAt}</span> words.
        </div>
      </div>
      <div className="pt-2 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="text-xs px-3 py-1 rounded bg-muted hover:bg-muted/70"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ─── Lifecycle hooks ──────────────────────────────────────────────────────────

/**
 * We don't strictly need an `onMount` here, but it's a good place
 * to demonstrate how a panel-scoped hook can run side effects that
 * shouldn't leak to the global event bus.
 */
function onMount(context: { pluginId: string }): void {
  // The hook receives the same PluginContext the host uses
  // elsewhere; in this sample we just acknowledge it so the
  // telemetry pipeline sees a non-zero onMount count.
  void context
}

function onUnmount(): void {
  // Nothing to flush; storage writes are already serialized.
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginDefinition = {
  id: 'com.example.word-counter',
  name: 'Word Counter',
  description:
    'Counts words, characters, lines and reading time for the current note.',
  version: '0.1.0',
  author: 'SwallowNote Team',
  publishedAt: '2026-06-10',
  // Two placements: editor toolbar (compact refresh button) + main
  // editor area (the stats panel). The host renders both.
  iconPosition: 'editorToolbar',
  contentPosition: 'editorArea',
  order: 30,
  enabled: true,
  icon: WordCounterIcon,
  // Render the toolbar trigger as a ReactNode (a button) rather
  // than a bare icon; the host's PluginIcon wrapper accepts both
  // `ComponentType<{ size? }>` and raw ReactNode.
  panel: WordCounterPanel,
  settings: WordCounterSettings,
  pluginPath: '',
  hasBackend: false,
  // Only `events` and `storage` — we don't touch the context-menu
  // or the backend, so we don't need to declare those permissions.
  // The host's permission guard verifies this set on every API call.
  permissions: ['events', 'storage'],
  source: '',
  hooks: {
    onMount,
    onUnmount,
  },
}

export default manifest

// Re-export internals so the host's dev bootstrap can mount the
// same module reference for hot-reload testing.
export {
  WordCounterPanel,
  WordCounterToolbarButton,
  WordCounterSettings,
  countWords,
  countCharacters,
  countLines,
  readingMinutes,
}
