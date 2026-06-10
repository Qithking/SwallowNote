/**
 * Full Stack — Recent Notes tracker
 *
 * Demonstrates the integration of every host API in a single plugin:
 *  1. Persistent storage (usePluginStorage)  → recent list survives restarts
 *  2. Event subscription (usePluginEvents)    → track note open/save
 *  3. Settings dialog (manifest.settings)     → user can tune list size
 *  4. Context menu (registerContextMenu)      → "Clear history" / "Export"
 *  5. Lifecycle hooks (onLoad / onUnload)     → set up & tear down cleanly
 *
 * Key design decisions:
 *  - Lifecycle hooks are **flat top-level fields** on the manifest
 *    (not wrapped in a `hooks` object). The host's plugin-loader
 *    copies them onto the runtime PluginDefinition.hooks.
 *  - Plugin authors should NOT call `pluginEventBus.emit` to talk
 *    to themselves. The host event bus is one-way (host → plugin)
 *    and the SDK type PluginEventBus doesn't expose `emit`. Use a
 *    module-scope emitter (see `internalBus` below) for any
 *    plugin-internal pub/sub.
 *  - Storage keys are namespaced: 'config' for settings, 'history' for
 *    the list, 'installedAt' for read-only metadata.
 */
import { useEffect, useRef } from 'react'
import type {
  PluginContext,
  PluginManifest,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import {
  getPluginStorage,
  usePluginStorage,
  usePluginEvents,
  registerContextMenu,
  unregisterContextMenu,
} from '@swallow-note/plugin-sdk'
// Re-export `setHost` so the host can install its real
// implementations on this bundle before firing lifecycle hooks.
// This sample exercises every protected call (storage, events,
// context-menu), so the takeover is what actually wires the
// permission checks around them at runtime.
export { setHost } from '@swallow-note/plugin-sdk'

// ─── Domain types ─────────────────────────────────────────────────────────────

interface RecentNote {
  path: string
  lastOpenedAt: string
  saveCount: number
}

interface PluginConfig {
  maxEntries: number
  viewMode: 'list' | 'count'
}

const defaultConfig: PluginConfig = { maxEntries: 20, viewMode: 'list' }

const PLUGIN_ID = 'com.example.full-stack'

// ─── Internal bus (plugin-internal pub/sub) ────────────────────────────────────
//
// The host bus is one-way. To notify the panel from a context-menu
// onClick handler (which runs outside React), we maintain a small
// in-process bus scoped to this module. The panel subscribes in a
// useEffect; menu items publish on user action.
type InternalEvent = 'clear' | 'refresh' | 'export'
type InternalHandler = (event: InternalEvent) => void
const internalHandlers = new Set<InternalHandler>()
function emitInternal(event: InternalEvent): void {
  for (const h of internalHandlers) {
    try {
      h(event)
    } catch (err) {
      console.error('[full-stack] internal handler threw:', err)
    }
  }
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function RecentIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  )
}

// ─── Settings component ───────────────────────────────────────────────────────

function RecentSettings(panel: PluginPanelProps) {
  const [config, setConfig] = usePluginStorage<PluginConfig>(panel, 'config', defaultConfig)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>
          Max entries
          <input
            type="number"
            min={5}
            max={100}
            value={config.maxEntries}
            onChange={(e) => setConfig({ ...config, maxEntries: Math.max(5, Math.min(100, Number(e.target.value) || 20)) })}
            style={inputStyle}
          />
        </label>
      </section>

      <section>
        <span style={{ ...labelStyle, display: 'block' }}>View mode</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {(['list', 'count'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setConfig({ ...config, viewMode: mode })}
              style={{
                ...buttonStyle,
                fontWeight: config.viewMode === mode ? 700 : 400,
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
        <button onClick={panel.close} style={buttonStyle}>Close</button>
      </footer>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

function RecentPanel(panel: PluginPanelProps) {
  const [config] = usePluginStorage<PluginConfig>(panel, 'config', defaultConfig)
  const [history, setHistory] = usePluginStorage<RecentNote[]>(panel, 'history', [])
  // Bump a key to force re-read from disk after context-menu actions
  const [refreshTick, setRefreshTick] = usePluginStorage<number>(panel, 'refreshTick', 0)

  // Hold the latest `history` in a ref so the internal-bus
  // subscription (registered once) can read it without forcing the
  // effect to re-bind on every history update.
  const historyRef = useRef<RecentNote[]>(history)
  useEffect(() => { historyRef.current = history }, [history])

  // Subscribe to host events for note activity tracking.
  // payload is typed as `unknown` by the SDK (mixed-event array limitation);
  // we narrow with `as` casts inside.
  usePluginEvents(panel, ['note:open', 'note:save'] as const, (
    event: 'note:open' | 'note:save',
    payload: unknown
  ) => {
    if (event === 'note:open') {
      const p = payload as { path: string }
      const noteId = p.path
      setHistory((prev: RecentNote[]) => {
        const filtered = prev.filter((n: RecentNote) => n.path !== noteId)
        const next: RecentNote[] = [
          {
            path: noteId,
            lastOpenedAt: new Date().toISOString(),
            saveCount: prev.find((n: RecentNote) => n.path === noteId)?.saveCount ?? 0,
          },
          ...filtered,
        ].slice(0, config.maxEntries)
        return next
      })
    } else if (event === 'note:save') {
      const p = payload as { path: string }
      const noteId = p.path
      setHistory((prev: RecentNote[]) =>
        prev.map((n: RecentNote) => (n.path === noteId ? { ...n, saveCount: n.saveCount + 1 } : n))
      )
    }
  })

  // Subscribe to plugin-internal bus for context-menu actions.
  // Bind once; read latest `history` via the ref so we don't have to
  // re-add the handler on every history change.
  useEffect(() => {
    const handler: InternalHandler = (event) => {
      if (event === 'clear') setHistory([])
      else if (event === 'refresh') setRefreshTick((t: number) => t + 1)
      else if (event === 'export') {
        // Expose the current history via storage so other code
        // (or a settings dialog) can read it. A real plugin might
        // trigger a download or write a file here.
        void panel.store.set('recentNotes:exportData', historyRef.current)
      }
    }
    internalHandlers.add(handler)
    return () => {
      internalHandlers.delete(handler)
    }
  }, [panel])

  // The 'list' branch is verbose; 'count' is a one-liner.
  if (config.viewMode === 'count') {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Notes</h2>
        <div style={{ fontSize: 32, fontWeight: 700, textAlign: 'center', marginTop: 16 }}>
          {history.length}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
          unique notes tracked
        </p>
        {/* refreshTick is unused at runtime but forces a re-render after
            a context-menu action that didn't change state. */}
        <span style={{ display: 'none' }}>{refreshTick}</span>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Notes</h2>
      {history.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          No notes opened yet. Open one in the editor to start tracking.
        </p>
      ) : (
        <ol style={{ paddingLeft: 20, fontSize: 12, margin: 0 }}>
          {history.map((n: RecentNote) => (
            <li key={n.path} style={{ marginBottom: 4 }}>
              <code style={{ fontSize: 11 }}>{n.path}</code>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                opened {new Date(n.lastOpenedAt).toLocaleString()} · saved {n.saveCount}×
              </div>
            </li>
          ))}
        </ol>
      )}
      <span style={{ display: 'none' }}>{refreshTick}</span>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'var(--bg-secondary)',
  fontSize: 12,
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

// ─── Lifecycle hooks ──────────────────────────────────────────────────────────

function onLoad(ctx: PluginContext): void {
  // Seed install time once.
  const store = getPluginStorage(ctx.pluginId)
  void store.get<string>('installedAt').then((existing: string | null) => {
    if (!existing) void store.set('installedAt', new Date().toISOString())
  })

  // Right-click: "Clear history" on the file tree's empty area.
  registerContextMenu(ctx.pluginId, {
    id: 'recent-notes:clear',
    label: 'Recent Notes: clear history',
    iconName: 'Trash2',
    locations: ['fileTreeEmpty', 'tabBarEmpty'],
    onClick: () => {
      emitInternal('clear')
    },
  })

  // Right-click: "Export recent notes as JSON"
  registerContextMenu(ctx.pluginId, {
    id: 'recent-notes:export',
    label: 'Recent Notes: export history',
    iconName: 'Download',
    locations: ['fileTreeEmpty', 'tabBarEmpty'],
    onClick: () => {
      emitInternal('export')
    },
  })

  // Right-click: "Refresh from disk"
  registerContextMenu(ctx.pluginId, {
    id: 'recent-notes:refresh',
    label: 'Recent Notes: refresh',
    iconName: 'RefreshCw',
    locations: ['fileTreeEmpty', 'tabBarEmpty'],
    onClick: () => {
      emitInternal('refresh')
    },
  })
}

function onUnload(ctx: PluginContext): void {
  unregisterContextMenu(ctx.pluginId, 'recent-notes:clear')
  unregisterContextMenu(ctx.pluginId, 'recent-notes:export')
  unregisterContextMenu(ctx.pluginId, 'recent-notes:refresh')
  // host also calls clearPluginMenuItems automatically – this is
  // the explicit belt-and-suspenders cleanup.
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Recent Notes (Full Stack)',
  description:
    'A full-featured plugin using all 5 host APIs: storage, events, settings, context menu, and lifecycle hooks.',
  version: '1.0.0',
  author: 'SwallowNote',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 50,
  enabled: true,
  icon: RecentIcon,
  panel: RecentPanel,
  settings: RecentSettings,
  onLoad,
  onUnload,

  // This sample is the kitchen-sink plugin. It needs every
  // permission a plugin can ask for: storage for the recent-notes
  // list, events for live note:change, context-menu for the
  // right-click entries, and so on. In a real plugin you'd
  // minimize this set to only what the panel actually uses.
  permissions: ['storage', 'events', 'context-menu'],
}

export default manifest
