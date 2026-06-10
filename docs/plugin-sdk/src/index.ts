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

/** The props passed to a panel / settings component. Field order
 *  matches the host's `PluginPanelProps`: action → state → identity. */
export interface PluginPanelProps {
  close: () => void
  isActive: boolean
  pluginId: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  store: PluginStorage
  events: PluginEventBus
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
  settings?: ComponentType<PluginPanelProps>
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
  settings?: ComponentType<PluginPanelProps>
  pluginPath: string
  hasBackend: boolean
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
  }
}

const storageCache = new Map<string, PluginStorage>()

export function getPluginStorage(pluginId: string): PluginStorage {
  const override = hostOverrides.getPluginStorage?.(pluginId)
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
  hostOverrides.registerContextMenu?.(pluginId, item) ??
    stubMenuRegistry.register(pluginId, item)
}

export function unregisterContextMenu(pluginId: string, itemId: string): void {
  hostOverrides.unregisterContextMenu?.(pluginId, itemId) ??
    stubMenuRegistry.unregister(pluginId, itemId)
}

export function clearPluginMenuItems(pluginId: string): void {
  hostOverrides.clearPluginMenuItems?.(pluginId) ?? stubMenuRegistry.clearPlugin(pluginId)
}

export function getContextMenuItems(
  location: ContextMenuLocation,
  ctx: ContextMenuContext
): ContextMenuItem[] {
  return (
    hostOverrides.getContextMenuItems?.(location, ctx) ??
    stubMenuRegistry.query(location, ctx)
  )
}

/** Read-only access to the in-process registry (for debugging) */
export function getStubMenuRegistry(): StubMenuRegistry {
  return stubMenuRegistry
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
      if (hostOverrides.invokeBackend) return hostOverrides.invokeBackend(cmd, args)
      console.warn(`[plugin-sdk] invokeBackend(${cmd}) called in standalone mode; returning null`)
      return null
    },
  }
}

/** Run a lifecycle hook, await async ones, swallow errors. */
export async function runLifecycleHook(
  hook: PluginLifecycleHook | undefined,
  ctx: PluginContext
): Promise<void> {
  if (!hook) return
  try {
    await hook(ctx)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[plugin-sdk] lifecycle hook failed:`, err)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Host overrides – SwallowNote calls `setHost(...)` once at startup
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
}

const hostOverrides: HostOverrides = {}

/**
 * Internal helper: dispatch an event through the host if a
 * takeover has been installed, otherwise through the standalone
 * stub bus. Used by the per-event emit helpers below.
 */
function dispatchEmit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
  const hostEmit = hostOverrides.emit
  if (hostEmit) {
    try {
      hostEmit(event, payload)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] host emit for "${event}" threw:`, err)
    }
    return
  }
  ;(pluginEventBus as unknown as PluginBusWithEmit).emit(event, payload)
}

/**
 * Replace the stub implementations with real ones provided by the
 * host. The host calls this once during plugin load, then restores
 * the previous overrides on unload (so test environments can
 * nest). Plugins never call this directly.
 *
 * Note: we deliberately do **not** mutate `pluginEventBus` in place
 * – the public type `PluginEventBus` no longer exposes `emit` and
 * we don't want a hot-reloaded host to leave a stale binding on
 * the export. Emit goes through `hostOverrides.emit`; subscriptions
 * on `pluginEventBus` resolve via the dynamic lookup in
 * `dispatchEmit` and the `usePluginEvent` hook (which always reads
 * `panel.events`).
 */
export function setHost(overrides: HostOverrides): () => void {
  const previous: HostOverrides = { ...hostOverrides }
  Object.assign(hostOverrides, overrides)
  return () => setHost(previous)
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
    return events.on(event, ((payload) => handlerRef.current(payload)) as PluginEventHandler<E>)
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
    const unsubs = events.map((evt) =>
      bus.on(evt, ((payload) => handlerRef.current(evt, payload)) as PluginEventHandler<typeof evt>)
    )
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

// ═══════════════════════════════════════════════════════════════════════════
//  Version sentinel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK version. The host checks this against its own expected
 * version on plugin load; a mismatch produces a warning, not an
 * error, so plugins keep working across minor SDK releases.
 */
export const SDK_VERSION = '0.1.0'
