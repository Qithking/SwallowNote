/**
 * Plugin Host Services
 *
 * Provides the cross-cutting host services that every plugin gets access to:
 *  - PluginEventBus:  Pub/sub for host events (note open/save, theme change…)
 *  - PluginStorage:   Per-plugin JSON-backed key/value persistence
 *  - runLifecycleHook:  Best-effort invocation of a hook that swallows errors
 *
 * Storage layout on disk:
 *   <app_data_dir>/plugins/<plugin_id>/storage.json
 *
 * The bus is global (singleton) because the host itself is the single source
 * of truth for events. Plugin authors can subscribe via `events.on()` from
 * their panel or lifecycle hooks. Each plugin gets its own PluginStorage
 * instance so plugins can't read each other's data.
 */
import type {
  PluginEvent,
  PluginEventBus,
  PluginEventHandler,
  PluginEventPayloadMap,
  PluginStorage,
  PluginContext,
  PluginDefinition,
} from '@/types/plugin'
import { getPluginStoragePath, pathExists, readFile, writeFile } from './tauri'

// ─── Event bus ─────────────────────────────────────────────────────────────────

type AnyHandler = PluginEventHandler<PluginEvent>

/**
 * In-process event bus. We use a Map<event, Set<handler>> for O(1)
 * subscribe/unsubscribe and O(n) dispatch where n is the number of
 * subscribers for that event. Synchronous dispatch is intentional –
 * handlers are expected to be fast; long-running work should defer to
 * a microtask. Errors are isolated per handler so one buggy subscriber
 * can't break others.
 */
class PluginEventBusImpl implements PluginEventBus {
  private readonly handlers = new Map<PluginEvent, Set<AnyHandler>>()
  // Optional per-handler metadata stashed by callers (e.g. usePluginEvent)
  // for metrics attribution. The bus only reads this in emit(); it never
  // writes. We use a duck-typed `__pluginId` field on the handler itself
  // so the public PluginEventBus.on() signature stays unchanged.
  private readPluginId(handler: AnyHandler): string | undefined {
    return (handler as { __pluginId?: string }).__pluginId
  }

  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as AnyHandler)
    // Return an unsubscribe function. We capture the local `set` variable
    // so the closure doesn't need a fresh `.get` lookup at call time.
    return () => {
      set!.delete(handler as AnyHandler)
    }
  }

  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as AnyHandler)
  }

  /**
   * Emit an event. Public so the host can fire events from any module
   * (App.tsx, useTheme, useTranslation, …) without prop-drilling.
   */
  emit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
    const set = this.handlers.get(event)
    if (!set || set.size === 0) return
    // Record per-plugin metrics: payload size, handler duration, errors.
    // We aggregate durations/errors across the handler loop and emit one
    // record per (pluginId, event) pair at the end.
    const dispatchStart = performance.now()
    const perPlugin = new Map<string, { durationMs: number; errors: number }>()
    const hostOwner = 'host' // default attribution when handler has no plugin meta
    // Snapshot the set so handlers that subscribe/unsubscribe during
    // dispatch don't mutate the iteration target.
    for (const handler of Array.from(set)) {
      const owner = this.readPluginId(handler) ?? hostOwner
      const stats = perPlugin.get(owner) ?? { durationMs: 0, errors: 0 }
      const start = performance.now()
      try {
        ;(handler as PluginEventHandler<E>)(payload)
      } catch (err) {
        // One bad plugin must not stop the others. Log and continue.
        console.error(`[plugin-host] handler for "${event}" threw:`, err)
        stats.errors++
      }
      stats.durationMs += performance.now() - start
      perPlugin.set(owner, stats)
    }
    const totalDuration = performance.now() - dispatchStart
    // Lazy import to avoid a circular dep (telemetry imports nothing
    // from host; host imports telemetry only on emit, which is rare).
    void import('./plugin-telemetry').then(({ recordEventMetric }) => {
      const payloadSize = (() => {
        try {
          return JSON.stringify(payload).length
        } catch {
          return 0
        }
      })()
      for (const [pid, stats] of perPlugin) {
        recordEventMetric(
          pid,
          event,
          payload,
          1,
          totalDuration,
          stats.errors
        )
      }
      // Keep the local references to silence unused warnings
      void payloadSize
    })
  }
}

/** Global event bus singleton. */
export const pluginEventBus: PluginEventBus & { emit: PluginEventBusImpl['emit'] } =
  new PluginEventBusImpl()

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Per-plugin storage. Reads/writes a single JSON document on disk and
 * caches the parsed result in memory. Writes are serialized through a
 * single in-flight promise so a plugin that calls `set(a, 1); set(b, 2)`
 * triggers exactly one disk write, not two interleaved ones.
 *
 * The Rust host is the source of truth for the storage path; the
 * frontend asks via `getPluginStoragePath` so we don't need to
 * hard-code the cross-platform app-data location.
 */
class PluginStorageImpl implements PluginStorage {
  private cache: Record<string, unknown> | null = null
  private loadPromise: Promise<Record<string, unknown>> | null = null
  private writePromise: Promise<void> | null = null
  private dirty = false

  constructor(private readonly pluginId: string) {}

  private async load(): Promise<Record<string, unknown>> {
    if (this.cache) return this.cache
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      try {
        const path = await getPluginStoragePath(this.pluginId)
        if (await pathExists(path)) {
          const text = await readFile(path)
          this.cache = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
        } else {
          this.cache = {}
        }
      } catch (err) {
        // Corrupt file or no Tauri: log and start fresh. We don't want
        // a typo in storage.json to brick the whole plugin.
        console.warn(`[plugin-host] storage for ${this.pluginId} unreadable, resetting:`, err)
        this.cache = {}
      }
      return this.cache!
    })()
    return this.loadPromise
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return
    if (this.writePromise) return this.writePromise
    this.writePromise = (async () => {
      try {
        if (!this.cache) return
        const path = await getPluginStoragePath(this.pluginId)
        await writeFile(path, JSON.stringify(this.cache, null, 2))
        this.dirty = false
      } catch (err) {
        console.error(`[plugin-host] failed to persist storage for ${this.pluginId}:`, err)
      } finally {
        this.writePromise = null
      }
    })()
    return this.writePromise
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    try {
      const data = await this.load()
      return (data[key] as T | undefined) ?? null
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      this.recordMetric('get', 1, 0, performance.now() - start, success, errorMsg)
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    try {
      const data = await this.load()
      data[key] = value
      this.dirty = true
      await this.flush()
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      const dataSize = this.estimateSize(value)
      this.recordMetric('set', 1, dataSize, performance.now() - start, success, errorMsg)
    }
  }

  async delete(key: string): Promise<void> {
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    let dataSize = 0
    try {
      const data = await this.load()
      if (key in data) {
        dataSize = this.estimateSize(data[key])
        delete data[key]
        this.dirty = true
        await this.flush()
      }
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      this.recordMetric('delete', 1, dataSize, performance.now() - start, success, errorMsg)
    }
  }

  async clear(): Promise<void> {
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    let dataSize = 0
    try {
      const data = await this.load()
      dataSize = this.estimateSize(data)
      this.cache = {}
      this.dirty = true
      await this.flush()
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      this.recordMetric('clear', 0, dataSize, performance.now() - start, success, errorMsg)
    }
  }

  async keys(): Promise<string[]> {
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    try {
      const data = await this.load()
      return Object.keys(data).sort()
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      this.recordMetric('keys', 0, 0, performance.now() - start, success, errorMsg)
    }
  }

  /** Record a storage operation metric. Lazy-imports telemetry to keep
   *  the storage path independent of the metrics layer. */
  private recordMetric(
    operation: 'get' | 'set' | 'delete' | 'clear' | 'keys',
    keyCount: number,
    dataSize: number,
    durationMs: number,
    success: boolean,
    error?: string
  ): void {
    void import('./plugin-telemetry').then(({ recordStorageMetric }) => {
      recordStorageMetric(this.pluginId, operation, keyCount, dataSize, durationMs, success, error)
    })
  }

  /** Estimate JSON-encoded size of a value in bytes. */
  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length
    } catch {
      return 0
    }
  }
}

/** Storage cache so a plugin asking twice for `getStorage(id)` reuses one impl. */
const storageCache = new Map<string, PluginStorage>()

/** Get a per-plugin storage instance. */
export function getPluginStorage(pluginId: string): PluginStorage {
  let s = storageCache.get(pluginId)
  if (!s) {
    s = new PluginStorageImpl(pluginId)
    storageCache.set(pluginId, s)
  }
  return s
}

/** Drop a plugin's storage from the cache. Called on uninstall. */
export function dropPluginStorage(pluginId: string): void {
  storageCache.delete(pluginId)
}

// ─── Lifecycle hook runner ────────────────────────────────────────────────────

/**
 * Build a PluginContext for invoking a plugin's lifecycle hooks.
 * `invokeBackend` is intentionally a no-op here: lifecycle hooks
 * are JS-side only and run on the same side as the plugin module.
 * Backend IPC is for the panel itself and is exposed via
 * `PluginPanelProps.invokeBackend`.
 */
export function buildPluginContext(plugin: PluginDefinition): PluginContext {
  return {
    pluginId: plugin.id,
    pluginPath: plugin.pluginPath,
    invokeBackend: async () => {
      throw new Error(
        `Backend IPC not available to lifecycle hooks (plugin_id=${plugin.id})`
      )
    },
  }
}

/**
 * Run a plugin lifecycle hook in a try/catch so a buggy plugin never
 * crashes the host. We await async hooks but don't let rejections bubble.
 *
 * `hookName` is recorded as a stable label in the metrics table. The
 * caller is responsible for passing it because the hook function itself
 * is usually a method reference (e.g. `plugin.onLoad`) and its `.name`
 * is generic; relying on the stack trace to recover the lifecycle stage
 * is fragile across minifiers and async boundaries.
 */
export async function runLifecycleHook(
  hook: ((context: PluginContext) => void | Promise<void>) | undefined,
  context: PluginContext,
  hookName: string
): Promise<void> {
  if (!hook) return
  const start = performance.now()
  let success = true
  let errorMsg: string | undefined
  try {
    await hook(context)
  } catch (err) {
    success = false
    errorMsg = err instanceof Error ? err.message : String(err)
    console.error(
      `[plugin-host] lifecycle hook "${hookName}" failed for plugin "${context.pluginId}":`,
      err
    )
  } finally {
    const durationMs = performance.now() - start
    void import('./plugin-telemetry').then(({ recordHookMetric }) => {
      recordHookMetric(context.pluginId, hookName, durationMs, success, errorMsg)
    })
  }
}

// ─── Public emit helpers ──────────────────────────────────────────────────────

/** Convenience: emit a host event without importing the singleton. */
export function emitPluginEvent<E extends PluginEvent>(
  event: E,
  payload: PluginEventPayloadMap[E]
): void {
  pluginEventBus.emit(event, payload)
}

// Typed, per-event helpers. These exist so call sites get full payload
// inference without a generic at every emit. The payload is computed
// inside the helper to make it impossible to construct a malformed
// event by mistake (e.g. swapping noteId and path).

export function emitNoteOpened(noteId: string, path: string): void {
  pluginEventBus.emit('note:open', { noteId, path })
}

export function emitNoteClosed(noteId: string, path: string): void {
  pluginEventBus.emit('note:close', { noteId, path })
}

export function emitNoteSaved(noteId: string, path: string): void {
  pluginEventBus.emit('note:save', { noteId, path })
}

export function emitNoteChanged(noteId: string, path: string, content: string): void {
  pluginEventBus.emit('note:change', { noteId, path, content })
}

export function emitThemeChanged(theme: string): void {
  pluginEventBus.emit('theme:change', { theme })
}

export function emitLocaleChanged(locale: string): void {
  pluginEventBus.emit('locale:change', { locale })
}

export function emitSettingChanged(key: string, value: unknown): void {
  pluginEventBus.emit('settings:change', { key, value })
}

export function emitAppReady(): void {
  pluginEventBus.emit('app:ready', {})
}

export function emitAppExit(): void {
  pluginEventBus.emit('app:exit', {})
}
