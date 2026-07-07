/** 插件宿主接管：将 SDK 的 in-process stub 替换为宿主的权限检查实现。Inline 插件跳过接管。 */
import type {
  PluginContext,
  PluginDefinition,
  PluginLifecycleHook,
  PluginPermission,
} from '@/types/plugin'
import type { HostOverrides } from '@swallow-note/plugin-sdk'
import {
  getPluginStorage,
  pluginEventBus,
  createPluginEventBus,
  runLifecycleHook,
  markPluginTripped,
  isPluginTripped,
} from './plugin-host'
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
import { useEditorStore, registerPluginTabRuntime } from '@/stores/editor'
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

/** 每个插件的持久化 setHost restore 函数映射。
 *  setHost 应在插件加载时安装，卸载时移除，
 *  而不是只在生命周期 hook 执行期间临时安装（后者会导致
 *  openEditorTab 等 SDK 顶层 API 在 hook 执行完后失效）。 */
const hostTakeoverRestoreMap = new Map<string, () => void>()

/** 为插件安装持久化 host takeover（setHost）。
 *  插件加载完成后调用一次，保持到插件卸载。 */
export function installHostTakeover(plugin: PluginDefinition): void {
  const mod = (plugin as PluginWithModule).__pluginModule
  if (!mod?.setHost) return
  // 避免重复安装
  if (hostTakeoverRestoreMap.has(plugin.id)) return
  const restore = mod.setHost(buildOverridesForPlugin(plugin))
  hostTakeoverRestoreMap.set(plugin.id, restore)
}

/** 卸载插件的持久化 host takeover。插件卸载时调用。 */
export function uninstallHostTakeover(pluginId: string): void {
  const restore = hostTakeoverRestoreMap.get(pluginId)
  if (restore) {
    restore()
    hostTakeoverRestoreMap.delete(pluginId)
  }
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
      // 熔断插件拒绝 IPC 调用，防止超时后后台钩子继续触发后端副作用。
      if (isPluginTripped(pluginId)) {
        throw new Error(
          `[plugin-host-takeover] invokeBackend refused: plugin "${pluginId}" is tripped (lifecycle hook timed out)`
        )
      }
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
     * openEditorTab 桥接：让插件在主编辑区打开一个 tab。
     *
     * 插件调用 openEditorTab(pluginId, props) 后，SDK 通过 HostOverrides
     * 转发到此实现。我们：
     * 1. 注册运行时数据（icon、onChange 回调）到 pluginTabRuntime Map——
     *    每次调用都刷新，因为插件可能传入新的函数实例（闭包捕获了最新状态）。
     * 2. 调用 addTab 创建或复用 tab：addTab 按 path 去重，已存在则切换
     *    activeTabId（不覆盖已有内容，避免丢失用户未保存的编辑），不存在
     *    则新建 plugin tab。
     *
     * 注意：忽略插件传入的 id 参数，使用闭包中可信的 pluginId，防止恶意
     * 插件冒用其他插件 id。path 使用 `plugin://` 前缀标识非文件系统路径。
     */
    openEditorTab: (id, props) => {
      void id // 忽略插件传入的 id，使用闭包中可信的 pluginId
      registerPluginTabRuntime(props.id, {
        icon: props.icon,
        onChange: props.onChange,
      })
      useEditorStore.getState().addTab({
        id: props.id,
        // 虚拟路径：用于 addTab 去重，不指向真实文件系统
        path: `plugin://${pluginId}/${props.id}`,
        name: props.name,
        content: props.content,
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
        type: 'plugin',
        pluginId,
        toolbarConfig: props.toolbarConfig,
      })
    },
    /**
     * closePluginTabs 桥接：关闭指定插件打开的所有 tab。
     * 插件调用 closePluginTabs(pluginId) 后，SDK 通过 HostOverrides
     * 转发到此实现。我们调用 filterTabs 过滤掉 pluginId 匹配的 tab。
     */
    closePluginTabs: (id) => {
      void id // 忽略插件传入的 id，使用闭包中可信的 pluginId
      useEditorStore.getState().filterTabs((tab) => tab.pluginId !== pluginId)
    },
    /**
     * closeEditorTab 桥接：关闭指定插件打开的某个 tab。
     * 插件调用 closeEditorTab(pluginId, tabId) 后，SDK 通过 HostOverrides
     * 转发到此实现。我们先校验该 tab 确实属于当前插件，再调用 removeTab。
     */
    closeEditorTab: (id, tabId) => {
      void id // 忽略插件传入的 id，使用闭包中可信的 pluginId
      const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId)
      if (tab && tab.pluginId === pluginId) {
        useEditorStore.getState().removeTab(tabId)
      }
    },
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
 * 超时后标记 unhealthy、自动禁用，并置位熔断标志以阻止超时后仍在后台运行的
 * hookPromise 继续产生事件派发 / storage 写入 / IPC 调用等副作用。
 */
export async function runPluginLifecycleHook(
  plugin: PluginDefinition,
  hook: PluginLifecycleHook | undefined,
  context: PluginContext,
  hookName: string,
  options: RunPluginLifecycleHookOptions = {}
): Promise<void> {
  if (!hook) return
  // 注意：不在每轮钩子调用前清除熔断标志。上一轮超时的 hookPromise 仍在后台
  // 运行（Promise.race 只让 await 提前返回，原 promise 不会中止），若在此清除，
  // 旧 hookPromise 后续的 storage.set / invokeBackend 会绕过熔断检查（P0 NEW-4）。
  // 熔断标志改由用户手动重新启用插件时清除（见 plugin store 的 setPluginEnabled）。
  // setHost 已由 installHostTakeover 持久化安装，不再在每次 hook 中临时安装/卸载。
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS

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
      // 同步标记熔断，立即阻止超时后仍在后台运行的 hookPromise 产生副作用。
      markPluginTripped(plugin.id)
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
