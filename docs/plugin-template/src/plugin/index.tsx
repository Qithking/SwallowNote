/**
 * Your plugin manifest. Edit this file freely; the rest of the
 * template is dev infrastructure that you can leave alone.
 *
 * - `npm run dev`   – opens the standalone preview in your browser
 * - `npm run build` – emits `dist/plugin.js` (IIFE) + `dist/manifest.json`
 *                     that you can upload to SwallowNote.
 *
 * Lifecycle hooks are **flat top-level fields** on the manifest
 * (not wrapped in a `hooks` object). The host's plugin-loader
 * copies them onto PluginDefinition.hooks at load time.
 */
import {
  type PluginManifest,
  type PluginPanelProps,
  type PluginEvent,
  usePluginStorage,
  usePluginEvent,
} from '@swallow-note/plugin-sdk'

function Icon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </svg>
  )
}

interface CounterState {
  clicks: number
  lastEvent: string
  lastNotePath: string
}

const DEFAULT_STATE: CounterState = { clicks: 0, lastEvent: '—', lastNotePath: '—' }

function Panel(panel: PluginPanelProps) {
  const [state, setState] = usePluginStorage<CounterState>(panel, 'state', DEFAULT_STATE)

  // React to the host's note:open events
  usePluginEvent(panel, 'note:open', (payload) => {
    setState((prev) => ({
      ...prev,
      lastEvent: 'note:open',
      lastNotePath: payload.path,
    }))
  })

  // React to any event name passed in
  const bump = (event: PluginEvent) => {
    setState((prev) => ({ ...prev, clicks: prev.clicks + 1, lastEvent: event }))
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Hello from your plugin</h2>
      <p style={{ color: '#6e6e73' }}>Plugin ID: <code>{panel.pluginId}</code></p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
        <Stat label="Clicks" value={state.clicks} />
        <Stat label="Last event" value={state.lastEvent} />
        <Stat label="Last note" value={state.lastNotePath} />
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
        <button
          onClick={() => bump('note:open')}
          style={btnStyle}
        >
          +1 click
        </button>
        <button
          onClick={() => setState(DEFAULT_STATE)}
          style={btnStyle}
        >
          Reset
        </button>
      </div>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #e5e5ea' }} />
      <p style={{ fontSize: 12, color: '#6e6e73' }}>
        Edit <code>src/plugin/index.tsx</code> to start building.
        Open the right panel to emit host events and watch this state update.
      </p>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  border: '1px solid #c7c7cc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#f5f5f7', padding: 12, borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#6e6e73', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  )
}

const manifest: PluginManifest = {
  id: 'com.example.template',
  name: 'Plugin Template',
  description: 'A starting point for building SwallowNote plugins.',
  version: '0.1.0',
  author: 'You',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 100,
  enabled: true,
  icon: Icon,
  panel: Panel,
  // Optional lifecycle hooks – try toggling isActive in the preview header
  onLoad: () => console.log('[plugin] onLoad'),
  onUnload: () => console.log('[plugin] onUnload'),
  onMount: () => console.log('[plugin] onMount'),
  onUnmount: () => console.log('[plugin] onUnmount'),
  onActivate: () => console.log('[plugin] onActivate'),
  onDeactivate: () => console.log('[plugin] onDeactivate'),

  // Permissions your plugin needs. The host shows a grant/revoke
  // dialog at install time and re-checks on every protected
  // operation. Drop what you don't use; a user is more likely to
  // install a plugin that only asks for `storage` than one that
  // demands `network` + `filesystem-write` + `clipboard`.
  //
  // Available values (see `PLUGIN_PERMISSIONS` in the SDK):
  //   'storage' | 'events' | 'context-menu' | 'backend'
  //   'filesystem-read' | 'filesystem-write' | 'network'
  //   'clipboard' | 'notifications'
  //
  // Note: this template uses `usePluginEvent('note:open', ...)` to
  // listen for host events, so `events` is required in addition to
  // `storage`. Remove `events` if you stop calling any event hook.
  permissions: ['storage', 'events'],
}

export default manifest
