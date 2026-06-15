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

// ═══════════════════════════════════════════════════════════════════════════
//  Version sentinel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK version. The host checks this against its own expected
 * version on plugin load; a mismatch produces a warning, not an
 * error, so plugins keep working across minor SDK releases.
 */
export const SDK_VERSION = '0.1.0'
