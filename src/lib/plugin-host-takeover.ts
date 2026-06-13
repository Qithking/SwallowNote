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
import { assertPermission } from './plugin-permission-guard'

/**
 * Plugins loaded by `loadPluginModule` are produced by a dynamic
 * `import(...)`; the resulting ES module has the SDK inlined and
 * exposes a `setHost` function (provided the plugin's entry file
 * re-exports it). The loader stashes the module reference on the
 * definition as a non-enumerable property so the store / panel
 * host can install takeovers later without re-importing the
 * bundle.
 *
 * Inline plugins (defined in `src/lib/plugin-samples/*.tsx` for
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
    on: (e, h) => pluginEvents.on(e, h),
    off: (e, h) => pluginEvents.off(e, h),
    emit: (e, p) => pluginEventBus.emit(e, p),
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
  }
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
 */
export async function runPluginLifecycleHook(
  plugin: PluginDefinition,
  hook: PluginLifecycleHook | undefined,
  context: PluginContext,
  hookName: string
): Promise<void> {
  if (!hook) return
  const mod = (plugin as PluginWithModule).__pluginModule
  const restore = mod?.setHost ? mod.setHost(buildOverridesForPlugin(plugin)) : undefined
  try {
    await runLifecycleHook(hook, context, hookName)
  } finally {
    restore?.()
  }
}
