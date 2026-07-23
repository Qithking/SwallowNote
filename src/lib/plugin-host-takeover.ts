/** 插件宿主接管：将 SDK 的 in-process stub 替换为宿主实现。 */
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
import { logger } from './logger'

/** 生命周期钩子默认超时 5s。 */
export const DEFAULT_LIFECYCLE_HOOK_TIMEOUT_MS = 5000

/** 动态导入的插件模块引用；inline 插件为 undefined。 */
export interface PluginWithModule extends PluginDefinition {
  /** 动态导入结果，仅磁盘插件有 */
  __pluginModule?: { setHost?: (overrides: HostOverrides) => () => void }
}

/** 插件持久化的 setHost restore 函数映射。 */
const hostTakeoverRestoreMap = new Map<string, () => void>()

/** 安装持久化 host takeover */
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
    // 复用 events 权限门禁
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
      // 熔断插件拒绝 IPC，防超时后后台钩子副作用
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
      // 订阅通过 per-plugin bus 走 events 权限门
      const tagged = handler as unknown as { __pluginId?: string }
      tagged.__pluginId = pluginId
      return pluginEvents.on('plugin-settings:change', (payload) => {
        handler(payload)
      })
    },
    /** 桥接到宿主 registerEditor，做权限校验与去重。 */
    registerEditor: (id, extension, component) => {
      // 忽略插件传入 id，用闭包 pluginId 防冒充
      void id
      return registerEditor(pluginId, extension, component)
    },
    unregisterEditor: () => unregisterEditor(pluginId),
    getEditorForExtension: (extension) => {
      const entry = getEditorForExtension(extension)
      // 类型形状一致，原样返回
      return entry
        ? {
            pluginId: entry.pluginId,
            component: entry.component,
          }
        : null
    },
    getActivePluginExtensions: () => getActivePluginExtensions(),
    /** openEditorTab 桥接：注册运行时数据并 addTab。 */
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
    /** closePluginTabs 桥接：filterTabs 过滤 pluginId。 */
    closePluginTabs: (id) => {
      void id // 忽略插件传入的 id，使用闭包中可信的 pluginId
      useEditorStore.getState().filterTabs((tab) => tab.pluginId !== pluginId)
    },
    /** closeEditorTab 桥接：校验归属后 removeTab。 */
    closeEditorTab: (id, tabId) => {
      void id // 忽略插件传入的 id，使用闭包中可信的 pluginId
      const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId)
      if (tab && tab.pluginId === pluginId) {
        useEditorStore.getState().removeTab(tabId)
      }
    },
    /** 委托宿主 assertPermission，拒绝时抛错。 */
    __assertPluginPermission: (
      targetPluginId: string,
      permission: PluginPermission,
      operation: string,
    ) => {
      // 再次权限校验，注册表自带二次检查兜底
      assertPermission(targetPluginId, permission, operation)
    },
  }
}

/** timeoutMs：钩子超时阈值，默认 5s。 */
export interface RunPluginLifecycleHookOptions {
  timeoutMs?: number
}

/** 运行生命周期钩子并安装接管，超时标记 unhealthy。 */
export async function runPluginLifecycleHook(
  plugin: PluginDefinition,
  hook: PluginLifecycleHook | undefined,
  context: PluginContext,
  hookName: string,
  options: RunPluginLifecycleHookOptions = {}
): Promise<void> {
  if (!hook) return
  // 不在每轮钩子前清熔断标志，避免旧 hookPromise 绕过检查
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
        logger.error('plugin-takeover', `Failed to mark plugin "${plugin.id}" healthy in store:`, err)
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
  logger.error('plugin-takeover', `Plugin "${plugin.id}": ${message}, auto-disabling.`)
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
    logger.error('plugin-takeover', `Failed to handle timeout for plugin "${plugin.id}":`, err)
  }
}
