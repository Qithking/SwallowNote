/**
 * setPlugins 同 id 重载生命周期回归测试（dev-fix：fileTree 菜单不显示根因）。
 *
 * 根因：重装/更新插件（同 id、新 bundle → 新 __pluginModule 引用）时，
 * setPlugins 的 diff 只按 id 比较，旧实例既不在 removed 也不在 added，
 * 导致新 bundle 的 onLoad 从未执行——旧 bundle 注册的 editor 菜单残留
 * 显示，新 bundle 新增的 fileTree 菜单注册被跳过（0.1.2 症状）。
 *
 * 期望语义：
 * 1. 同 id + 新 module 引用 → 旧实例 onUnload（有限清理：保留权限、
 *    插件 storage、自动更新 opt-in）+ 新实例 onLoad；
 * 2. 同 id + 同 module 引用（未变化插件重扫，blob 复用）→ 幂等，不重跑。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePluginStore } from '../plugin'
import { clearAll } from '@/lib/plugin-permission-guard'
import { unregisterEditor } from '../pluginEditor'
import type { PluginDefinition } from '@/types/plugin'

/** 等待异步生命周期 hook 完成执行 */
async function waitForHook(fn: ReturnType<typeof vi.fn>, times = 1) {
  await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(times))
}

function makeDef(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'test.reload-plugin',
    name: 'test-reload-plugin',
    description: '',
    version: '0.1.1',
    author: '',
    publishedAt: '',
    order: 1,
    enabled: true,
    pluginPath: '/tmp/test-reload-plugin',
    hasBackend: false,
    permissions: ['context-menu'],
    source: '',
    ...overrides,
  }
}

/** 注入不可枚举 __pluginModule（模拟 loader 对 bundle 的注入方式） */
function withModule(def: PluginDefinition, mod: object): PluginDefinition {
  Object.defineProperty(def, '__pluginModule', {
    value: mod,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return def
}

describe('setPlugins 同 id 重载生命周期', () => {
  beforeEach(() => {
    clearAll()
    unregisterEditor('test.reload-plugin')
    const { plugins } = usePluginStore.getState()
    for (const p of plugins) {
      usePluginStore.getState().unregisterPlugin(p.id)
    }
  })

  it('同 id + 新 module：触发旧实例 onUnload 与新实例 onLoad', async () => {
    const onUnloadOld = vi.fn()
    const onLoadNew = vi.fn()
    const oldDef = withModule(
      makeDef({ version: '0.1.1', hooks: { onUnload: onUnloadOld } }),
      { mark: 'old' },
    )
    const newDef = withModule(
      makeDef({ version: '0.1.2', hooks: { onLoad: onLoadNew } }),
      { mark: 'new' },
    )

    usePluginStore.getState().registerPlugins([oldDef])
    expect(onUnloadOld).not.toHaveBeenCalled()

    // 模拟重装后的 handleReload：同 id、新 bundle（module 引用变化）
    usePluginStore.getState().setPlugins([newDef])

    await waitForHook(onUnloadOld, 1)
    await waitForHook(onLoadNew, 1)
    // store 中替换为新实例
    expect(usePluginStore.getState().plugins[0]?.version).toBe('0.1.2')
  })

  it('同 id + 同 module（插件未变化的重扫）：幂等，不重跑生命周期', async () => {
    const onLoad = vi.fn()
    // bundle 未变化时 blob URL 复用，动态 import 返回同一 module 对象 → 共享引用
    const sharedModule = { mark: 'same' }
    const def = withModule(makeDef({ hooks: { onLoad } }), sharedModule)

    usePluginStore.getState().registerPlugins([def])
    await waitForHook(onLoad, 1)

    // 重扫产生的新定义实例，但 bundle 未变化 → module 引用相同
    const rescan = withModule(makeDef({ hooks: { onLoad } }), sharedModule)
    usePluginStore.getState().setPlugins([rescan])

    // 给潜在的重跑留出异步窗口后断言仍只调用一次
    await new Promise((r) => setTimeout(r, 20))
    expect(onLoad).toHaveBeenCalledTimes(1)
  })
})
