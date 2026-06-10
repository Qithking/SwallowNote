/**
 * Storage Counter — demonstrates usePluginStorage
 *
 * Concepts shown:
 *  - usePluginStorage<State> with a complex JSON value
 *  - Functional setter: setValue(prev => ...)
 *  - "null" setter deletes the key
 *  - Mixing stored + derived UI state
 */
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
import { usePluginStorage } from '@swallow-note/plugin-sdk'

// ─── Icon ─────────────────────────────────────────────────────────────────────

function CounterIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="10" y2="10" />
      <line x1="14" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="10" y2="14" />
      <line x1="14" y1="14" x2="16" y2="14" />
      <line x1="8" y1="18" x2="10" y2="18" />
      <line x1="14" y1="18" x2="16" y2="18" />
    </svg>
  )
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface CounterState {
  value: number
  history: number[]   // most recent 10
  firstInstalledAt: string
}

const initial: CounterState = {
  value: 0,
  history: [],
  firstInstalledAt: new Date().toISOString(),
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function CounterPanel(panel: PluginPanelProps) {
  // Single key 'counter' holds the whole state as one JSON object.
  // Splitting into multiple keys (e.g. value + history) would also
  // work; using one key keeps writes atomic.
  const [state, setState] = usePluginStorage<CounterState>(panel, 'counter', initial)

  const increment = () => {
    setState((prev) => ({
      ...prev,
      value: prev.value + 1,
      history: [...prev.history, prev.value + 1].slice(-10),
    }))
  }

  const decrement = () => {
    setState((prev) => ({
      ...prev,
      value: prev.value - 1,
      history: [...prev.history, prev.value - 1].slice(-10),
    }))
  }

  const reset = () => {
    // setState(null) deletes the 'counter' key, falling back to initial.
    setState(null)
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Storage Counter</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          First installed: {new Date(state.firstInstalledAt).toLocaleString()}
        </p>
      </header>

      <div style={{ fontSize: 32, fontWeight: 700, textAlign: 'center' }}>
        {state.value}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={decrement} style={buttonStyle}>−1</button>
        <button onClick={increment} style={buttonStyle}>+1</button>
        <button onClick={reset} style={{ ...buttonStyle, color: 'var(--danger-color, #f44336)' }}>
          Reset
        </button>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
          Last 10 values
        </div>
        <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {state.history.length === 0 ? '(empty)' : state.history.join(' → ')}
        </div>
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: 'com.example.storage-counter',
  name: 'Storage Counter',
  description: 'Counter with persistent history stored in the plugin JSON file.',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'rightPanel',
  order: 90,
  enabled: true,
  icon: CounterIcon,
  panel: CounterPanel,

  // Storage is the only host capability this sample needs; the
  // `storage` permission is what the user will be asked to grant at
  // install time.
  permissions: ['storage'],
}

export default manifest
