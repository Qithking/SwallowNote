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
import { buildPluginContext as sdkBuildPluginContext } from '@swallow-note/plugin-sdk'

// ─── Circuit breaker (tripped plugins) ───────────────────────────────────────
/**
 * 已熔断插件集合。生命周期钩子超时后由 plugin-host-takeover 标记，
 * 在事件总线 dispatch、storage 写入、IPC 调用入口处检查：为 true 时拒绝
 * 该插件的后续副作用，避免超时后仍在后台运行的 hookPromise 继续产生
 * 写入/事件/IPC 等副作用。熔断标志仅在用户手动重新启用插件时清除
 * （见 plugin store 的 setPluginEnabled 启用路径），不在每轮钩子调用前
 * 清除，以避免上一轮超时的 hookPromise 绕过熔断检查（P0 NEW-4）。
 */
const trippedPlugins = new Set<string>()

/** 标记插件已熔断（生命周期钩子超时）。 */
export function markPluginTripped(pluginId: string): void {
  trippedPlugins.add(pluginId)
}

/** 清除插件熔断标记（新一轮钩子调用前重置）。 */
export function clearPluginTripped(pluginId: string): void {
  trippedPlugins.delete(pluginId)
}

/** 查询插件是否已熔断。 */
export function isPluginTripped(pluginId: string): boolean {
  return trippedPlugins.has(pluginId)
}

// ─── Event bus ─────────────────────────────────────────────────────────────────

type AnyHandler = PluginEventHandler<PluginEvent>

/** 进程内事件总线，错误隔离。 */
// 注意：不写 `implements PluginEventBus`，因为 `off` 在此实现中强制要求
// `expectedPluginId`（3 参数），与接口的 2 参数签名不兼容。该接口仅作为
// 面向插件的公共契约（由 createPluginEventBus 返回的对象字面量满足）。
class PluginEventBusImpl {
  private readonly handlers = new Map<PluginEvent, Set<AnyHandler>>()
  /**
   * Monotonic counter incremented every time a plugin's handlers
   * are torn down via `removeAllListenersForPlugin`. Captured at
   * the start of `emit`; the async telemetry callback compares the
   * captured value against the *current* value for each plugin and
   * skips the record if the plugin was uninstalled between the
   * synchronous dispatch and the async import completing.
   *
   * We track per-plugin "torn down since" counts (not a single
   * global epoch) because one plugin being uninstalled must not
   * invalidate telemetry for other plugins' handlers that were
   * dispatched in the same `emit` call.
   */
  private readonly tornDownSince = new Map<string, number>()
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
   * Unsubscribe a handler. `expectedPluginId` 为必填：移除前强制校验
   * listener 注册时的 `__pluginId` 与传入值一致，不一致时拒绝并抛错。
   * 这关闭了一个跨插件取消订阅的安全漏洞——`__pluginId` 是鸭子类型、
   * 不受类型系统保护，若 `off` 不校验，一个插件可把另一插件的 handler
   * 引用传入 `off` 并静默破坏其订阅，绕过 `on()` 的权限门。
   */
  off<E extends PluginEvent>(
    event: E,
    handler: PluginEventHandler<E>,
    expectedPluginId: string,
  ): void {
    const set = this.handlers.get(event)
    if (!set) return
    // 强制归属校验：handler 注册时的 __pluginId 必须与 expectedPluginId 一致，
    // 否则拒绝移除并抛错，防止跨插件恶意/误用取消订阅绕过安全检查。
    const owner = this.readPluginId(handler as unknown as { __pluginId?: string })
    if (owner !== expectedPluginId) {
      throw new Error(
        `[plugin-host] events.off() refused: handler __pluginId "${owner ?? '<none>'}" does not match expected "${expectedPluginId}"`
      )
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
    // Bump the per-plugin "torn down since" counter so any in-flight
    // async `emit` telemetry callback can detect it was uninstalled
    // mid-dispatch and skip the record. (The handler set is the
    // authoritative state; the counter is a derived accounting
    // signal for the async path that runs after `set` is empty.)
    this.tornDownSince.set(
      pluginId,
      (this.tornDownSince.get(pluginId) ?? 0) + 1,
    )
  }

  /**
   * Snapshot the "torn down since" counter for a plugin at the
   * moment of dispatch. Telemetry callbacks compare the captured
   * value against the *current* one and skip if it advanced (i.e.
   * the plugin was uninstalled between the sync dispatch and the
   * async import completing).
   */
  private snapshotTornDown(pluginId: string): number {
    return this.tornDownSince.get(pluginId) ?? 0
  }

  private wasTornDownSince(pluginId: string, snapshot: number): boolean {
    return (this.tornDownSince.get(pluginId) ?? 0) !== snapshot
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
    const perPlugin = new Map<string, { durationMs: number; errors: number; tornDownSnap: number }>()
    const hostOwner = 'host' // default attribution when handler has no plugin meta
    // Snapshot the set so handlers that subscribe/unsubscribe during
    // dispatch don't mutate the iteration target.
    for (const handler of Array.from(set)) {
      const owner = this.readPluginId(handler as unknown as { __pluginId?: string }) ?? hostOwner
      // 熔断插件的 handler 不再派发，拒绝超时后仍在后台运行的钩子产生事件副作用。
      if (owner !== hostOwner && isPluginTripped(owner)) {
        continue
      }
      const stats = perPlugin.get(owner) ?? {
        durationMs: 0,
        errors: 0,
        tornDownSnap: this.snapshotTornDown(owner),
      }
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
        // Skip telemetry for plugins that were uninstalled between the
        // sync dispatch and this async callback landing. The handler
        // set is already empty for them but the metrics collector
        // would otherwise attribute the call to a torn-down plugin.
        if (this.wasTornDownSince(pid, stats.tornDownSnap)) {
          continue
        }
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
export const pluginEventBus: Omit<PluginEventBus, 'off'> &
  { off: PluginEventBusImpl['off'] } &
  { emit: PluginEventBusImpl['emit'] } &
  { removeAllListenersForPlugin: PluginEventBusImpl['removeAllListenersForPlugin'] } =
  new PluginEventBusImpl()

/** 创建每插件事件总线代理。 */
export function createPluginEventBus(pluginId: string): PluginEventBus {
  return {
    on: (event, handler) => {
      // Auto-tag the handler so the host's permission gate passes.
      ;(handler as unknown as { __pluginId?: string }).__pluginId = pluginId
      return pluginEventBus.on(event, handler)
    },
    off: (event, handler) => {
      // 强制传入 pluginId 作为 expectedPluginId，确保 off 经过归属校验，
      // 防止绕过 on() 的权限门而静默移除他人订阅。
      pluginEventBus.off(event, handler, pluginId)
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
   * 损坏标志：load() 解析磁盘文件失败时置为 true。flush() 检测到该标志
   * 时拒绝写入，避免用空缓存覆盖原始（可能仍可抢救的）文件，导致数据彻底丢失。
   */
  private corrupted = false
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

  /**
   * 熔断检查：已熔断插件拒绝写入，防止生命周期钩子超时后仍在后台运行的
   * hookPromise 继续持久化副作用。读操作不受限制，允许插件读取自身状态。
   */
  private requireNotTripped(): void {
    if (isPluginTripped(this.pluginId)) {
      throw new Error(
        `[plugin-host] storage write refused: plugin "${this.pluginId}" is tripped (lifecycle hook timed out)`
      )
    }
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
        // 损坏文件或无 Tauri：标记 corrupted 并以空缓存继续运行（读操作返回空）。
        // corrupted 标志会阻止后续 flush() 用空缓存覆盖原文件，给用户/诊断工具
        // 留出抢救原始数据的机会。
        this.corrupted = true
        console.warn(`[plugin-host] storage for ${this.pluginId} unreadable, marked corrupted:`, err)
        this.cache = {}
      }
      return this.cache!
    })()
    return this.loadPromise
  }

  private async flush(): Promise<void> {
    // 损坏保护：corrupted 为 true 时拒绝任何写入，避免空缓存覆盖原始文件导致数据彻底丢失。
    if (this.corrupted) {
      console.error(
        `[plugin-host] storage for ${this.pluginId} is corrupted; refusing to flush to avoid overwriting the original file.`
      )
      return
    }
    // 先排空飞行中写入，再检查 dirty。
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
    // 同步快照 cache 和 mutationCount。
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
    this.requireNotTripped()
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
    this.requireNotTripped()
    await this._doDelete(key)
  }

  /**
   * Host-only: same as `delete(key)` but skips the `storage`
   * permission check. The host UI (storage inspector) acts on
   * behalf of the user, not as the plugin — the `storage`
   * permission gates plugin code paths, not the user's own
   * introspection/cleanup. The same telemetry metric is recorded
   * either way, so a host-initiated delete still shows up in the
   * plugin's storage-ops history.
   */
  async deleteHost(key: string): Promise<void> {
    await this._doDelete(key)
  }

  private async _doDelete(key: string): Promise<void> {
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
    this.requireNotTripped()
    await this._doClear()
  }

  /**
   * Host-only: same as `clear()` but skips the `storage`
   * permission check. See `deleteHost` for the rationale.
   */
  async clearHost(): Promise<void> {
    await this._doClear()
  }

  private async _doClear(): Promise<void> {
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
    return this._doEntries()
  }

  /**
   * Host-only: same as `entries()` but skips the `storage`
   * permission check. See `deleteHost` for the rationale.
   */
  async entriesHost(): Promise<Array<{ key: string; size: number }>> {
    return this._doEntries()
  }

  private async _doEntries(): Promise<Array<{ key: string; size: number }>> {
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
const storageCache = new Map<string, PluginStorageImpl>()

/** 查找或创建具体 PluginStorageImpl。 */
function getOrCreateImpl(pluginId: string): PluginStorageImpl {
  let s = storageCache.get(pluginId)
  if (!s) {
    s = new PluginStorageImpl(pluginId)
    storageCache.set(pluginId, s)
  }
  return s
}

/** 获取每插件 storage 实例。 */
export function getPluginStorage(pluginId: string): PluginStorage {
  return getOrCreateImpl(pluginId)
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
 * Host-only: this entry point bypasses the `storage` permission
 * check. The storage inspector is a user-facing debugging tool,
 * not a plugin code path — the user should be able to inspect and
 * clear storage for any plugin regardless of the plugin's current
 * `storage` grant (a plugin that had the permission revoked, or
 * was never granted it, may still have stale data on disk from a
 * previous install/session). Falls back to an empty list if the
 * plugin has no storage cache (e.g. never been used) or no
 * storage file.
 */
export async function getPluginStorageEntries(
  pluginId: string
): Promise<Array<{ key: string; size: number }>> {
  return getOrCreateImpl(pluginId).entriesHost()
}

/**
 * Host-only: delete a single key from a plugin's storage
 * namespace, bypassing the `storage` permission check. See
 * `getPluginStorageEntries` for the rationale. Used by the
 * storage inspector dialog's per-row "delete" action.
 */
export async function deletePluginStorageEntry(
  pluginId: string,
  key: string
): Promise<void> {
  await getOrCreateImpl(pluginId).deleteHost(key)
}

/**
 * Host-only: clear every key in a plugin's storage namespace,
 * bypassing the `storage` permission check. Used by the storage
 * inspector's "clear all" action.
 */
export async function clearPluginStorage(pluginId: string): Promise<void> {
  await getOrCreateImpl(pluginId).clearHost()
}

// ─── Lifecycle hook runner ────────────────────────────────────────────────────

/**
 * Build a PluginContext for invoking a plugin's lifecycle hooks.
 * `invokeBackend` is intentionally a no-op here: lifecycle hooks
 * are JS-side only and run on the same side as the plugin module.
 * Backend IPC is for the panel itself and is exposed via
 * `PluginPanelProps.invokeBackend`.
 *
 * Implemented in terms of the SDK's `buildPluginContext` so the
 * context shape stays in lockstep with what plugin code sees
 * during `onLoad` / `onEnable` etc. The host override is just
 * the lifecycle-hooks-aren't-allowed-to-call-backends policy.
 */
export function buildPluginContext(plugin: PluginDefinition): PluginContext {
  const ctx = sdkBuildPluginContext(plugin)
  return {
    ...ctx,
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

// 类型化每事件 emit 辅助函数。

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
