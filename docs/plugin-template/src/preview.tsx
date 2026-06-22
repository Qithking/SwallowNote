/**
 * Standalone preview frame.
 *
 * Renders the user's `manifest.panel` inside a mocked host shell,
 * with a dev-tools panel for emitting events, inspecting storage,
 * and testing context-menu contributions.
 *
 * This file is for development only. The bundled plugin never
 * imports `Preview`; the `vite build` library entry point is
 * `src/plugin/index.tsx` instead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import manifest from './plugin'
import {
  type ContextMenuItem,
  type ContextMenuLocation,
  type PluginPanelProps,
  buildPluginContext,
  clearPluginMenuItems,
  emitAppReady,
  emitLocaleChanged,
  emitNoteChanged,
  emitNoteClosed,
  emitNoteOpened,
  emitNoteSaved,
  emitSettingChanged,
  emitThemeChanged,
  getContextMenuItems,
  getPluginStorage,
  pluginEventBus,
  runLifecycleHook,
} from '@swallow-note/plugin-sdk'

// ────────────────────────────── styles ────────────────────────────────────

const shellStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 360px',
  height: '100vh',
  background: '#f5f5f7',
}
const mainStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid #d2d2d7',
  background: '#fff',
  overflow: 'hidden',
}
const headerStyle: CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid #e5e5ea',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 13,
}
const panelWrapStyle: CSSProperties = { flex: 1, overflow: 'auto' }
const sideStyle: CSSProperties = {
  padding: 16,
  fontSize: 12,
  overflow: 'auto',
}
const sectionStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #d2d2d7',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
}
const sectionTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 8,
  color: '#6e6e73',
}
const btn: CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  margin: 2,
  border: '1px solid #c7c7cc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
}
const input: CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid #c7c7cc',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: 6,
}

// ─────────────────────────── dev tools data ──────────────────────────────

const EVENT_PRESETS: { label: string; fire: () => void }[] = [
  { label: 'note:open  /notes/welcome.md', fire: () => emitNoteOpened('n1', '/notes/welcome.md') },
  { label: 'note:save /notes/welcome.md', fire: () => emitNoteSaved('n1', '/notes/welcome.md') },
  { label: 'note:close /notes/welcome.md', fire: () => emitNoteClosed('n1', '/notes/welcome.md') },
  { label: 'theme:change → dark', fire: () => emitThemeChanged('dark') },
  { label: 'theme:change → light', fire: () => emitThemeChanged('light') },
  { label: 'locale:change → zh-CN', fire: () => emitLocaleChanged('zh-CN') },
  { label: 'settings:change fontSize=14', fire: () => emitSettingChanged('fontSize', 14) },
]

// ──────────────────────────── component ──────────────────────────────────

export function Preview() {
  const [active, setActive] = useState(true)
  const [storageTick, setStorageTick] = useState(0)
  const [eventLog, setEventLog] = useState<string[]>([])
  const [notePath, setNotePath] = useState('/notes/example.md')
  const [contentLen, setContentLen] = useState(0)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)

  // Lifecycle: onMount, onUnmount, onActivate, onDeactivate
  // Hooks are flat top-level fields on PluginManifest (not under
  // a `hooks` object). The standalone preview synthesises a
  // PluginDefinition-shaped context (id + pluginPath) for the
  // hooks since the host fills in `pluginPath` at load time.
  const ctx = useMemo(() => buildPluginContext({ id: manifest.id, pluginPath: '' }), [])
  useEffect(() => {
    void runLifecycleHook(manifest.onLoad, ctx)
    void runLifecycleHook(manifest.onMount, ctx)
    return () => {
      void runLifecycleHook(manifest.onUnmount, ctx)
      void runLifecycleHook(manifest.onUnload, ctx)
      clearPluginMenuItems(manifest.id)
    }
  }, [ctx])

  useEffect(() => {
    void runLifecycleHook(active ? manifest.onActivate : manifest.onDeactivate, ctx)
  }, [active, ctx])

  // App ready – one-shot
  useEffect(() => {
    emitAppReady()
  }, [])

  // Capture event log for debugging
  useEffect(() => {
    const all = [
      'note:open', 'note:close', 'note:save', 'note:change',
      'theme:change', 'locale:change', 'settings:change', 'app:ready',
    ] as const
    const unsubs = all.map((evt) =>
      pluginEventBus.on(evt, (payload) => {
        setEventLog((prev) =>
          [`${new Date().toLocaleTimeString()}  ${evt}  ${JSON.stringify(payload)}`, ...prev].slice(0, 30)
        )
      })
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  // Build panel props
  const panelProps = useMemo<PluginPanelProps>(() => ({
    pluginId: manifest.id,
    isActive: active,
    close: () => setActive(false),
    invokeBackend: async (cmd, args) => {
      console.log('[preview] invokeBackend', cmd, args)
      return null
    },
    store: getPluginStorage(manifest.id),
    events: pluginEventBus,
  }), [active])

  const Panel = manifest.panel as ComponentType<PluginPanelProps>

  // Storage snapshot
  // Uses store.keys() so unknown / custom keys are visible without
  // hardcoding them in the preview frame.
  const [storageSnapshot, setStorageSnapshot] = useState<Record<string, unknown>>({})
  useEffect(() => {
    const store = getPluginStorage(manifest.id)
    void store.keys().then(async (keys) => {
      const rows = await Promise.all(keys.map(async (k) => [k, await store.get(k)] as const))
      const obj: Record<string, unknown> = {}
      for (const [k, v] of rows) if (v !== null && v !== undefined) obj[k] = v
      setStorageSnapshot(obj)
    })
  }, [storageTick])

  // Right-click handler on the panel area
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const location: ContextMenuLocation = 'editor'
    const items = getContextMenuItems(location, {
      location,
      activePath: notePath,
    })
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [notePath])

  return (
    <div style={shellStyle}>
      {/* Main panel area */}
      <div style={mainStyle}>
        <div style={headerStyle}>
          <strong>{manifest.name}</strong>
          <span style={{ color: '#6e6e73', fontSize: 11 }}>{manifest.id}</span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            isActive
          </label>
          <button style={btn} onClick={() => setActive(false)}>close</button>
        </div>
        <div style={panelWrapStyle} onContextMenu={handleContextMenu}>
          <Panel {...panelProps} />
        </div>
        {contextMenu && (
          <div
            style={{
              position: 'fixed', top: contextMenu.y, left: contextMenu.x,
              background: '#fff', border: '1px solid #c7c7cc', borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 4, zIndex: 1000,
              minWidth: 200, fontSize: 12,
            }}
            onClick={() => setContextMenu(null)}
          >
            {contextMenu.items.length === 0 && (
              <div style={{ padding: 8, color: '#6e6e73' }}>No menu items at this location</div>
            )}
            {contextMenu.items.map((it) => (
              <div
                key={it.id}
                style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  void it.onClick({ location: 'editor', activePath: notePath })
                  setContextMenu(null)
                }}
              >
                {it.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dev tools sidebar */}
      <div style={sideStyle}>
        <div style={sectionStyle}>
          <div style={sectionTitle}>Emit events</div>
          {EVENT_PRESETS.map((p) => (
            <button key={p.label} style={btn} onClick={p.fire}>{p.label}</button>
          ))}
          <div style={{ marginTop: 8, fontSize: 11, color: '#6e6e73' }}>
            Custom note:change
          </div>
          <input
            style={input}
            value={notePath}
            onChange={(e) => setNotePath(e.target.value)}
            placeholder="path"
          />
          <input
            style={input}
            type="number"
            value={contentLen}
            onChange={(e) => setContentLen(Number(e.target.value))}
            placeholder="content length"
          />
          <button
            style={btn}
            onClick={() => emitNoteChanged('n1', notePath, 'x'.repeat(contentLen))}
          >
            emit note:change
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitle}>Storage ({manifest.id})</div>
          {Object.keys(storageSnapshot).length === 0 && (
            <div style={{ fontSize: 11, color: '#6e6e73' }}>(empty — known keys: count, config, history, installedAt)</div>
          )}
          {Object.entries(storageSnapshot).map(([k, v]) => (
            <div key={k} style={{ fontSize: 11, marginBottom: 4 }}>
              <strong>{k}:</strong>{' '}
              <code style={{ fontSize: 10 }}>{JSON.stringify(v).slice(0, 80)}</code>
            </div>
          ))}
          <button
            style={{ ...btn, marginTop: 6 }}
            onClick={() => {
              const store = getPluginStorage(manifest.id)
              void store.clear().then(() => setStorageTick((t) => t + 1))
            }}
          >
            Clear storage
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitle}>Event log</div>
          {eventLog.length === 0 && (
            <div style={{ fontSize: 11, color: '#6e6e73' }}>(waiting for events…)</div>
          )}
          {eventLog.map((line, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', marginBottom: 2 }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
