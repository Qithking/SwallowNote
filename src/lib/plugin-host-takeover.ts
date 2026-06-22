/** 插件宿主接管：将 SDK 的 in-process stub 替换为宿主的权限检查实现。Inline 插件跳过接管。 */
import type {
  PluginContext,
  PluginDefinition,
  PluginLifecycleHook,
  PluginPermission,
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
import {
  registerEditor,
  unregisterEditor,
  getEditorForExtension,
  getActivePluginExtensions,
} from '@/stores/pluginEditor'
import { assertPermission } from './plugin-permission-guard'
import { writePluginSettings } from './tauri'
import { loadSettings as loadSettingsCache, readSetting } from './plugin-settings'
import { emitPluginSettingsChanged } from '@swallow-note/plugin-sdk'

/** 生命周期钩子默认超时 5s。 */
export const DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS = 5000

/** 动态导入的插件模块引用；inline 插件为 undefined。 */
export interface PluginWithModule extends PluginDefinition {
  /** Dynamic-import result; only present for plugins loaded from disk. */
  __pluginModule?: { setHost?: (overrides: HostOverrides) => () => void }
}

/** 构建 SDK 用的 HostOverrides。 */
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
    // emit 端权限检查：未授权不能 emit，授权的只能以自身 pluginId 归因。
    on: (e, h) => pluginEvents.on(e, h),
    off: (e, h) => pluginEvents.off(e, h),
    emit: (e, p) => {
      assertPermission(pluginId, 'events', `emit "${e}"`)
      pluginEventBus.emit(e, p)
    },
    // invokeBackend 经 SDK 路径调用。
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
    /** 插件设置桥接（SQLite-backed），复用 storage 权限。 */
    __pluginSettings_get: async (id, key) => {
      // 设置复用 storage 权限。
      assertPermission(id, 'storage', `read plugin setting "${key}"`)
      const view = await loadSettingsCache(id, true)
      return readSetting(view, key)
    },
    __pluginSettings_set: async (id, key, value) => {
      assertPermission(id, 'storage', `write plugin setting "${key}"`)
      const view = await loadSettingsCache(id, true)
      const next = { ...view.values, [key]: value }
      await writePluginSettings(id, next)
      // 广播 plugin-settings:change 事件。
      emitPluginSettingsChanged(id, next)
    },
    __pluginSettings_all: async (id) => {
      assertPermission(id, 'storage', `read all plugin settings`)
      const view = await loadSettingsCache(id, true)
      return { ...view.values }
    },
    __pluginSettings_subscribe: (handler) => {
      // 订阅通过 per-plugin bus 走 events 权限门。
      const tagged = handler as unknown as { __pluginId?: string }
      tagged.__pluginId = pluginId
      // 通过 per-plugin bus 订阅。
      return pluginEvents.on('plugin-settings:change', (payload) => {
        handler(payload)
      })
    },
    /**
     * File-editor registry bridge. The host's `registerEditor`
     * is the production path; the SDK's stub is bypassed because
     * `currentHostOverrides().registerEditor` short-circuits the
     * stub layer. The host-side registry performs the real
     * permission check (defence in depth — the SDK's
     * `__assertPluginPermission` override is the first gate)
     * and rejects duplicate extensions with a toast + throw.
     */
    registerEditor: (id, extension, component) => {
      // The SDK calls
      //   currentHostOverrides().registerEditor?.(pluginId, extension, component)
      // so the host override's signature must accept the same
      // three arguments. We close over `pluginId` from the
      // surrounding scope to avoid trusting the plugin to
      // declare its own id (a malicious plugin could pass
      // someone else's id and steal the extension). The `id`
      // parameter is therefore ignored and `pluginId` wins;
      // we still destructure it to keep the type-checker
      // happy.
      void id
      return registerEditor(pluginId, extension, component)
    },
    unregisterEditor: () => unregisterEditor(pluginId),
    getEditorForExtension: (extension) => {
      const entry = getEditorForExtension(extension)
      // The host-side registry stores a plain
      // `PluginEditorEntry`; the SDK's `HostOverrides` type
      // wants the same shape, so we return it as-is. Callers
      // that consumed the SDK's stub expect a strongly-typed
      // component; the host-bridged component is the same
      // React component type, so the type compatibility holds
      // at the call site (the SDK's getEditorForExtension
      // narrows it back).
      return entry
        ? {
            pluginId: entry.pluginId,
            component: entry.component,
          }
        : null
    },
    getActivePluginExtensions: () => getActivePluginExtensions(),
    /**
     * Permission gate for the editor registry. The SDK's
     * `registerEditor` calls this before any mutation; we
     * delegate to the host's `assertPermission` so the
     * authoritative grant (in
     * `plugin_permissions_<id>` localStorage) is the source
     * of truth. A denial throws `PluginPermissionDeniedError`,
     * which the SDK re-throws verbatim.
     */
    __assertPluginPermission: (
      targetPluginId: string,
      permission: PluginPermission,
      operation: string,
    ) => {
      // We re-assert against the host's authoritative
      // permission gate. The `targetPluginId` is the id the
      // SDK received from the plugin's own call — we still
      // run the check against it because the SDK's
      // `__assertPluginPermission` is per-call (the registry
      // itself does a second pass). A plugin that somehow
      // impersonated another id would still be caught by the
      // registry's own `usePluginStore` check.
      assertPermission(targetPluginId, permission, operation)
    },
  }
}

/** timeoutMs：钩子超时阈值，默认 5s。 */
export interface RunPluginLifecycleHookOptions {
  timeoutMs?: number
}

/**
 * 运行生命周期钩子并安装接管。Inline 插件跳过。
 * 超时后标记 unhealthy 并自动禁用。
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

  // 用 timedOut 标志而非 rejection，确保 finally 中的 restore 执行。
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
      // 同步更新 store 和 telemetry 健康状态。
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

/** 超时处理：标记 unhealthy、自动禁用、记录遥测。 */
async function handleHookTimeout(
  plugin: PluginDefinition,
  hookName: string,
  timeoutMs: number,
): Promise<void> {
  const message = `Lifecycle hook "${hookName}" exceeded ${timeoutMs}ms timeout`
  console.error(`[plugin-host-takeover] Plugin "${plugin.id}": ${message}, auto-disabling.`)
  // 遥测先行（fire-and-forget）。
  void import('./plugin-telemetry').then(({ recordPluginError }) => {
    recordPluginError(plugin.id, hookName, message, true)
  })
  try {
    const { usePluginStore } = await import('@/stores')
    const store = usePluginStore.getState()
    // 仅在插件仍在注册表时翻转状态。
    if (store.getPluginById(plugin.id)) {
      store.setPluginHealth(plugin.id, 'unhealthy')
      // 禁用链在第二次调用时自动终止。
      store.setPluginEnabled(plugin.id, false)
      // 持久化禁用状态到磁盘。
      void import('@/lib/tauri').then(({ togglePluginEnabled }) => {
        void togglePluginEnabled(plugin.id, false)
      })
    }
  } catch (err) {
    console.error(`[plugin-host-takeover] Failed to handle timeout for plugin "${plugin.id}":`, err)
  }
}
