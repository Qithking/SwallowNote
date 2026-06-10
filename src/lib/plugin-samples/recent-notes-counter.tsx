/**
 * Sample Plugin: "Recent Notes Counter"
 *
 * This file is a complete, runnable plugin manifest. It exists as a
 * reference for plugin authors and as a smoke test for the host's
 * lifecycle / event / storage APIs.
 *
 * What it demonstrates:
 *  - Lifecycle hooks:      onLoad, onUnload, onMount, onUnmount
 *  - Event subscription:   usePluginEvent for note:change
 *  - Persistent storage:   usePluginStorage for `viewMode` preference
 *  - The 4 event sources that drive its UI
 *
 * To install: copy this file plus a `manifest.json` into a folder
 * under the plugins dir, then click "Install from folder" in the
 * plugin manager.
 *
 * The `react-refresh/only-export-components` rule is disabled for
 * this file because plugin manifests export both a component and a
 * metadata object – that's the contract, not a HMR footgun.
 */
/* eslint-disable react-refresh/only-export-components */
import { useState, type ReactNode } from 'react'
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'
import { pluginEventBus, getPluginStorage } from '@/lib/plugin-host'
import { usePluginStorage, usePluginEvent } from '@/lib/plugin-hooks'
import { registerContextMenu, unregisterContextMenu } from '@/lib/plugin-menu'

// ─── Panel component ──────────────────────────────────────────────────────────

function RecentNotesPanel(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  // Persisted UI preference: 'list' | 'count'. Survives app restart.
  const [viewMode, setViewMode] = usePluginStorage<'list' | 'count'>(panel, 'viewMode', 'count')
  // In-memory counter that ticks on every note:change event.
  const [count, setCount] = useState(0)
  const [lastNote, setLastNote] = useState<string | null>(null)

  usePluginEvent(panel, 'note:change', ({ path }) => {
    setCount((c) => c + 1)
    setLastNote(path)
  })
  usePluginEvent(panel, 'note:open', ({ path }) => {
    // Reset on a fresh open so a new session doesn't carry stale state.
    setCount(1)
    setLastNote(path)
  })

  return (
    <div className="p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Recent Notes</h2>
        <button
          type="button"
          onClick={close}
          className="text-xs px-2 py-1 rounded hover:bg-muted"
        >
          Close
        </button>
      </div>
      <div className="mb-2">
        Plugin ID: <code className="text-xs">{pluginId}</code>
      </div>
      <div className="mb-2">Notes opened/edited this session: {count}</div>
      <div className="mb-3">Last note: {lastNote ?? '(none)'}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode('list')}
          className={viewMode === 'list' ? 'font-bold' : ''}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => setViewMode('count')}
          className={viewMode === 'count' ? 'font-bold' : ''}
        >
          Count
        </button>
      </div>
    </div>
  )
}

// ─── Icon component ───────────────────────────────────────────────────────────

function RecentIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  )
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

/**
 * Settings panel rendered inside a modal launched from the plugin
 * manager. Same props as the main panel: `close` dismisses the
 * dialog, `store` / `events` give the plugin access to its own
 * persistent state and the host event bus. The dialog does NOT
 * receive `isActive === true` because modals aren't tabs.
 */
function RecentNotesSettings(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  const store = getPluginStorage(pluginId)
  const [installedAt, setInstalledAt] = useState<string | null>(null)
  const [viewMode, setViewMode] = usePluginStorage<'list' | 'count'>(panel, 'viewMode', 'count')

  useState(() => {
    void store.get<string>('installedAt').then((v) => setInstalledAt(v))
    return null
  })

  return (
    <div className="p-4 text-sm space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">Plugin ID</div>
        <code className="text-xs">{pluginId}</code>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Installed at</div>
        <div>{installedAt ?? '(unknown)'}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">Default view</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={viewMode === 'list' ? 'font-bold' : ''}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode('count')}
            className={viewMode === 'count' ? 'font-bold' : ''}
          >
            Count
          </button>
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
 * onLoad runs once when the plugin is registered. Use it for
 * one-time initialization that doesn't need a panel. The host gives
 * us a PluginContext – we use it to grab our plugin-scoped storage
 * and seed a default value.
 */
async function onLoad(context: { pluginId: string }): Promise<void> {
  const store = getPluginStorage(context.pluginId)
  const existing = await store.get<string>('installedAt')
  if (!existing) {
    await store.set('installedAt', new Date().toISOString())
  }

  // Register a context menu item on the editor surface that simply
  // emits a `note:change` event when clicked. The host resolves the
  // active tab's path into `ctx.path` and the editor selection into
  // `ctx.selection`, both available inside the predicate. The
  // registry stores the contribution under our plugin id so the
  // store's unregister hook cleans it up automatically on uninstall.
  registerContextMenu(context.pluginId, {
    id: 'recent-notes:reopen-last',
    label: 'Recent Notes: re-fire change event',
    iconName: 'RefreshCw',
    locations: ['editor', 'tab'],
    when: (ctx) => !!ctx.path,
    onClick: (ctx) => {
      if (!ctx.path) return
      pluginEventBus.emit('note:change', {
        noteId: ctx.path,
        path: ctx.path,
        content: '',
      })
    },
  })
}

/**
 * onUnload runs once when the plugin is unregistered (uninstall or
 * app shutdown). Anything that should be torn down – timers, ipc
 * sockets, etc. – goes here. The host's unregisterPlugin also
 * clears our context-menu items, but doing it explicitly here
 * makes the intent obvious to anyone reading this file.
 */
function onUnload(context: { pluginId: string }): void {
  unregisterContextMenu(context.pluginId, 'recent-notes:reopen-last')
}

/**
 * onMount fires every time the panel component mounts. We could
 * pre-fetch heavy data here, but for this example we just log.
 */
function onMount(context: { pluginId: string }): void {
  // The pluginEventBus singleton is importable from the host. If a
  // hook needs to fire a synthetic event for the panel to react to,
  // this is the entry point.
  void context
  void pluginEventBus
}

/**
 * onUnmount fires on the way out. Use it to flush async writes.
 */
function onUnmount(): void {
  // Storage is already serialized; nothing extra to do.
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginDefinition = {
  id: 'com.example.recent-notes',
  name: 'Recent Notes Counter',
  description: 'Counts how many notes you opened or edited in this session.',
  version: '0.1.0',
  author: 'SwallowNote Team',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'leftPanel',
  order: 50,
  enabled: true,
  icon: RecentIcon,
  panel: RecentNotesPanel,
  // Settings dialog component. When present, the plugin manager
  // shows a settings button that opens a modal hosting this
  // component with the same props as the main panel.
  settings: RecentNotesSettings,
  pluginPath: '', // Filled in by the loader at install time.
  hasBackend: false,
  hooks: {
    onLoad,
    onUnload,
    onMount,
    onUnmount,
  },
}

export default manifest

// Re-export the panel for the host so it can mount the same module
// reference in tests without going through the loader.
export { RecentNotesPanel }
