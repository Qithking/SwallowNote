/**
 * teardownPlugin 单测（架构审查候选 1）：
 * 验证三处收编的清理序列行为——默认全清、重载保留位、
 * target 缺省降级与顺序约束。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginDefinition } from '@/types/plugin'
import {
  teardownPlugin,
  PLUGIN_AUTO_UPDATE_KEY_PREFIX,
} from '@/lib/plugin-teardown'
import { dropPluginStorage, clearPluginHostState, pluginEventBus } from '@/lib/plugin-host'
import { runPluginLifecycleHook, uninstallHostTakeover } from '@/lib/plugin-host-takeover'
import { clearPluginMenuItems } from '@/lib/plugin-menu'
import { clearPluginCommands } from '@/lib/plugin-commands'
import { clearGranted } from '@/lib/plugin-permission-guard'
import { dropPluginPermissions } from '@/lib/plugin-permissions'
import { clearPluginMetrics } from '@/lib/plugin-telemetry'
import { dropSettingsCache } from '@/lib/plugin-settings'
import { resetPluginCrashCount } from '@/lib/plugin-health'
import { dropPluginBlobUrl } from '@/lib/plugin-loader'

vi.mock('@/lib/plugin-host', () => ({
  buildPluginContext: vi.fn(() => ({ __mock: 'ctx' })),
  clearPluginHostState: vi.fn(),
  dropPluginStorage: vi.fn(),
  pluginEventBus: { removeAllListenersForPlugin: vi.fn() },
}))
vi.mock('@/lib/plugin-host-takeover', () => ({
  runPluginLifecycleHook: vi.fn(),
  uninstallHostTakeover: vi.fn(),
}))
vi.mock('@/lib/plugin-menu', () => ({ clearPluginMenuItems: vi.fn() }))
vi.mock('@/lib/plugin-commands', () => ({ clearPluginCommands: vi.fn() }))
vi.mock('@/lib/plugin-permission-guard', () => ({ clearGranted: vi.fn() }))
vi.mock('@/lib/plugin-permissions', () => ({ dropPluginPermissions: vi.fn() }))
vi.mock('@/lib/plugin-telemetry', () => ({ clearPluginMetrics: vi.fn() }))
vi.mock('@/lib/plugin-settings', () => ({ dropSettingsCache: vi.fn() }))
vi.mock('@/lib/plugin-health', () => ({ resetPluginCrashCount: vi.fn() }))
vi.mock('@/lib/plugin-loader', () => ({ dropPluginBlobUrl: vi.fn() }))

/** 构造最小可用插件定义（测试只需 id/pluginPath/hooks 字段）。 */
const makeTarget = (id = 'p1'): PluginDefinition =>
  ({
    id,
    name: id,
    version: '1.0.0',
    pluginPath: `/plugins/${id}/plugin.js`,
    enabled: true,
    hooks: { onUnload: vi.fn() },
  }) as unknown as PluginDefinition

describe('teardownPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('默认全清：执行完整清理序列、触发 onUnload 并删除自动更新 opt-in', async () => {
    const target = makeTarget('p1')
    window.localStorage.setItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}p1`, 'true')

    teardownPlugin('p1', target)

    expect(runPluginLifecycleHook).toHaveBeenCalledWith(
      target,
      target.hooks?.onUnload,
      expect.anything(),
      'onUnload',
    )
    expect(uninstallHostTakeover).toHaveBeenCalledWith('p1')
    expect(dropPluginStorage).toHaveBeenCalledWith('p1')
    expect(dropPluginBlobUrl).toHaveBeenCalledWith('/plugins/p1/plugin.js')
    expect(clearPluginHostState).toHaveBeenCalledWith('p1')
    expect(dropSettingsCache).toHaveBeenCalledWith('p1')
    expect(resetPluginCrashCount).toHaveBeenCalledWith('p1')
    expect(pluginEventBus.removeAllListenersForPlugin).toHaveBeenCalledWith('p1')
    expect(clearPluginMenuItems).toHaveBeenCalledWith('p1')
    expect(clearPluginCommands).toHaveBeenCalledWith('p1')
    expect(clearGranted).toHaveBeenCalledWith('p1')
    expect(clearPluginMetrics).toHaveBeenCalledWith('p1')
    expect(window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}p1`)).toBeNull()
    // 磁盘权限记录删除是动态导入的异步路径
    await vi.waitFor(() => expect(dropPluginPermissions).toHaveBeenCalledWith('p1'))
  })

  it('顺序约束：uninstallHostTakeover 必须在 onUnload 触发之后', () => {
    teardownPlugin('p1', makeTarget('p1'))

    const unloadOrder = (runPluginLifecycleHook as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const takeoverOrder = (uninstallHostTakeover as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(unloadOrder).toBeLessThan(takeoverOrder)
  })

  it('keepPermissions + keepStorage（重载旧实例）：保留权限、storage 与自动更新 opt-in', () => {
    const target = makeTarget('p1')
    window.localStorage.setItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}p1`, 'true')

    teardownPlugin('p1', target, { keepPermissions: true, keepStorage: true })

    expect(dropPluginStorage).not.toHaveBeenCalled()
    expect(clearGranted).not.toHaveBeenCalled()
    expect(dropPluginPermissions).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(`${PLUGIN_AUTO_UPDATE_KEY_PREFIX}p1`)).toBe('true')
    // 运行期注册的资源照常清理
    expect(uninstallHostTakeover).toHaveBeenCalledWith('p1')
    expect(dropPluginBlobUrl).toHaveBeenCalledWith('/plugins/p1/plugin.js')
    expect(clearPluginHostState).toHaveBeenCalledWith('p1')
    expect(dropSettingsCache).toHaveBeenCalledWith('p1')
    expect(resetPluginCrashCount).toHaveBeenCalledWith('p1')
    expect(pluginEventBus.removeAllListenersForPlugin).toHaveBeenCalledWith('p1')
    expect(clearPluginMenuItems).toHaveBeenCalledWith('p1')
    expect(clearPluginCommands).toHaveBeenCalledWith('p1')
    expect(clearPluginMetrics).toHaveBeenCalledWith('p1')
  })

  it('target 缺省（卸载时已不在注册表）：跳过 onUnload 与 blob 释放，id 级清理照常', () => {
    teardownPlugin('p1', undefined)

    expect(runPluginLifecycleHook).not.toHaveBeenCalled()
    expect(dropPluginBlobUrl).not.toHaveBeenCalled()
    expect(dropPluginStorage).toHaveBeenCalledWith('p1')
    expect(uninstallHostTakeover).toHaveBeenCalledWith('p1')
    expect(clearGranted).toHaveBeenCalledWith('p1')
    expect(clearPluginMetrics).toHaveBeenCalledWith('p1')
  })

  it('localStorage 抛异常不中断后续清理', () => {
    const removeItem = vi
      .spyOn(window.localStorage, 'removeItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })

    expect(() => teardownPlugin('p1', undefined)).not.toThrow()
    expect(clearPluginMetrics).toHaveBeenCalledWith('p1')

    removeItem.mockRestore()
  })
})
