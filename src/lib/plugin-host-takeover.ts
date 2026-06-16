/**
 * Plugin Host Takeover
 *
 * The plugin SDK ships with a set of in-process stub implementations
 * (storage, event bus, context-menu registry) so plugin authors can
 * iterate against `npm run dev` in the starter template without the
 * host. When the host loads an external plugin bundle, the SDK's
 * stubs must be replaced with the host's real implementations so:
 *
 *   1. The runtime permission checks actually fire
 *      (`assertPermission('context-menu', ...)`, `assertPermission('storage', ...)`
 *      etc. are wired into the host's `pluginMenuRegistry.register` /
 *      `PluginStorageImpl.set` paths; the stubs don't enforce them).
 *   2. Cross-plugin state is shared (one global event bus, one
 *      Tauri-backed storage layer).
 *   3. Backend IPC is reachable.
 *
 * Design
 * ------
 * Each plugin bundle has its own SDK instance (the SDK is inlined
 * by the bundler). The host's job is to call `setHost({...})` on
 * the bundle's SDK right before firing a lifecycle hook, and to
 * call the returned `restore` once the hook settles. The
 * `runPluginLifecycleHook` helper here wires that up so the
 * existing `runLifecycleHook` call sites in the store and
 * `PluginPanelHost` get takeover for free.
 *
 * The host can't reach the bundle's SDK directly – it can only
 * talk to the IIFE's exported properties. That's why the plugin
 * template and samples re-export `setHost` from the SDK in their
 * entry file: the host reads `pluginModule.setHost` and calls it.
 * Plugins defined inline in the host (no `__pluginModule` field)
 * skip the takeover automatically – they import the host's real
 * implementations directly.
 */
import type {
  PluginContext,
  PluginDefinition,
  PluginLifecycleHook,
} from '@/types/plugin'
import type { HostOverrides } from '@swallow-note/plugin-sdk'
import { getPluginStorage, pluginEventBus, createPluginEventBus, runLifecycleHook } from './plugin-host'
import {
  registerContextMenu,
  unregisterContextMenu,
  clearPluginMenuItems,
  getContextMenuItems,
} from './plugin-menu'
import {
  registerCommand,
  unregisterCommand,
  clearPluginCommands,
} from './plugin-commands'
import { assertPermission } from './plugin-permission-guard'
import { writePluginSettings } from './tauri'
import { loadSettings as loadSettingsCache, readSetting } from './plugin-settings'
import { emitPluginSettingsChanged } from '@swallow-note/plugin-sdk'

/**
 * Default timeout (ms) applied to a plugin lifecycle hook. If a hook
 * (onLoad / onEnable / onDisable / onUnload) doesn't settle within
 * this window the host assumes the plugin is wedged, marks it
 * unhealthy, auto-disables it, and records the timeout in
 * telemetry. The value is intentionally generous – most real
 * plugins finish their onLoad in well under a second, but the host
 * itself round-trips to a Tauri command inside some hooks (e.g. for
 * `invokeBackend`), which can be 50–100ms on a cold IPC channel.
 * Bumping this from 5s to a higher value is safe; the goal is
 * "don't block the host forever" rather than "fail fast".
 */
export const DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS = 5000

/**
 * Plugins loaded by `loadPluginModule` are produced by a dynamic
 * `import(...)`; the resulting ES module has the SDK inlined and
 * exposes a `setHost` function (provided the plugin's entry file
 * re-exports it). The loader stashes the module reference on the
 * definition as a non-enumerable property so the store / panel
 * host can install takeovers later without re-importing the
 * bundle.
 *
 * Inline plugins (defined in `src/lib/core-plugins/*.tsx` for
 * example) never go through the loader, so this field stays
 * undefined for them and the takeover is skipped – those plugins
 * import the host's real implementations directly.
 */
export interface PluginWithModule extends PluginDefinition {
  /** Dynamic-import result; only present for plugins loaded from disk. */
  __pluginModule?: { setHost?: (overrides: HostOverrides) => () => void }
}

/**
 * Build the HostOverrides object the SDK dispatches to. Every
 * function captured here forwards into the host's real,
 * permission-checked implementation. Closures that need a
 * `pluginId` (only `invokeBackend`) capture it from the
 * `plugin` argument so the per-plugin override stays correct
 * even when the host is firing multiple plugins' hooks
 * concurrently – the SDK's stack-based setHost keeps each
 * layer independent.
 */
function buildOverridesForPlugin(plugin: PluginDefinition): HostOverrides {
  const pluginId = plugin.id
  const pluginEvents = createPluginEventBus(pluginId)
  return {
    getPluginStorage: (id) => getPluginStorage(id),
    registerContextMenu: (id, item) => registerContextMenu(id, item),
    unregisterContextMenu: (id, itemId) => unregisterContextMenu(id, itemId),
    clearPluginMenuItems: (id) => clearPluginMenuItems(id),
    getContextMenuItems: (loc, ctx) => getContextMenuItems(loc, ctx),
    // Command-palette contributions (Task 9 / G9). The permission
    // gate re-checks `events` (the same permission that covers
    // host-event subscriptions) so a plugin that can't subscribe to
    // host events also can't add command palette entries.
    registerCommand: (id, command) => registerCommand(id, command),
    unregisterCommand: (id, commandId) => unregisterCommand(id, commandId),
    clearPluginCommands: (id) => clearPluginCommands(id),
    // Symmetric with `on`: the per-plugin `pluginEvents` proxy
    // routes `on` through `pluginEventBus.on` which already runs
    // `assertPermission(pluginId, 'events', ...)`. The emit side
    // was previously a raw `pluginEventBus.emit(...)` which let an
    // unauthorized plugin spoof host events (note:open, theme:change
    // …) into every other plugin's handlers – the dispatch runs
    // through the global bus so every subscriber would treat the
    // fake as a legitimate host event. The permission gate below
    // closes the loop: a plugin without the `events` grant cannot
    // emit, and a plugin that *can* emit can only do so under its
    // own `pluginId` attribution (the SDK's per-event helpers
    // funnel through `hostOverrides.emit` so this is the only
    // path that needs the guard).
    on: (e, h) => pluginEvents.on(e, h),
    off: (e, h) => pluginEvents.off(e, h),
    emit: (e, p) => {
      assertPermission(pluginId, 'events', `emit "${e}"`)
      pluginEventBus.emit(e, p)
    },
    // `invokeBackend` is reached from the SDK's `buildPluginContext`
    // path – a plugin's lifecycle hook can do
    //   const ctx = buildPluginContext(...)
    //   await ctx.invokeBackend('greet', { name: 'world' })
    // and the SDK routes the call through `hostOverrides.invokeBackend`.
    // The panel itself uses `panel.invokeBackend` (a separate path
    // that lives in `plugin-utils.tsx`), not this one, so the closure
    // is only relevant for hooks.
    invokeBackend: async (cmd, args) => {
      assertPermission(pluginId, 'backend', `invoke backend command "${cmd}"`)
      const { invoke } = await import('@tauri-apps/api/core')
      const start = performance.now()
      let success = true
      let errorMsg: string | undefined
      try {
        return await invoke('invoke_plugin', { pluginId, command: cmd, args })
      } catch (err) {
        success = false
        errorMsg = String(err)
        throw err
      } finally {
        const durationMs = performance.now() - start
        void import('./plugin-telemetry').then(({ recordBackendMetric }) => {
          recordBackendMetric(pluginId, cmd, durationMs, success, errorMsg)
        })
      }
    },
    // Plugin settings (SQLite-backed). The host bridges the SDK's
    // `getSetting` / `setSetting` / `getAllSettings` / `onSettingsChange`
    // to its real implementations; the standalone stub falls back to
    // a per-plugin storage cache. `readSetting(view, key)` (from
    // `@/lib/plugin-settings`) returns the stored value, then the
    // schema default, then `null` — exactly the contract the SDK
    // publishes. `saveSettings` (already imported through the
    // cache) is called for the per-key write; it updates the host
    // cache and writes through to SQLite.
    __pluginSettings_get: async (id, key) => {
      // The settings layer reuses the existing `storage`
      // permission. Settings *are* a kind of storage and the
      // schema-driven dialog is gated by the same grant; the
      // host doesn't introduce a new `plugin-settings`
      // permission kind to keep the install-time UX
      // frictionless.
      assertPermission(id, 'storage', `read plugin setting "${key}"`)
      const view = await loadSettingsCache(id, true)
      return readSetting(view, key)
    },
    __pluginSettings_set: async (id, key, value) => {
      assertPermission(id, 'storage', `write plugin setting "${key}"`)
      const view = await loadSettingsCache(id, true)
      const next = { ...view.values, [key]: value }
      await writePluginSettings(id, next)
      // Fan the change out to every panel/toolbar instance of
      // this plugin id. We dispatch the typed
      // `plugin-settings:change` event on the global bus so a
      // subscriber registered via `panel.onSettingsChange`
      // picks up the new full map regardless of which instance
      // wrote.
      emitPluginSettingsChanged(id, next)
    },
    __pluginSettings_all: async (id) => {
      assertPermission(id, 'storage', `read all plugin settings`)
      const view = await loadSettingsCache(id, true)
      return { ...view.values }
    },
    __pluginSettings_subscribe: (handler) => {
      // The host's per-plugin event bus filters by `__pluginId`,
      // so we tag the handler with the host's pluginId. The
      // SDK stub does not perform this tag check – the host
      // bus is the only one that needs it for the permission
      // gate. We also need to read the settings on every
      // emit because the payload only carries the values map;
      // we re-read schema defaults on demand via the same
      // cache the host uses for dialog renders. We hand the
      // SDK a callback that always emits the latest map so
      // subscribers get a stable, post-write snapshot.
      const tagged = handler as unknown as { __pluginId?: string }
      tagged.__pluginId = pluginId
      // Subscribe via the per-plugin bus so the host's `events.on`
      // permission gate runs (the SDK's `onSettingsChange` calls
      // this override; the host owns the gate). We also wrap the
      // call so the SDK only sees the values map, not the
      // per-plugin envelope.
      return pluginEvents.on('plugin-settings:change', (payload) => {
        handler(payload)
      })
    },
  }
}

/**
 * Options accepted by `runPluginLifecycleHook`.
 *
 * - `timeoutMs`: max time to wait for the hook to settle. Default
 *   {@link DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS}. On timeout the host
 *   marks the plugin unhealthy, auto-disables it, and records the
 *   timeout in telemetry. The hook's own promise is left running
 *   (the host can't cancel user code) but the host no longer
 *   awaits it – control returns to the caller immediately.
 */
export interface RunPluginLifecycleHookOptions {
  timeoutMs?: number
}

/**
 * Run a plugin lifecycle hook with the host takeover installed
 * for the duration of the call. The takeover wraps the hook so
 * any SDK runtime function the plugin's hook uses
 * (`getPluginStorage`, `registerContextMenu`, etc.) reaches the
 * host's real, permission-checked implementation instead of the
 * in-process stub.
 *
 * Concurrency: the SDK's `setHost` is stack-based (each call
 * gets a unique token; the returned `restore` matches by token
 * rather than by `previous` snapshot), so concurrent hook fires
 * are safe – plugin A's `restore()` only pops A's layer, even
 * if B's layer is on top.
 *
 * If the plugin has no `__pluginModule` (inline plugins), the
 * takeover is skipped. The hook still fires via the host's
 * `runLifecycleHook`, and any SDK imports the inline plugin made
 * are no-ops because the host's real implementations were
 * imported directly under the same names.
 *
 * Timeout: a slow hook (one that doesn't resolve within
 * `options.timeoutMs`, default {@link DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS})
 * triggers the health monitor: the plugin is flipped to
 * `unhealthy` in the store, `setPluginEnabled(id, false)` is
 * invoked to take it out of the registry, and a `lastError` is
 * recorded via `recordPluginError` for the diagnostics popup.
 * The host does NOT block waiting for the wedged hook – the
 * underlying `runLifecycleHook` promise keeps running in the
 * background (we can't cancel user code) but the caller gets
 * control back as soon as the timeout fires.
 */
export async function runPluginLifecycleHook(
  plugin: PluginDefinition,
  hook: PluginLifecycleHook | undefined,
  context: PluginContext,
  hookName: string,
  options: RunPluginLifecycleHookOptions = {}
): Promise<void> {
  if (!hook) return
  const mod = (plugin as PluginWithModule).__pluginModule
  const restore = mod?.setHost ? mod.setHost(buildOverridesForPlugin(plugin)) : undefined
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS

  // Race the hook against a timer. We use a `timedOut` flag rather
  // than a rejection from the timer promise so the caller's `await`
  // resolves (not rejects) on timeout – the buggy plugin's promise
  // still keeps running in the background, but it can't propagate
  // an unhandled rejection to the host because `runLifecycleHook`
  // already swallows its own errors. Returning normally on timeout
  // is important: the takeover layer's `finally` block (which calls
  // `restore`) must run so the SDK stack doesn't accumulate
  // orphaned layers across many wedged hooks.
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const hookPromise = runLifecycleHook(hook, context, hookName)
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      resolve()
    }, timeoutMs)
  })

  try {
    await Promise.race([hookPromise, timeoutPromise])
    if (timedOut) {
      await handleHookTimeout(plugin, hookName, timeoutMs)
    } else {
      // Hook completed within budget. Mark the plugin healthy
      // so the UI badge clears any prior "unhealthy" status
      // from a previous run (e.g. user re-enabled after we
      // auto-disabled). We update both layers:
      //   1. The store's per-plugin `pluginHealth` map (drives
      //      the card's `data-plugin-health` attribute).
      //   2. Telemetry's `lastErrorByPlugin` cache (drives the
      //      diagnostics popup's "last error" line).
      // Updating both here means a re-enable from the user
      // immediately transitions the card from "unhealthy" to
      // "healthy" without the diagnostics popup still showing
      // a stale error from a prior wedged run.
      try {
        const { usePluginStore } = await import('@/stores')
        usePluginStore.getState().setPluginHealth(plugin.id, 'healthy')
      } catch (err) {
        console.error(`[plugin-host-takeover] Failed to mark plugin "${plugin.id}" healthy in store:`, err)
      }
      void import('./plugin-telemetry').then(({ markPluginHealthy }) => {
        markPluginHealthy(plugin.id)
      })
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    restore?.()
  }
}

/**
 * Apply the health-monitor response to a timed-out hook: mark the
 * plugin unhealthy, auto-disable it, and record the failure in
 * telemetry. We use a dynamic import of the plugin store so this
 * module can be loaded by the store itself (and by tests) without
 * triggering a circular-dep at module-evaluation time.
 *
 * The store call is best-effort: if the plugin was already removed
 * from the registry by the time the timer fires (e.g. the user
 * uninstalled it concurrently), the store action logs and returns
 * silently. We still record the timeout in telemetry – the
 * diagnostics popup surfaces a "last error" line regardless of
 * whether the plugin is still installed.
 */
async function handleHookTimeout(
  plugin: PluginDefinition,
  hookName: string,
  timeoutMs: number,
): Promise<void> {
  const message = `Lifecycle hook "${hookName}" exceeded ${timeoutMs}ms timeout`
  console.error(`[plugin-host-takeover] Plugin "${plugin.id}": ${message}, auto-disabling.`)
  // Telemetry first – the diagnostics popup reads it independently
  // of the store. recordPluginError is fire-and-forget; we don't
  // await it. The `autoDisabled: true` flag lets the UI render the
  // error chip as a "we auto-disabled this plugin" warning rather
  // than a soft "we logged this" note.
  void import('./plugin-telemetry').then(({ recordPluginError }) => {
    recordPluginError(plugin.id, hookName, message, true)
  })
  try {
    const { usePluginStore } = await import('@/stores')
    const store = usePluginStore.getState()
    // Only flip to unhealthy if the plugin is still in the
    // registry. A concurrent uninstall will have already removed
    // it; calling `setPluginHealth` on a missing id is a silent
    // no-op, but skipping the action keeps the store's per-plugin
    // map clean of stale entries.
    if (store.getPluginById(plugin.id)) {
      store.setPluginHealth(plugin.id, 'unhealthy')
      // setPluginEnabled fires onDisable, which goes back through
      // runPluginLifecycleHook and could itself time out. The
      // chain terminates after the first disable (the second call
      // sees `wasEnabled === enabled === false` and skips the
      // hook fire), so we don't need a separate "force disable"
      // action.
      store.setPluginEnabled(plugin.id, false)
      // Persist the disabled state to disk so the auto-disable
      // survives a restart. The plugin-health module already
      // imports the store this way, so this is the established
      // pattern for side-effects that need to fan out to the
      // backend after a store action.
      void import('@/lib/tauri').then(({ togglePluginEnabled }) => {
        void togglePluginEnabled(plugin.id, false)
      })
    }
  } catch (err) {
    console.error(`[plugin-host-takeover] Failed to handle timeout for plugin "${plugin.id}":`, err)
  }
}
