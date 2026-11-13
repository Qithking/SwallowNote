/**
 * 插件资源清理序列（lib 层共享，不依赖任何 store）。
 *
 * 收编自 plugin store 三处重复的清理序列（架构审查候选 1）：
 * `unregisterPlugin`（卸载）、`setPlugins` 的 removed 循环（重扫移除）、
 * `setPlugins` 的 reloadedOld 循环（同 id 重载旧实例）。
 *
 * 层次约定（Q7）：本模块只编排 lib 层清理函数；UI 复位
 * （sidebarView/rightPanelType）与 store 内部状态重建、编辑器扩展注销
 * （unregisterEditor）、快捷键修剪等 store 层职责由调用方负责。
 */
import { logger } from '@/lib/logger'
import type { PluginDefinition } from '@/types/plugin'
import {
  buildPluginContext,
  clearPluginHostState,
  dropPluginStorage,
  pluginEventBus,
} from '@/lib/plugin-host'
import { runPluginLifecycleHook, uninstallHostTakeover } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'
import { clearPluginCommands } from '@/lib/plugin-commands'
import { clearGranted } from '@/lib/plugin-permission-guard'
import { clearPluginMetrics } from '@/lib/plugin-telemetry'
import { dropSettingsCache } from '@/lib/plugin-settings'
import { resetPluginCrashCount } from '@/lib/plugin-health'
import { dropPluginBlobUrl } from '@/lib/plugin-loader'

/** localStorage 键前缀：插件自动更新 opt-in（与 plugin-permissions 同构的 per-id 命名空间）。 */
export const PLUGIN_AUTO_UPDATE_KEY_PREFIX = 'plugin_auto_update_'

export interface TeardownPluginOptions {
  /**
   * 保留权限授权：跳过 clearGranted（内存缓存）与 dropPluginPermissions
   * （磁盘记录）。同 id 重载场景必须保留——新实例 onLoad 重跑注册时
   * 才能通过权限门禁。
   */
  keepPermissions?: boolean
  /**
   * 保留用户数据：跳过 dropPluginStorage（插件 KV storage）与 localStorage
   * 自动更新 opt-in 清除。更新场景必须保留——更新不丢用户数据与偏好。
   */
  keepStorage?: boolean
}

/**
 * 执行插件的 lib 层资源清理序列。
 *
 * @param pluginId 插件 id。即使 target 缺省（卸载时插件已不在注册表），
 *                 id 级清理仍需照常执行，防止残留状态。
 * @param target   插件定义实例（调用方须在移除前捕获）。缺省时跳过
 *                 onUnload 钩子与 blob URL 释放，其余清理不受影响。
 * @param options  保留位。默认全清（卸载语义）；同 id 重载的旧实例传
 *                 `{ keepPermissions: true, keepStorage: true }`。
 */
export function teardownPlugin(
  pluginId: string,
  target: PluginDefinition | undefined,
  options: TeardownPluginOptions = {},
): void {
  // 触发 onUnload（fire-and-forget）。钩子可能仍需 SDK API，因此
  // uninstallHostTakeover 必须在其之后执行。
  if (target) {
    void runPluginLifecycleHook(
      target,
      target.hooks?.onUnload,
      buildPluginContext(target),
      'onUnload'
    )
  }
  // 卸载 host takeover（须在 onUnload 后，onUnload 可能仍需 SDK API）
  uninstallHostTakeover(pluginId)
  if (!options.keepStorage) {
    dropPluginStorage(pluginId)
  }
  // 释放插件加载时缓存的 blob URL，避免 Blob 对象内存泄漏
  if (target) dropPluginBlobUrl(target.pluginPath)
  // 清理 plugin-host 残留状态（熔断标志、事件总线"已拆线"计数器）。
  clearPluginHostState(pluginId)
  // 清理 plugin-settings 内存缓存，避免同 id 重装读到旧设置。
  dropSettingsCache(pluginId)
  // 清理插件崩溃计数，避免同 id 重装继承历史崩溃记录。
  resetPluginCrashCount(pluginId)
  // 移除插件注册的所有事件处理器，避免残留订阅触发
  pluginEventBus.removeAllListenersForPlugin(pluginId)
  // 清理插件贡献的右键菜单项与命令面板条目（onUnload 为异步，此处同步
  // 清理，避免钩子运行期间残留注册项）。
  clearPluginMenuItems(pluginId)
  clearPluginCommands(pluginId)
  if (!options.keepPermissions) {
    // 同步丢弃内存权限缓存（安全边界），磁盘记录异步删除。
    clearGranted(pluginId)
    void import('@/lib/plugin-permissions').then(({ dropPluginPermissions }) => {
      void dropPluginPermissions(pluginId)
    })
  }
  if (!options.keepStorage) {
    // 清除持久化的自动更新 opt-in（重装时默认禁用；重载场景保留用户偏好）。
    try {
      window.localStorage.removeItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}${pluginId}`)
    } catch (e) {
      logger.warn('plugin-teardown', 'localStorage write failed', e)
    }
  }
  // 清理遥测缓冲、存储尺寸映射和 lastError。
  clearPluginMetrics(pluginId)
}
