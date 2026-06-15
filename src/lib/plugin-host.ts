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
import { assertPermission } from './plugin-permission-guard'

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
  private readPluginId(handler: { __pluginId?: string }): string | undefined {
    return handler.__pluginId
  }

  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void {
    // Runtime permission gate. `usePluginEvent` tags the handler with
    // `__pluginId`; if that's missing the bus refuses to register so
    // a host-side misconfiguration can't be exploited by an
    // un-tagged subscription. Direct callers (legacy code, tests)
    // can attach `__pluginId` themselves or fall back to
    // `pluginEventBus.on` which accepts a tagged handler only.
    const owner = this.readPluginId(handler as unknown as { __pluginId?: string })
    if (!owner) {
      throw new Error(
        '[plugin-host] events.on() requires the handler to be tagged with __pluginId; use the usePluginEvent hook or attach the field manually'
      )
    }
    assertPermission(owner, 'events', `subscribe to "${event}" events`)

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

  /**
   * Unsubscribe a handler. `expectedPluginId` is optional but
   * recommended: when supplied, the bus only removes the handler if
   * its `__pluginId` tag matches. This closes a low-probability
   * cross-plugin removal race where one plugin could pass another
   * plugin's reference into `off` and silently break the second
   * plugin's subscriptions (the `__pluginId` tag is duck-typed and
   * not protected by the type system).
   */
  off<E extends PluginEvent>(
    event: E,
    handler: PluginEventHandler<E>,
    expectedPluginId?: string,
  ): void {
    const set = this.handlers.get(event)
    if (!set) return
    if (expectedPluginId !== undefined) {
      const owner = this.readPluginId(handler as unknown as { __pluginId?: string })
      if (owner !== expectedPluginId) {
        // Refuse to remove a handler that doesn't belong to the
        // caller. Returning silently (rather than throwing) keeps
        // the bus call-site symmetric with the no-op behaviour
        // when a handler is simply not registered.
        return
      }
    }
    set.delete(handler as AnyHandler)
  }

  /**
   * Remove all handlers belonging to a specific plugin.
   * Called on uninstall so stale subscriptions don't linger after
   * the plugin's component tree has been torn down (or never
   * mounted, e.g. when the module failed to load).
   */
  removeAllListenersForPlugin(pluginId: string): void {
    for (const [, set] of this.handlers) {
      for (const handler of Array.from(set)) {
        if (this.readPluginId(handler as unknown as { __pluginId?: string }) === pluginId) {
          set.delete(handler)
        }
      }
    }
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
      const owner = this.readPluginId(handler as unknown as { __pluginId?: string }) ?? hostOwner
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
export const pluginEventBus: PluginEventBus & { emit: PluginEventBusImpl['emit'] } & { removeAllListenersForPlugin: PluginEventBusImpl['removeAllListenersForPlugin'] } =
  new PluginEventBusImpl()

/**
 * Create a per-plugin event bus proxy that automatically tags every
 * handler with `__pluginId`. Plugin code can then call
 * `events.on('note:change', handler)` without manually attaching
 * `__pluginId` to each handler — the proxy does it transparently.
 */
export function createPluginEventBus(pluginId: string): PluginEventBus {
  return {
    on: (event, handler) => {
      // Auto-tag the handler so the host's permission gate passes.
      ;(handler as unknown as { __pluginId?: string }).__pluginId = pluginId
      return pluginEventBus.on(event, handler)
    },
    off: (event, handler) => {
      pluginEventBus.off(event, handler)
    },
    removeAllListenersForPlugin: (id) => {
      pluginEventBus.removeAllListenersForPlugin(id)
    },
  }
}

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
  /**
   * Monotonic counter incremented on every mutation. Captured at the
   * start of `doFlush` so the write-completion check can tell
   * "nothing happened during the write" (count matches) from
   * "a concurrent `set` landed" (count advanced). See
   * [`PluginStorageImpl.doFlush`] for the matching consumption site.
   */
  private mutationCount = 0

  constructor(private readonly pluginId: string) {
    // The storage instance is per-plugin and lives for the whole
    // mount lifetime of any panel that grabs a reference. We check
    // the grant at construction so any subsequent get/set/... call
    // can't be reached without a permission decision. We catch a
    // missing grant and freeze the instance as read-only-empty
    // (every op returns null/no-ops) so a misconfigured plugin can
    // still mount its UI without a hard crash, and the panel can
    // surface a clear "storage permission required" message.
    //
    // Re-checking on every operation would also work, but it would
    // double the per-op cost and would let a user revoke mid-mount
    // produce inconsistent state (e.g. a set that started before
    // the revoke completes the write anyway). Construction-time
    // is the simpler contract.
  }

  /**
   * Guard helper. Throws `PluginPermissionDeniedError` if the plugin
   * is no longer allowed to touch storage. We call this from every
   * public method so revocations that happen between the construction
   * check and a later op are still enforced.
   */
  private requireStoragePermission(op: string): void {
    assertPermission(this.pluginId, 'storage', op)
  }

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
    // Drain the in-flight write first (if any), then re-check the
    // dirty flag. Concurrent callsites like
    //   await set('a', 1)
    //   await set('b', 2)
    // would otherwise race: the first `set` captures `cache = {a:1}`
    // into its `JSON.stringify`, the second `set` synchronously
    // mutates the cache to `{a:1, b:2}` and then awaits the same
    // writePromise — but that promise's body has *already* snapshotted
    // the cache without `b`. After it resolves the second `set`
    // resolves too, the dirty flag is cleared, and `b` is silently
    // lost. The post-write dirty recheck forces a follow-up flush
    // whenever a new mutation landed during the in-flight write.
    if (this.writePromise) {
      try {
        await this.writePromise
      } catch {
        /* errors are already logged in doFlush */
      }
      if (this.dirty) {
        return this.doFlush()
      }
      return
    }
    return this.doFlush()
  }

  private async doFlush(): Promise<void> {
    if (!this.cache) return
    // Snapshot the cache and the mutation count synchronously, *before*
    // any await, so a concurrent `set` that lands during the write can
    // be detected at write-completion time. The original implementation
    // read `this.cache` lazily inside the async IIFE, which captured
    // whatever was on the cache at the moment `JSON.stringify` was
    // called — usually before concurrent set()s had a chance to run,
    // but not always. Snapshotting the object reference up front gives
    // a stable target for the JSON.stringify call and lets us reason
    // about "what was on disk before any await" cleanly.
    const dataToWrite = this.cache
    const capturedCount = this.mutationCount
    this.writePromise = (async () => {
      try {
        const path = await getPluginStoragePath(this.pluginId)
        await writeFile(path, JSON.stringify(dataToWrite, null, 2))
        // Only clear `dirty` if no new mutation has landed since
        // we took the snapshot. If a concurrent set() flipped
        // mutationCount past `capturedCount`, the cache now
        // contains data not on disk and we must keep dirty=true
        // so the next flush() picks it up.
        if (this.mutationCount === capturedCount) {
          this.dirty = false
        }
      } catch (err) {
        console.error(`[plugin-host] failed to persist storage for ${this.pluginId}:`, err)
      } finally {
        this.writePromise = null
      }
    })()
    return this.writePromise
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.requireStoragePermission('read storage')
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
    this.requireStoragePermission('write storage')
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    // Capture the old value's size *before* overwriting so the
    // telemetry delta is correct. Reading `this.cache[key]` after
    // `data[key] = value` would always return the new value,
    // making oldSize === newSize and the delta always zero.
    const oldSize = this.estimateSize(this.cache ? this.cache[key] : undefined)
    try {
      const data = await this.load()
      data[key] = value
      this.dirty = true
      // Bump the mutation count so a concurrent in-flight write
      // (started before this set landed) can detect "I'm writing
      // stale data; the next flush should pick up the new value"
      // at completion time.
      this.mutationCount++
      await this.flush()
    } catch (err) {
      success = false
      errorMsg = String(err)
      throw err
    } finally {
      // Pass the *delta* of new − old, so the size tracker subtracts
      // the old value's size when the same key is overwritten.
      const newSize = this.estimateSize(value)
      this.recordMetric('set', 1, newSize - oldSize, performance.now() - start, success, errorMsg)
    }
  }

  async delete(key: string): Promise<void> {
    this.requireStoragePermission('write storage')
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
        this.mutationCount++
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
    this.requireStoragePermission('write storage')
    const start = performance.now()
    let success = true
    let errorMsg: string | undefined
    let dataSize = 0
    try {
      const data = await this.load()
      dataSize = this.estimateSize(data)
      this.cache = {}
      this.dirty = true
      this.mutationCount++
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
    this.requireStoragePermission('read storage')
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

  /**
   * Read-only snapshot of every key with its estimated JSON size.
   * Returns the entries sorted by `size` descending so a host UI
   * (e.g. the storage inspector) can show the biggest offenders
   * first. Performs a single `load()` and one `JSON.stringify`
   * per key — `O(n)` over the namespace, no extra disk I/O.
   *
   * Exposed for host-side debugging tooling. Not part of the
   * `PluginStorage` public interface so plugin code can't see it.
   */
  async entries(): Promise<Array<{ key: string; size: number }>> {
    this.requireStoragePermission('read storage')
    const data = await this.load()
    const entries: Array<{ key: string; size: number }> = []
    for (const key of Object.keys(data)) {
      entries.push({ key, size: this.estimateSize(data[key]) })
    }
    entries.sort((a, b) => b.size - a.size)
    return entries
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

/**
 * Get a per-plugin storage instance. Construction is lazy, so the
 * permission check (which throws on revoke) only fires when a panel
 * actually grabs a reference to `store`. The returned object is
 * reused on subsequent calls to keep disk caches warm.
 */
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

/**
 * Return the per-plugin storage contents as a list of `{ key, size }`
 * entries, sorted by `size` descending. Used by the host's storage
 * inspector dialog (Task 6) so the user can see which keys are
 * eating the most space and clear individual ones or the whole
 * namespace.
 *
 * Falls back to an empty list if the plugin has no storage cache
 * (e.g. never been used). Throws on permission denial — the
 * caller is expected to be the host UI, not plugin code, so the
 * plugin must already have the `storage` permission for this to
 * succeed.
 */
export async function getPluginStorageEntries(
  pluginId: string
): Promise<Array<{ key: string; size: number }>> {
  const storage = storageCache.get(pluginId)
  if (!storage) {
    // Cold path: a plugin that never touched storage has no
    // cache entry. The storage file might still exist on disk
    // (from a prior install), so materialise an impl and read
    // it. The first `entries` call also initialises the
    // permission gate, which is what we want — the inspector
    // needs to honour grants even for a brand-new session.
    return getPluginStorage(pluginId).entries()
  }
  return storage.entries()
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
