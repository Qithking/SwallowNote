/**
 * Event Listener — demonstrates usePluginEvent / usePluginEvents
 *
 * Concepts shown:
 *  - usePluginEvents: subscribe to multiple events at once
 *  - Display payloads in a live log
 *  - Per-event color coding
 *  - Cap the log at 50 entries to avoid unbounded growth
 */
import { useState } from 'react'
import type {
  PluginManifest,
  PluginEvent,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import { usePluginEvents } from '@swallow-note/plugin-sdk'
// Re-export `setHost` so the host can install its real
// implementations on this bundle before firing lifecycle hooks.
// See `hello-world` for the rationale.
export { setHost } from '@swallow-note/plugin-sdk'

// ─── Icon ─────────────────────────────────────────────────────────────────────

function EventIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}

// ─── Event metadata ───────────────────────────────────────────────────────────

const EVENT_COLORS: Record<PluginEvent, string> = {
  'note:open': '#3b82f6',
  'note:close': '#ef4444',
  'note:save': '#10b981',
  'note:change': '#f59e0b',
  'theme:change': '#a855f7',
  'locale:change': '#ec4899',
  'settings:change': '#6b7280',
  'app:ready': '#22c55e',
  'app:exit': '#dc2626',
}

const ALL_EVENTS = [
  'note:open',
  'note:close',
  'note:save',
  'note:change',
  'theme:change',
  'locale:change',
  'settings:change',
  'app:ready',
  'app:exit',
] as const satisfies readonly PluginEvent[]

// ─── Panel ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number
  event: PluginEvent
  payload: unknown
  time: string
}

let nextId = 0

function EventListenerPanel(panel: PluginPanelProps) {
  const [log, setLog] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)

  usePluginEvents(panel, ALL_EVENTS, (event, payload) => {
    if (paused) return
    setLog((prev) => {
      const next: LogEntry = {
        id: ++nextId,
        event,
        payload,
        time: new Date().toLocaleTimeString(),
      }
      // Cap at 50 entries
      return [next, ...prev].slice(0, 50)
    })
  })

  const clear = () => setLog([])

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Event Stream</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setPaused((p) => !p)}
            style={buttonStyle}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button onClick={clear} style={buttonStyle} title="Clear">
            🗑
          </button>
        </div>
      </header>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {log.length === 0 ? 'No events yet. Try opening / saving a note or switching theme.' : `${log.length} event${log.length === 1 ? '' : 's'}`}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {log.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: '4px 8px',
              borderLeft: `3px solid ${EVENT_COLORS[entry.event]}`,
              background: 'var(--bg-secondary)',
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: EVENT_COLORS[entry.event], fontWeight: 600 }}>
                {entry.event}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{entry.time}</span>
            </div>
            <pre
              style={{
                margin: '4px 0 0 0',
                fontSize: 10,
                opacity: 0.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(entry.payload, null, 0)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: 'com.example.event-listener',
  name: 'Event Listener',
  description: 'Live event stream viewer – subscribes to every host event.',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'rightPanel',
  order: 80,
  enabled: true,
  icon: EventIcon,
  panel: EventListenerPanel,

  // Subscribing to host events requires the `events` permission;
  // without it `panel.events.on()` would throw on first subscribe.
  permissions: ['events'],
}

export default manifest
