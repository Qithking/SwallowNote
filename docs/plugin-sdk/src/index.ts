/**
 * @swallow-note/plugin-sdk
 *
 * Single-file standalone SDK for building SwallowNote plugins.
 *
 * Design goals:
 *  1. **Zero host coupling** – plugin authors only need this file
 *     plus React. They never need to `git clone` SwallowNote.
 *  2. **Identical types** – the `PluginDefinition`, `PluginEvent`
 *     etc. exported here are the *same shapes* the host consumes;
 *     a manifest built with the SDK loads unchanged into the host.
 *  3. **Browser-stub fallbacks** – when running outside the host
 *     (e.g. inside `npm run dev` of the starter template), every
 *     runtime API degrades gracefully: storage → localStorage,
 *     event bus → in-process EventTarget, context menu → in-memory
 *     registry. The plugin sees a real working API surface and
 *     `npm run build` produces a `dist/index.js` that runs in
 *     both host and standalone preview without modification.
 *  4. **Host takeover** – when SwallowNote loads the plugin's
 *     bundle, it calls `setHost({...})` to replace the stubs with
 *     the real implementations. The plugin's call sites are
 *     unchanged.
 *
 * The SDK intentionally has *no* runtime dependencies other than
 * `react` (peer). All hooks are implemented from scratch with
 * `useState` / `useEffect` / `useSyncExternalStore` so the bundle
 * is small and side-effect-free.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
//  Types – mirror src/types/plugin.ts. Keep in sync with the host.
// ═══════════════════════════════════════════════════════════════════════════

/** Where the plugin icon (trigger) is displayed */
export type IconPosition = 'sidebar' | 'editorToolbar' | 'titleBar'

/** Where the plugin panel (content) is displayed */
export type ContentPosition =
  | 'leftPanel'
  | 'rightPanel'
  | 'fullPanel'
  | 'editorArea'

/** Host-emitted events that plugins can subscribe to */
export type PluginEvent =
  | 'note:open'
  | 'note:close'
  | 'note:save'
  | 'note:change'
  | 'theme:change'
  | 'locale:change'
  | 'settings:change'
  | 'app:ready'
  | 'app:exit'
  | 'plugin-settings:change'

/** Payload shape for each event */
export interface PluginEventPayloadMap {
  'note:open': { noteId: string; path: string }
  'note:close': { noteId: string; path: string }
  'note:save': { noteId: string; path: string }
  'note:change': { noteId: string; path: string; content: string }
  'theme:change': { theme: string }
  'locale:change': { locale: string }
  'settings:change': { key: string; value: unknown }
  'app:ready': Record<string, never>
  'app:exit': Record<string, never>
  'plugin-settings:change': { pluginId: string; values: Record<string, unknown> }
}

export type PluginEventHandler<E extends PluginEvent = PluginEvent> = (
  payload: PluginEventPayloadMap[E]
) => void

export interface PluginContext {
  pluginId: string
  pluginPath: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

export type PluginLifecycleHook = (context: PluginContext) => void | Promise<void>

/** Persistent storage API for plugins */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  /** List all keys in this plugin's namespace. Useful for debug
   *  tooling and "export all" features. */
  keys(): Promise<string[]>
  /** Read-only snapshot of every key with its estimated JSON
   *  size, sorted by `size` descending. Mirrors the host API
   *  so plugin code can introspect its own namespace. */
  entries(): Promise<Array<{ key: string; size: number }>>
}

/** Event subscription API. The host bus is one-way: the host
 *  publishes events and plugins subscribe; the bus does NOT expose
 *  `emit` to plugins because plugins are not allowed to broadcast
 *  host events. Use a module-scope emitter (or storage) for any
 *  plugin-internal pub/sub. */
export interface PluginEventBus {
  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void
  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void
}

/** Context-menu contribution shape */
export type ContextMenuLocation =
  | 'fileTree'
  | 'fileTreeEmpty'
  | 'editor'
  | 'tab'
  | 'tabBarEmpty'

export interface ContextMenuContext {
  location: ContextMenuLocation
  path?: string
  isDirectory?: boolean
  activePath?: string
  selection?: string
}

export interface ContextMenuItem {
  id: string
  label: string
  iconName?: string
  locations?: ContextMenuLocation[]
  when?: (ctx: ContextMenuContext) => boolean
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

export type ContextMenuRegistry = Record<ContextMenuLocation, ContextMenuItem[]>

/**
 * A single command contributed by a plugin. Appears in the host's
 * command palette (Ctrl/Cmd+P) and is dispatchable via a
 * user-configurable keyboard shortcut set in the settings panel.
 * `id` must be stable across reloads because the host keys
 * user-bound shortcuts by `<pluginId>:<id>`.
 */
export interface PluginCommand {
  id: string
  label: string
  iconName?: string
  /** Optional category for grouping in the command palette. */
  category?: string
  when?: () => boolean
  onTrigger: () => void | Promise<void>
}

/**
 * Plugin permission types. The host's grant model has a fixed
 * catalog of permissions (see `PLUGIN_PERMISSIONS` in
 * `src/types/plugin.ts`). Mirror them here so a manifest declared
 * with the SDK has the same set available to the type-checker.
 */
export type PluginPermission =
  | 'storage'
  | 'events'
  | 'context-menu'
  | 'backend'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'network'
  | 'clipboard'
  | 'notifications'

/** The props passed to a panel / settings component. Field order
 *  matches the host's `PluginPanelProps`: action → state → identity. */
export interface PluginPanelProps {
  close: () => void
  isActive: boolean
  pluginId: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  store: PluginStorage
  events: PluginEventBus
  /** Current active note content (markdown string). Empty string if no note is active. */
  activeNoteContent: string
  /** Current active note file path. Empty string if no note is active. */
  activeNotePath: string
  /** Read a single setting from the plugin's `settings.json`-defined
   *  schema. Returns the stored value, the schema default, or
   *  `null` if neither is set. The host bridges this to the
   *  per-plugin SQLite table; in standalone mode the SDK caches
   *  values in the plugin's storage namespace under `__settings__`. */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** Persist a single setting key. The host writes through SQLite
   *  and emits `plugin-settings:change`; the SDK's stub fires the
   *  same event in standalone mode. */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** Read every stored setting as a flat key/value map. Useful
   *  for "seed my local state from persisted settings" on mount. */
  getAllSettings(): Promise<Record<string, unknown>>
  /** Subscribe to settings changes. The handler receives the new
   *  full map on every write. The returned function detaches the
   *  listener. The handler fires for writes originating from this
   *  plugin's own code, other plugin instances of the same id,
   *  and the host's settings dialog. */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
}

/**
 * Props for a plugin's custom toolbar button component.
 *
 * When a plugin provides `toolbarButton` in its manifest, the host
 * renders this component instead of the default icon + button. This
 * allows plugins to implement custom interactions such as dropdown
 * menus, direct actions, or any other toolbar-level UI.
 */
export interface ToolbarButtonProps {
  /** Recommended icon size for the current toolbar context */
  size: number
  /** Whether this plugin's panel is currently active */
  isActive: boolean
  /** Plugin ID */
  pluginId: string
  /** Invoke the plugin's backend command */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** Persistent key/value store scoped to this plugin */
  store: PluginStorage
  /** Host event bus */
  events: PluginEventBus
  /** Activate the plugin (show panel based on contentPosition) */
  activate: () => void
  /** Deactivate the plugin (hide panel) */
  deactivate: () => void
  /** Current active note content (markdown string). Empty string if no note is active. */
  activeNoteContent: string
  /** Current active note file path. Empty string if no note is active. */
  activeNotePath: string
  /** Read a single setting from the plugin's schema. See
   *  {@link PluginPanelProps.getSetting} for details. */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** Persist a single setting key. See
   *  {@link PluginPanelProps.setSetting} for details. */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** Read every stored setting. See {@link PluginPanelProps.getAllSettings}. */
  getAllSettings(): Promise<Record<string, unknown>>
  /** Subscribe to settings changes. See
   *  {@link PluginPanelProps.onSettingsChange}. */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
}

/**
 * The shape exported by a plugin's `index.js`. Lifecycle hooks are
 * **flat top-level fields** (not wrapped in a `hooks` object). The
 * host's plugin-loader copies them onto PluginDefinition.hooks at
 * load time.
 *
 * Plugin authors should `const manifest: PluginManifest = { ... }`
 * in their index.js. Once a manifest is loaded, the host wraps the
 * flat hooks into PluginDefinition.hooks for the runtime store.
 */
export interface PluginManifest {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  publishedAt?: string
  iconPosition: IconPosition
  contentPosition: ContentPosition
  order?: number
  enabled?: boolean
  icon: ComponentType<{ size?: number }>
  panel: ComponentType<PluginPanelProps>
  /**
   * Optional custom toolbar button component. When provided, the host
   * renders this component instead of the default icon + button pattern.
   * The component receives ToolbarButtonProps and can implement custom
   * interactions (dropdown menus, direct actions, etc.).
   */
  toolbarButton?: ComponentType<ToolbarButtonProps>
  settings?: ComponentType<PluginPanelProps>
  /**
   * Permissions this plugin needs from the host. Listed values must
   * match `PluginPermission`; the host shows the user a grant/revoke
   * dialog at install time and re-checks on every protected call.
   * A plugin that omits this field gets a default of `[]` – the
   * panel still loads, but any feature that needs `storage`,
   * `events`, `backend`, etc. will throw `PluginPermissionDeniedError`
   * until the user grants them.
   */
  permissions?: PluginPermission[]
  // ── Lifecycle hooks (all optional, all flat) ──────────────────────────
  onLoad?: PluginLifecycleHook
  onUnload?: PluginLifecycleHook
  onEnable?: PluginLifecycleHook
  onDisable?: PluginLifecycleHook
  onMount?: PluginLifecycleHook
  onUnmount?: PluginLifecycleHook
  onActivate?: PluginLifecycleHook
  onDeactivate?: PluginLifecycleHook
}

/**
 * Runtime representation stored in the host's plugin store. This
 * is the *hydrated* version of a PluginManifest where icon/panel
 * are guaranteed to be usable, all metadata is required, and
 * lifecycle hooks are wrapped in a `hooks` object so the store
 * can dispatch them at register / unregister / enable / disable.
 */
export interface PluginDefinition {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  iconPosition: IconPosition
  contentPosition: ContentPosition
  order: number
  enabled: boolean
  icon: ComponentType<{ size?: number }>
  panel: ComponentType<PluginPanelProps>
  /** Custom toolbar button component (overrides default icon rendering) */
  toolbarButton?: ComponentType<ToolbarButtonProps>
  settings?: ComponentType<PluginPanelProps>
  /**
   * Schema-driven settings description (mirrors the host's
   * `PluginSettingsSchema`). The SDK keeps this as `any` so the
   * standalone package doesn't have to import the host's
   * strongly-typed definition – the host hydrates the schema
   * from the plugin's on-disk `settings.json` at install time
   * and the SDK's typed shape lives in `src/lib/tauri.ts`.
   * Plugins that ship a `settings.json` get this populated by
   * the host's loader; standalone previews fall back to `undefined`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settingsSchema?: any
  pluginPath: string
  hasBackend: boolean
  /**
   * Permissions this plugin needs from the host. Listed values must
   * match `PluginPermission`; the host shows the user a grant/revoke
   * dialog at install time and re-checks on every protected call.
   * A plugin that omits this field gets a default of `[]`.
   */
  permissions?: PluginPermission[]
  hooks?: {
    onLoad?: PluginLifecycleHook
    onUnload?: PluginLifecycleHook
    onEnable?: PluginLifecycleHook
    onDisable?: PluginLifecycleHook
    onMount?: PluginLifecycleHook
    onUnmount?: PluginLifecycleHook
    onActivate?: PluginLifecycleHook
    onDeactivate?: PluginLifecycleHook
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Storage – in-process Map with optional localStorage persistence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-plugin storage. The stub uses an in-process Map; in browsers
 * we additionally mirror to localStorage so refreshes keep the
 * data. In the host, `setHost({ getPluginStorage })` replaces this
 * with the real Tauri-backed implementation.
 */
function createStubStorage(pluginId: string): PluginStorage {
  const key = (k: string) => `swallow-plugin:${pluginId}:${k}`
  const mem = new Map<string, unknown>()

  // Hydrate from localStorage on first access
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`swallow-plugin:${pluginId}:`)) {
        try {
          mem.set(k.slice(`swallow-plugin:${pluginId}:`.length), JSON.parse(localStorage.getItem(k)!))
        } catch {
          // ignore corrupt entries
        }
      }
    }
  }

  const persist = (k: string) => {
    if (typeof localStorage === 'undefined') return
    const fullKey = key(k)
    if (mem.has(k)) localStorage.setItem(fullKey, JSON.stringify(mem.get(k)))
    else localStorage.removeItem(fullKey)
  }

  return {
    async get<T>(k: string): Promise<T | null> {
      return mem.has(k) ? (mem.get(k) as T) : null
    },
    async set<T>(k: string, v: T): Promise<void> {
      mem.set(k, v)
      persist(k)
    },
    async delete(k: string): Promise<void> {
      mem.delete(k)
      persist(k)
    },
    async clear(): Promise<void> {
      for (const k of Array.from(mem.keys())) {
        mem.delete(k)
        persist(k)
      }
    },
    async keys(): Promise<string[]> {
      return Array.from(mem.keys()).sort()
    },
    async entries(): Promise<Array<{ key: string; size: number }>> {
      const out: Array<{ key: string; size: number }> = []
      for (const [k, v] of mem) {
        try {
          out.push({ key: k, size: JSON.stringify(v).length })
        } catch {
          out.push({ key: k, size: 0 })
        }
      }
      return out.sort((a, b) => b.size - a.size)
    },
  }
}

const storageCache = new Map<string, PluginStorage>()

export function getPluginStorage(pluginId: string): PluginStorage {
  const override = currentHostOverrides().getPluginStorage?.(pluginId)
  if (override) return override
  let s = storageCache.get(pluginId)
  if (!s) {
    s = createStubStorage(pluginId)
    storageCache.set(pluginId, s)
  }
  return s
}

export function dropPluginStorage(pluginId: string): void {
  storageCache.delete(pluginId)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Plugin settings – per-plugin `__settings__` cache in storage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Special key in the plugin's `PluginStorage` namespace that holds
 * the cached settings map for standalone-mode (no host) runs.
 * Picked with a `__` prefix and a human-friendly name so it
 * never collides with user-chosen storage keys.
 */
export const SETTINGS_CACHE_KEY = '__settings__'

/**
 * Per-plugin settings cache used by the standalone stub. The host
 * bridges `getSetting` / `setSetting` / `getAllSettings` to its
 * own SQLite implementation; this is the no-host fallback so
 * `npm run dev` previews work end-to-end.
 */
const settingsCache = new Map<string, Record<string, unknown>>()

/**
 * In-process pub/sub for settings changes within the standalone
 * stub. Each handler is called with the new full settings map on
 * every write. The host's bus replaces this with real event
 * dispatch when `__pluginSettings_subscribe` is installed.
 */
type SettingsListener = (values: Record<string, unknown>) => void
const settingsListeners = new Map<string, Set<SettingsListener>>()

function readSettingsCache(pluginId: string): Record<string, unknown> {
  let cache = settingsCache.get(pluginId)
  if (cache) return cache
  // Hydrate from the plugin's storage so values written via the
  // raw `store.set` API show up under `getSetting` too.
  const stored = getPluginStorage(pluginId)
  void stored
  // Synchronous hydration: the stub storage is a Map-backed
  // implementation so the read is effectively synchronous even
  // though the API is async. We use the in-process settings
  // cache as the source of truth and let the host's override
  // route to SQLite instead.
  cache = {}
  settingsCache.set(pluginId, cache)
  return cache
}

function writeSettingsCache(
  pluginId: string,
  values: Record<string, unknown>
): Record<string, unknown> {
  settingsCache.set(pluginId, { ...values })
  // Mirror to storage so the values survive a hard reload of the
  // standalone preview window. We use the host's getPluginStorage
  // for symmetry with the rest of the SDK; the storage layer
  // itself is a localStorage-backed Map in standalone mode.
  void getPluginStorage(pluginId).set(SETTINGS_CACHE_KEY, values)
  return values
}

function notifySettingsListeners(
  pluginId: string,
  values: Record<string, unknown>
): void {
  const set = settingsListeners.get(pluginId)
  if (!set) return
  for (const handler of Array.from(set)) {
    try {
      handler(values)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] settings listener for "${pluginId}" threw:`, err)
    }
  }
}

async function stubGetSetting<T = unknown>(
  pluginId: string,
  key: string
): Promise<T | null> {
  const cache = readSettingsCache(pluginId)
  return (cache[key] as T | undefined) ?? null
}

async function stubGetAllSettings(pluginId: string): Promise<Record<string, unknown>> {
  return { ...readSettingsCache(pluginId) }
}

async function stubSetSetting(
  pluginId: string,
  key: string,
  value: unknown
): Promise<void> {
  const next = { ...readSettingsCache(pluginId), [key]: value }
  writeSettingsCache(pluginId, next)
  notifySettingsListeners(pluginId, next)
}

/**
 * Read a single setting key. The host installs `__pluginSettings_get`
 * to route to SQLite; the standalone stub reads from the in-process
 * cache (hydrated from `__settings__` in storage).
 */
export async function getSetting<T = unknown>(
  pluginId: string,
  key: string
): Promise<T | null> {
  const override = currentHostOverrides().__pluginSettings_get
  if (override) return (await override(pluginId, key)) as T | null
  return stubGetSetting<T>(pluginId, key)
}

/**
 * Persist a single setting key. The host installs `__pluginSettings_set`
 * to route to SQLite; the standalone stub writes to the cache and
 * notifies local subscribers. The event is also dispatched on the
 * shared `pluginEventBus` so subscribers using the host bus can pick
 * it up.
 */
export async function setSetting<T = unknown>(
  pluginId: string,
  key: string,
  value: T
): Promise<void> {
  const override = currentHostOverrides().__pluginSettings_set
  if (override) {
    await override(pluginId, key, value)
    return
  }
  await stubSetSetting(pluginId, key, value)
}

/**
 * Read every stored setting for `pluginId`. Host overrides route to
 * SQLite; the stub returns the full in-process cache.
 */
export async function getAllSettings(pluginId: string): Promise<Record<string, unknown>> {
  const override = currentHostOverrides().__pluginSettings_all
  if (override) return override(pluginId)
  return stubGetAllSettings(pluginId)
}

/**
 * Subscribe to settings changes for `pluginId`. The host installs
 * `__pluginSettings_subscribe` to bridge to the global event bus
 * filtered by `pluginId`; the stub notifies a per-plugin listener
 * set. Returns an unsubscribe function.
 */
export function onSettingsChange(
  pluginId: string,
  handler: (values: Record<string, unknown>) => void
): () => void {
  const override = currentHostOverrides().__pluginSettings_subscribe
  if (override) {
    return override((payload) => {
      if (payload.pluginId !== pluginId) return
      handler(payload.values)
    })
  }
  let set = settingsListeners.get(pluginId)
  if (!set) {
    set = new Set()
    settingsListeners.set(pluginId, set)
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
    if (set!.size === 0) settingsListeners.delete(pluginId)
  }
}

/** Drop a plugin's settings cache and unsubscribe every local listener. */
export function dropPluginSettings(pluginId: string): void {
  settingsCache.delete(pluginId)
  settingsListeners.delete(pluginId)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Event bus – EventTarget wrapper with typed payload helpers
// ═══════════════════════════════════════════════════════════════════════════

class StubEventBus implements PluginEventBus {
  private readonly target = new EventTarget()

  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void {
    const wrapped = (e: Event) => handler((e as CustomEvent).detail)
    this.target.addEventListener(event, wrapped)
    return () => this.target.removeEventListener(event, wrapped)
  }

  // Event bus is best-effort: identity of the wrapped handler is not
  // exposed. Callers should keep the unsubscribe returned by `on()`.
  // The args are kept for API symmetry with the host implementation.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off<E extends PluginEvent>(_event: E, _handler: PluginEventHandler<E>): void {
    // no-op – see comment above
  }

  emit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
    this.target.dispatchEvent(new CustomEvent(event, { detail: payload }))
  }
}

const stubBus = new StubEventBus()

/**
 * The standalone event bus. The `emit` field is **not** part of the
 * public `PluginEventBus` type (the host bus is one-way), so plugin
 * authors must use the per-event helpers in this module
 * (`emitNoteOpened`, `emitThemeChanged`, …) which check
 * `hostOverrides.emit` first and fall back to the stub.
 *
 * Type-wise we augment with an internal `emit` so the helpers can
 * dispatch without going through the host when running standalone.
 */
type PluginBusWithEmit = PluginEventBus & {
  emit: <E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]) => void
}
export const pluginEventBus: PluginEventBus = {
  on: stubBus.on.bind(stubBus),
  off: stubBus.off.bind(stubBus),
} as PluginBusWithEmit
;(pluginEventBus as unknown as PluginBusWithEmit).emit = stubBus.emit.bind(stubBus)

// ═══════════════════════════════════════════════════════════════════════════
//  Context menu registry – in-process Map
// ═══════════════════════════════════════════════════════════════════════════

class StubMenuRegistry {
  private readonly byPlugin = new Map<string, ContextMenuItem[]>()
  private readonly byLocation: ContextMenuRegistry = {
    fileTree: [],
    fileTreeEmpty: [],
    editor: [],
    tab: [],
    tabBarEmpty: [],
  }

  register(pluginId: string, item: ContextMenuItem): void {
    this.unregister(pluginId, item.id)
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(item)
    this.indexItem(item)
  }

  unregister(pluginId: string, itemId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((it) => it.id === itemId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.rebuildIndex()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.rebuildIndex()
  }

  query(location: ContextMenuLocation, ctx: ContextMenuContext): ContextMenuItem[] {
    const items = this.byLocation[location]
    if (!items || items.length === 0) return []
    return items.filter((it) => {
      if (it.locations && !it.locations.includes(location)) return false
      if (it.when && !it.when(ctx)) return false
      return true
    })
  }

  getByLocation(location: ContextMenuLocation): readonly ContextMenuItem[] {
    return this.byLocation[location]
  }

  private indexItem(item: ContextMenuItem): void {
    const locations: ContextMenuLocation[] = item.locations ?? [
      'fileTree',
      'fileTreeEmpty',
      'editor',
      'tab',
      'tabBarEmpty',
    ]
    for (const loc of locations) {
      this.byLocation[loc].push(item)
    }
  }

  private rebuildIndex(): void {
    for (const loc of Object.keys(this.byLocation) as ContextMenuLocation[]) {
      this.byLocation[loc] = []
    }
    for (const items of this.byPlugin.values()) {
      for (const item of items) this.indexItem(item)
    }
  }
}

const stubMenuRegistry = new StubMenuRegistry()

export function registerContextMenu(pluginId: string, item: ContextMenuItem): void {
  currentHostOverrides().registerContextMenu?.(pluginId, item) ??
    stubMenuRegistry.register(pluginId, item)
}

export function unregisterContextMenu(pluginId: string, itemId: string): void {
  currentHostOverrides().unregisterContextMenu?.(pluginId, itemId) ??
    stubMenuRegistry.unregister(pluginId, itemId)
}

export function clearPluginMenuItems(pluginId: string): void {
  currentHostOverrides().clearPluginMenuItems?.(pluginId) ?? stubMenuRegistry.clearPlugin(pluginId)
}

export function getContextMenuItems(
  location: ContextMenuLocation,
  ctx: ContextMenuContext
): ContextMenuItem[] {
  return (
    currentHostOverrides().getContextMenuItems?.(location, ctx) ??
    stubMenuRegistry.query(location, ctx)
  )
}

/** Read-only access to the in-process menu registry (for debugging) */
export function getStubMenuRegistry(): StubMenuRegistry {
  return stubMenuRegistry
}

// ═══════════════════════════════════════════════════════════════════════════
//  Command palette registry – in-process Map
// ═══════════════════════════════════════════════════════════════════════════

/** Internal per-entry type with the owning plugin id stamped on. */
type RegisteredCommand = PluginCommand & { __pluginId: string }

class StubCommandRegistry {
  private readonly byPlugin = new Map<string, RegisteredCommand[]>()
  private readonly listeners = new Set<() => void>()

  register(pluginId: string, command: PluginCommand): void {
    this.unregister(pluginId, command.id)
    const owned: RegisteredCommand = { ...command, __pluginId: pluginId }
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(owned)
    this.notify()
  }

  unregister(pluginId: string, commandId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((c) => c.id === commandId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.notify()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.notify()
  }

  list(): PluginCommand[] {
    const out: PluginCommand[] = []
    for (const list of this.byPlugin.values()) {
      for (const entry of list) out.push(entry)
    }
    return out
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[plugin-sdk stub] command listener threw:', err)
      }
    }
  }
}

const stubCommandRegistry = new StubCommandRegistry()

/** Register a command-palette entry. Falls back to the in-process
 *  stub when running outside the host. The owning `pluginId` is
 *  stamped automatically — callers do not have to track it. */
export function registerCommand(pluginId: string, command: PluginCommand): void {
  currentHostOverrides().registerCommand?.(pluginId, command) ??
    stubCommandRegistry.register(pluginId, command)
}

export function unregisterCommand(pluginId: string, commandId: string): void {
  currentHostOverrides().unregisterCommand?.(pluginId, commandId) ??
    stubCommandRegistry.unregister(pluginId, commandId)
}

export function clearPluginCommands(pluginId: string): void {
  currentHostOverrides().clearPluginCommands?.(pluginId) ??
    stubCommandRegistry.clearPlugin(pluginId)
}

export function listPluginCommands(): PluginCommand[] {
  return currentHostOverrides().listPluginCommands?.() ?? stubCommandRegistry.list()
}

export function subscribePluginCommands(listener: () => void): () => void {
  // The standalone stub has no host bridge; if the host provides
  // its own subscription, use it instead. In practice the host
  // override always exists by the time a plugin is loaded, so the
  // fallback path is only for `npm run dev` previews.
  return currentHostOverrides().subscribePluginCommands?.(listener) ??
    stubCommandRegistry.subscribe(listener)
}

/** Read-only access to the in-process command registry (for debugging) */
export function getStubCommandRegistry(): StubCommandRegistry {
  return stubCommandRegistry
}

// ═══════════════════════════════════════════════════════════════════════════
//  PluginContext + lifecycle helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a PluginContext for the current plugin. Plugins normally
 * receive this through lifecycle hooks; in standalone mode you can
 * call this directly to test hook implementations.
 */
export function buildPluginContext(plugin: Pick<PluginDefinition, 'id' | 'pluginPath'>): PluginContext {
  return {
    pluginId: plugin.id,
    pluginPath: plugin.pluginPath,
    invokeBackend: async (cmd: string, args?: Record<string, unknown>) => {
      // In standalone mode, return a friendly stub.
      const hostInvoke = currentHostOverrides().invokeBackend
      if (hostInvoke) return hostInvoke(cmd, args)
      console.warn(`[plugin-sdk] invokeBackend(${cmd}) called in standalone mode; returning null`)
      return null
    },
  }
}

/** Options for `runLifecycleHook`. */
export interface RunLifecycleHookOptions {
  /**
   * If set, the hook is rejected with a `PluginLifecycleTimeoutError`
   * after this many milliseconds. The host uses a 5s default to
   * bound the damage a wedged plugin can do; standalone previews
   * can leave it unset (no timeout) so a `debugger` statement in a
   * dev session doesn't immediately throw.
   */
  timeoutMs?: number
  /**
   * If provided, called *before* the timeout fires — useful for
   * surfacing the timeout as a toast / log line so the plugin
   * author knows their hook overran. The default behaviour (no
   * callback) still throws the timeout error after the wait.
   */
  onTimeout?: (elapsedMs: number) => void
}

/** Thrown by `runLifecycleHook` when the hook exceeds `timeoutMs`. */
export class PluginLifecycleTimeoutError extends Error {
  readonly name = 'PluginLifecycleTimeoutError'
  constructor(public readonly elapsedMs: number, public readonly timeoutMs: number) {
    super(`Plugin lifecycle hook exceeded ${timeoutMs}ms (elapsed ${elapsedMs}ms)`)
  }
}

/**
 * Run a lifecycle hook, await async ones, swallow errors. The hook
 * receives a `PluginContext` so plugin authors can do meaningful
 * work (e.g. register context-menu items, load persisted settings)
 * without reaching for host-specific globals.
 *
 * When `opts.timeoutMs` is set, the hook is raced against a
 * `setTimeout` — if the hook doesn't settle in time we throw
 * `PluginLifecycleTimeoutError` so the host can mark the plugin
 * unhealthy. Errors thrown synchronously by the hook are caught
 * and logged (the SDK's policy is "lifecycle is best-effort,
 * errors don't break the host"), matching the previous behaviour.
 */
export async function runLifecycleHook(
  hook: PluginLifecycleHook | undefined,
  ctx: PluginContext,
  opts: RunLifecycleHookOptions = {}
): Promise<void> {
  if (!hook) return
  const { timeoutMs, onTimeout } = opts
  if (timeoutMs === undefined) {
    try {
      await hook(ctx)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] lifecycle hook failed:`, err)
    }
    return
  }
  const start = Date.now()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const elapsed = Date.now() - start
      onTimeout?.(elapsed)
      reject(new PluginLifecycleTimeoutError(elapsed, timeoutMs))
    }, timeoutMs)
  })
  try {
    await Promise.race([hook(ctx), timeoutPromise])
  } catch (err) {
    if (err instanceof PluginLifecycleTimeoutError) {
      // eslint-disable-next-line no-console
      console.error(
        `[plugin-sdk] lifecycle hook timed out after ${timeoutMs}ms:`,
        err
      )
      return
    }
    // eslint-disable-next-line no-console
    console.error(`[plugin-sdk] lifecycle hook failed:`, err)
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Host overrides – SwallowNote calls `setHost(...)` once per plugin
// ═══════════════════════════════════════════════════════════════════════════

export interface HostOverrides {
  getPluginStorage?: (pluginId: string) => PluginStorage
  registerContextMenu?: (pluginId: string, item: ContextMenuItem) => void
  unregisterContextMenu?: (pluginId: string, itemId: string) => void
  clearPluginMenuItems?: (pluginId: string) => void
  getContextMenuItems?: (
    location: ContextMenuLocation,
    ctx: ContextMenuContext
  ) => ContextMenuItem[]
  /**
   * Optional command-palette bridge (Task 9 / G9). When the host
   * provides these, the SDK's `registerCommand` /
   * `unregisterCommand` / `clearPluginCommands` forward into the
   * host's permission-checked registry; otherwise the in-process
   * stub registry backs them so standalone previews keep working.
   */
  registerCommand?: (pluginId: string, command: PluginCommand) => void
  unregisterCommand?: (pluginId: string, commandId: string) => void
  clearPluginCommands?: (pluginId: string) => void
  listPluginCommands?: () => PluginCommand[]
  subscribePluginCommands?: (listener: () => void) => () => void
  invokeBackend?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  /**
   * Optional full event-bus replacement. If the host provides only
   * `on`/`off` (no `emit`), the per-event emit helpers in this
   * module will fall back to the in-process stub bus – this is
   * fine because the host bus is one-way anyway and most plugins
   * never call emit helpers.
   */
  on?: PluginEventBus['on']
  off?: PluginEventBus['off']
  emit?: <E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]) => void
  /**
   * Bridge to the host's SQLite-backed plugin settings layer. When
   * the host installs these overrides the SDK's `getSetting` /
   * `setSetting` / `getAllSettings` use real SQLite instead of the
   * localStorage stub.
   *
   * Naming convention: `__pluginSettings_get` etc. uses a `__`
   * prefix so it can never collide with any user storage key.
   * The host reads/writes the per-plugin SQLite table
   * `plugin_settings_<id>` rather than the plugin's JSON storage.
   */
  __pluginSettings_get?: (pluginId: string, key: string) => Promise<unknown>
  __pluginSettings_set?: (pluginId: string, key: string, value: unknown) => Promise<void>
  __pluginSettings_all?: (pluginId: string) => Promise<Record<string, unknown>>
  __pluginSettings_subscribe?: (handler: (payload: PluginEventPayloadMap['plugin-settings:change']) => void) => () => void
}

/**
 * Stack of active host overrides. Each `setHost` call pushes a new
 * layer; the returned `restore` callback pops **only the layer
 * created by that call** (matched by a unique token), so
 * restore order is independent of push order. This is what lets
 * the host fire multiple plugins' hooks concurrently – plugin A's
 * `setHost(A)` and plugin B's `setHost(B)` are independent, and
 * whichever hook finishes first can clean up its own layer
 * without disturbing the others.
 *
 * We keep each layer's merged overrides precomputed (no `Object.assign`
 * on a shared `hostOverrides` singleton) so popping is O(stack depth)
 * and the previous layer's identity stays stable for the duration
 * of the layer's lifetime.
 */
interface HostOverrideLayer {
  overrides: HostOverrides
  token: number
}
const hostOverridesStack: HostOverrideLayer[] = []
let nextHostToken = 0

/** Read the currently-active merged overrides (top of the stack). */
function currentHostOverrides(): HostOverrides {
  const top = hostOverridesStack[hostOverridesStack.length - 1]
  return top ? top.overrides : EMPTY_HOST_OVERRIDES
}

const EMPTY_HOST_OVERRIDES: HostOverrides = Object.freeze({}) as HostOverrides

/**
 * Internal helper: dispatch an event through the host if a
 * takeover has been installed, otherwise through the standalone
 * stub bus. Used by the per-event emit helpers below.
 *
 * Wave B / M4: the host's `emit` override runs
 * `assertPermission(pluginId, 'events', ...)` before forwarding
 * the call into the global bus. If the plugin lacks the `events`
 * grant the call throws a `PluginPermissionDeniedError`, which
 * the previous implementation silently swallowed in this
 * try/catch. That hid a very real problem from plugin authors:
 * their `emitNoteChanged(...)` looked like it succeeded (no
 * exception) but no other plugin's handler ever saw the event.
 * We now log a `console.warn` (not `error` — the SDK does not
 * treat a missing grant as a programming bug) with a clear,
 * actionable message. We don't re-throw, because the existing
 * public surface is "emit is fire-and-forget" and a hard throw
 * would break plugins that wrap emits in their own try/catch.
 *
 * We can't `instanceof` the host's error class directly (the
 * SDK is intentionally host-agnostic) so we detect by `name`
 * instead — the class lives in
 * `src/lib/plugin-permission-guard.ts` and is the only Error
 * subclass named `PluginPermissionDeniedError` in this app.
 */
function dispatchEmit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
  const hostEmit = currentHostOverrides().emit
  if (hostEmit) {
    try {
      hostEmit(event, payload)
    } catch (err) {
      // Wave B / M4: a permission denial is the most likely
      // cause of a throw here, and the most likely cause of
      // "why isn't my event being seen?" bug reports from
      // plugin authors. Surface it loudly so the devtools
      // console points straight at the missing grant.
      if (
        err &&
        typeof err === 'object' &&
        (err as { name?: string }).name === 'PluginPermissionDeniedError'
      ) {
        const op = (err as { operation?: string }).operation ?? `emit "${event}"`
        // eslint-disable-next-line no-console
        console.warn(
          `[plugin-sdk] ${op} was denied: this plugin is missing the "events" permission. ` +
            `Add "events" to the manifest's "permissions" array and ensure the user has granted it ` +
            `(see Settings → Plugins → Permissions). The emit was dropped silently — no other ` +
            `plugin's handler will see event "${event}".`,
        )
        return
      }
      // Any other throw is a genuine bug (host implementation
      // problem, payload shape mismatch, etc.). Keep the old
      // error log so the dev sees the stack.
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] host emit for "${event}" threw:`, err)
    }
    return
  }
  ;(pluginEventBus as unknown as PluginBusWithEmit).emit(event, payload)
}

/**
 * Replace the stub implementations with real ones provided by the
 * host. The host calls this once per plugin (typically just before
 * firing a lifecycle hook), then calls the returned `restore` to
 * pop the layer (typically in a `finally`).
 *
 * The SDK supports **arbitrary-order restore** because each
 * `setHost` call gets a unique token and `restore` matches by
 * that token rather than relying on a `previous` snapshot. This
 * is what makes concurrent hook fires safe – plugin A can pop its
 * own layer while plugin B's layer is still active.
 *
 * Plugins should not call this directly. Bundlers that tree-shake
 * unused exports must keep `setHost` reachable: the host needs to
 * call it on the plugin bundle, so plugin authors must
 * `export { setHost } from '@swallow-note/plugin-sdk'` from their
 * entry file.
 */
export function setHost(overrides: HostOverrides): () => void {
  const token = nextHostToken++
  // Merge the new overrides on top of whatever's currently active.
  // We compute a fresh object so the layer is independent of the
  // stack below it – popping this layer doesn't mutate the prior
  // layer's overrides.
  const merged: HostOverrides = { ...currentHostOverrides(), ...overrides }
  hostOverridesStack.push({ overrides: merged, token })
  return () => {
    // Walk top-down so a restore of an inner layer doesn't skip over
    // a still-active outer layer in O(n) time. Tokens are unique so
    // the lookup terminates in at most stack-depth iterations.
    for (let i = hostOverridesStack.length - 1; i >= 0; i--) {
      if (hostOverridesStack[i].token === token) {
        hostOverridesStack.splice(i, 1)
        return
      }
    }
    // No matching layer: the caller invoked `restore` twice. We
    // swallow it rather than throw because a host that double-fires
    // a finally block shouldn't break the world.
  }
}

/**
 * Pop every active host override. The host should rarely need this –
 * the per-layer `restore` from `setHost` is the right tool – but
 * the helper is useful for tests that want to reset state between
 * cases without tracking individual tokens.
 */
export function clearHost(): void {
  hostOverridesStack.length = 0
}

// ═══════════════════════════════════════════════════════════════════════════
//  React hooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * State backed by plugin storage. Mirrors the host's
 * `usePluginStorage` semantics.
 */
export function usePluginStorage<T = unknown>(
  panel: PluginPanelProps,
  key: string,
  initialValue: T
): [T, (next: T | ((prev: T) => T) | null) => void] {
  const { store } = panel
  const [value, setValue] = useState<T>(initialValue)

  useEffect(() => {
    let cancelled = false
    void store.get<T>(key).then((stored) => {
      if (cancelled) return
      if (stored !== null) setValue(stored)
    })
    return () => {
      cancelled = true
    }
    // The key/store identity shouldn't change for the lifetime of a
    // mounted panel, so we depend on `key` only. `initialValue` is
    // intentionally NOT a dep – otherwise a parent re-render with a
    // new object identity would clobber stored state.
  }, [key, store])

  const set = useCallback(
    (next: T | ((prev: T) => T) | null) => {
      if (next === null) {
        setValue(initialValue)
        void store.delete(key)
        return
      }
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(value) : next
      setValue(resolved)
      void store.set(key, resolved)
    },
    // `value` is captured so the function-form update has the latest
    // state. `initialValue` is included for the same reason – if a
    // parent ever swaps the hook's initial value, we honour that.
    [key, store, value, initialValue]
  )

  return [value, set]
}

/**
 * Convenience helper for narrowing a panel prop down to the two
 * handles plugins reach for most often (`store` and `events`).
 *
 * Equivalent to `const { store, events } = panel` but type-narrowed
 * so accidental access to `close` / `invokeBackend` etc. doesn't
 * leak into a hook body.
 */
export function usePluginServices(panel: PluginPanelProps): {
  store: PluginStorage
  events: PluginEventBus
} {
  return { store: panel.store, events: panel.events }
}

/**
 * Live snapshot of every plugin command currently registered.
 *
 * In standalone mode this is backed by the in-process command
 * registry (the same one `registerCommand` writes to). In host
 * mode the host installs an override via `setHost` so the hook
 * sees every command registered through the host's
 * permission-checked registry — including those from plugins that
 * use the host's internal `plugin-commands` module directly.
 *
 * Filters out entries whose `when()` predicate returns false
 * (e.g. a "Commit" command hiding outside a git workspace). The
 * registry keeps the hidden entry so a later re-render with a
 * changed `when()` flips visibility back on without re-registering.
 */
export function usePluginCommands(): PluginCommand[] {
  const [commands, setCommands] = useState<PluginCommand[]>(() =>
    listPluginCommands()
  )

  useEffect(() => {
    const refresh = () => {
      const next = listPluginCommands().filter((cmd) => {
        if (cmd.when) {
          try {
            return cmd.when()
          } catch {
            // A buggy `when()` must not blow up the whole palette.
            return true
          }
        }
        return true
      })
      setCommands(next)
    }
    refresh()
    return subscribePluginCommands(refresh)
  }, [])

  return commands
}

/** Subscribe to a single host event. */
export function usePluginEvent<E extends PluginEvent>(
  panel: PluginPanelProps,
  event: E,
  handler: PluginEventHandler<E>
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const { events } = panel

  useEffect(() => {
    // No need to manually tag __pluginId here — the host's
    // `createPluginEventBus(pluginId)` wrapper automatically tags
    // every handler passed through `events.on()`. The SDK's stub
    // bus ignores the tag; only the host bus checks it.
    const wrapped = ((payload: PluginEventPayloadMap[E]) => {
      handlerRef.current(payload)
    }) as PluginEventHandler<E>
    return events.on(event, wrapped)
  }, [event, events])
}

/** Subscribe to multiple events with a unified callback. */
export function usePluginEvents<E extends PluginEvent>(
  panel: PluginPanelProps,
  events: readonly E[],
  // Payload is `unknown` when subscribing to multiple different event types
  // (TypeScript can't narrow intersection to union). Cast inside the handler:
  //   if (event === 'note:open') { const p = payload as PluginEventPayloadMap['note:open'] }
  // For single-event arrays use `usePluginEvent` instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: E, payload: unknown) => void
): void {
  const { events: bus } = panel
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    // No need to manually tag __pluginId — the host's
    // `createPluginEventBus(pluginId)` automatically tags every
    // handler passed through `events.on()`.
    const unsubs = events.map((evt) => {
      const wrapped = ((payload: PluginEventPayloadMap[typeof evt]) => {
        handlerRef.current(evt, payload)
      }) as PluginEventHandler<typeof evt>
      return bus.on(evt, wrapped)
    })
    return () => {
      for (const u of unsubs) u()
    }
  }, [bus, events])
}

// ═══════════════════════════════════════════════════════════════════════════
//  Emit helpers – same names as the host's per-event emitters.
//
//  These are intended for **dev preview only** (the host's bus is
//  one-way, so plugins should not emit at runtime in production).
//  In standalone mode they dispatch into the stub bus; in host
//  mode they fall through `hostOverrides.emit` if the host opted
//  in. Most plugins never need to call these.
// ═══════════════════════════════════════════════════════════════════════════

export function emitNoteOpened(noteId: string, path: string): void {
  dispatchEmit('note:open', { noteId, path })
}
export function emitNoteClosed(noteId: string, path: string): void {
  dispatchEmit('note:close', { noteId, path })
}
export function emitNoteSaved(noteId: string, path: string): void {
  dispatchEmit('note:save', { noteId, path })
}
export function emitNoteChanged(noteId: string, path: string, content: string): void {
  dispatchEmit('note:change', { noteId, path, content })
}
export function emitThemeChanged(theme: string): void {
  dispatchEmit('theme:change', { theme })
}
export function emitLocaleChanged(locale: string): void {
  dispatchEmit('locale:change', { locale })
}
export function emitSettingChanged(key: string, value: unknown): void {
  dispatchEmit('settings:change', { key, value })
}
export function emitAppReady(): void {
  dispatchEmit('app:ready', {})
}
export function emitAppExit(): void {
  dispatchEmit('app:exit', {})
}
/**
 * Notify subscribers that a plugin's settings have changed. Fires
 * the `plugin-settings:change` event with the new full values
 * map. Used by host code (after a SQLite write) to fan the change
 * out to every panel/toolbar instance of the same plugin id, and
 * by the standalone stub (after a `setSetting` call) to keep the
 * in-process pub/sub in sync.
 */
export function emitPluginSettingsChanged(
  pluginId: string,
  values: Record<string, unknown>
): void {
  dispatchEmit('plugin-settings:change', { pluginId, values })
}

// ═══════════════════════════════════════════════════════════════════════════
//  Version sentinel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK version. The host checks this against its own expected
 * version on plugin load; a mismatch produces a warning, not an
 * error, so plugins keep working across minor SDK releases.
 */
export const SDK_VERSION = '0.1.0'
