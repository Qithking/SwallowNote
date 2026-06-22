/**
 * Sample Plugin: "Theme & Locale Watcher"
 *
 * Logs every host event the user can observe: theme changes, locale
 * changes, and `settings:change` for any keys the host decides to
 * publish. Demonstrates:
 *  - Subscribing to *multiple* events with `usePluginEvents` from
 *    `@/lib/plugin-hooks` (one effect block, clean teardown)
 *  - Reading the current theme / locale out of persistent storage
 *    on mount and keeping it in sync with the live event stream
 *  - `settings:change` payload inspection: the handler only acts on
 *    the `theme` key but tolerates other keys
 *  - Settings dialog exposing the plugin's own internal switches
 *    (verbose log / hide notifications)
 *  - The full 8-hook lifecycle
 *
 * The `react-refresh/only-export-components` rule is disabled for
 * this file because plugin manifests export both a component and a
 * metadata object – that's the contract, not a HMR footgun.
 */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from 'react'
import type { PluginDefinition, PluginEventPayloadMap, PluginPanelProps } from '@/types/plugin'
import { pluginEventBus, getPluginStorage } from '@/lib/plugin-host'
import {
  usePluginStorage,
  usePluginEvents,
} from '@/lib/plugin-hooks'

// ─── Panel component ──────────────────────────────────────────────────────────

// Module-scope constant for the list of events we care about. The
// `usePluginEvents` hook depends on the array's reference identity
// in its effect deps, so passing a fresh array literal on every
// render would tear down and rebuild the subscriptions on every
// parent re-render. Hoisting it here gives a stable reference.
const WATCHED_EVENTS = ['theme:change', 'locale:change', 'settings:change'] as const

interface WatcherSnapshot {
  theme: string
  locale: string
  /** Last `settings:change` key we observed (for debugging) */
  lastSettingKey: string | null
  lastSettingValue: string
  /** Number of events received since the panel mounted */
  eventCount: number
}

function ThemeWatcherPanel(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  // Two persisted toggles, one for verbose logging and one for
  // suppressing in-panel notifications. Settings dialog edits both.
  const [verbose, setVerbose] = usePluginStorage<boolean>(panel, 'verbose', false)
  const [hideNotifications, setHideNotifications] = usePluginStorage<boolean>(
    panel,
    'hideNotifications',
    false,
  )

  const [snapshot, setSnapshot] = useState<WatcherSnapshot>({
    theme: '(unknown)',
    locale: '(unknown)',
    lastSettingKey: null,
    lastSettingValue: '',
    eventCount: 0,
  })

  // Hydrate from the host's view of the world on first mount. We
  // peek into localStorage to read the host's `appSettings` key
  // (the host stores its own theme/locale there) and seed our
  // snapshot with whatever the user had last picked. The host's
  // permission guard enforces `events` on every subscription, so
  // this is the only way to read cross-plugin state without
  // declaring the `storage` permission.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('appSettings')
      if (!raw) return
      const parsed = JSON.parse(raw) as { theme?: string; locale?: string }
      setSnapshot((prev) => ({
        ...prev,
        theme: parsed.theme ?? prev.theme,
        locale: parsed.locale ?? prev.locale,
      }))
    } catch (err) {
      if (verbose) {
        console.debug('[theme-watcher] failed to hydrate from appSettings:', err)
      }
    }
  }, [verbose])

  // Subscribe to every event we care about in a single effect. The
  // hook is generic over the union of subscribed events; the
  // handler receives `(event, payload)` with full payload typing.
  //
  // NB: TypeScript's narrowing of mapped types over a union isn't
  // perfect here, so the payload is widened back to a concrete
  // shape inside each branch. The runtime shape is correct because
  // the bus only ever emits the matching event for each branch;
  // the `as` is purely a cast over the already-correct data.
  usePluginEvents(panel, WATCHED_EVENTS, (event, payload) => {
    setSnapshot((prev) => {
      const next: WatcherSnapshot = { ...prev, eventCount: prev.eventCount + 1 }
      if (event === 'theme:change') {
        const p = payload as PluginEventPayloadMap['theme:change']
        next.theme = p.theme
      } else if (event === 'locale:change') {
        const p = payload as PluginEventPayloadMap['locale:change']
        next.locale = p.locale
      } else {
        // settings:change — record key/value for debug visibility.
        // We coerce value to a string so the UI can render
        // arbitrary JSON safely.
        const p = payload as PluginEventPayloadMap['settings:change']
        next.lastSettingKey = p.key
        try {
          next.lastSettingValue = JSON.stringify(p.value)
        } catch {
          next.lastSettingValue = '[unserialisable]'
        }
      }
      return next
    })

    if (verbose) {
      console.debug(`[theme-watcher] ${event}`, payload)
    }
    // Demo: emit a follow-up `settings:change` carrying the latest
    // theme, so other plugins (or the diagnostics panel) can
    // observe the watcher reacting. Skipped when the user disabled
    // notifications in the settings dialog.
    if (!hideNotifications && event === 'theme:change') {
      const p = payload as PluginEventPayloadMap['theme:change']
      pluginEventBus.emit('settings:change', {
        key: 'theme-watcher:last-theme',
        value: p.theme,
      })
    }
  })

  return (
    <div className="p-4 text-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Theme & Locale Watcher</h2>
        <button
          type="button"
          onClick={close}
          className="text-xs px-2 py-1 rounded hover:bg-muted"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Plugin</span>
        <code className="text-[11px]">{pluginId}</code>
        <span className="text-muted-foreground">Theme</span>
        <span className="font-mono">{snapshot.theme}</span>
        <span className="text-muted-foreground">Locale</span>
        <span className="font-mono">{snapshot.locale}</span>
        <span className="text-muted-foreground">Events</span>
        <span className="font-mono">{snapshot.eventCount}</span>
        <span className="text-muted-foreground">Last setting</span>
        <span className="font-mono truncate" title={snapshot.lastSettingValue}>
          {snapshot.lastSettingKey ?? '—'}
          {snapshot.lastSettingKey ? ` = ${snapshot.lastSettingValue}` : ''}
        </span>
      </div>
      <div className="border-t pt-3 space-y-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          Verbose logging
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideNotifications}
            onChange={(e) => setHideNotifications(e.target.checked)}
          />
          Suppress follow-up settings events
        </label>
      </div>
    </div>
  )
}

// ─── Icon component ───────────────────────────────────────────────────────────

function ThemeWatcherIcon({ size = 18 }: { size?: number }): ReactNode {
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
      {/* Sun + crescent: evokes "watcher of theme" */}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

// ─── Settings dialog ──────────────────────────────────────────────────────────

function ThemeWatcherSettings(panel: PluginPanelProps): ReactNode {
  const { close, pluginId } = panel
  const [verbose, setVerbose] = usePluginStorage<boolean>(panel, 'verbose', false)
  const [hideNotifications, setHideNotifications] = usePluginStorage<boolean>(
    panel,
    'hideNotifications',
    false,
  )

  return (
    <div className="p-4 text-sm space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">Plugin ID</div>
        <code className="text-xs">{pluginId}</code>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => setVerbose(e.target.checked)}
          />
          Log every host event to the console
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideNotifications}
            onChange={(e) => setHideNotifications(e.target.checked)}
          />
          Suppress follow-up `settings:change` events
        </label>
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

function onLoad(context: { pluginId: string }): void {
  // Seed an "installed at" stamp so the user can verify the load
  // hook ran. We don't await because onLoad is allowed to return
  // synchronously; the storage layer serialises writes internally.
  const store = getPluginStorage(context.pluginId)
  void store.get<string>('installedAt').then((existing) => {
    if (existing) return
    void store.set('installedAt', new Date().toISOString())
  })
}

function onUnload(): void {
  // No teardown required: usePluginEvents handles its own cleanup.
}

function onEnable(context: { pluginId: string }): void {
  console.debug(`[theme-watcher] enabled (pluginId=${context.pluginId})`)
}

function onDisable(context: { pluginId: string }): void {
  console.debug(`[theme-watcher] disabled (pluginId=${context.pluginId})`)
}

function onMount(context: { pluginId: string }): void {
  void context
}

function onUnmount(): void {
  // Nothing to flush.
}

function onActivate(context: { pluginId: string }): void {
  console.debug(`[theme-watcher] activated (pluginId=${context.pluginId})`)
}

function onDeactivate(context: { pluginId: string }): void {
  console.debug(`[theme-watcher] deactivated (pluginId=${context.pluginId})`)
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginDefinition = {
  id: 'com.example.theme-watcher',
  name: 'Theme & Locale Watcher',
  description:
    'Inspects host theme, locale and settings events. Useful as a debugging aid and a worked example of the multi-event subscription hook.',
  version: '0.1.0',
  author: 'SwallowNote Team',
  publishedAt: '2026-06-10',
  iconPosition: 'sidebar',
  contentPosition: 'rightPanel',
  order: 80,
  enabled: true,
  icon: ThemeWatcherIcon,
  panel: ThemeWatcherPanel,
  settings: ThemeWatcherSettings,
  pluginPath: '',
  hasBackend: false,
  // We use the event bus (read-only) and plugin-scoped storage.
  // No context-menu, no backend IPC, no filesystem or network.
  permissions: ['events', 'storage'],
  source: '',
  hooks: {
    onLoad,
    onUnload,
    onEnable,
    onDisable,
    onMount,
    onUnmount,
    onActivate,
    onDeactivate,
  },
}

export default manifest

// Re-export internals for hot-reload bootstrap / tests.
export {
  ThemeWatcherPanel,
  ThemeWatcherSettings,
}
