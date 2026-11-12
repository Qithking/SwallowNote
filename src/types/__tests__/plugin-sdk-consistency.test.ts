/**
 * B7 宿主↔SDK 类型一致性测试。
 *
 * 宿主 src/types/plugin.ts 对清单/权限/事件/上下文等类型改为 SDK 单源
 * re-export（防手工双写漂移）。本测试以类型级断言锁住该契约：
 * SDK 侧新增字段/权限时，宿主消费代码由 tsc 兜底；宿主侧若改回本地
 * 副本，此处立即红。
 */
import { describe, it, expectTypeOf } from 'vitest'
import type {
  PluginManifest,
  PluginPermission,
  PluginEvent,
  PluginContext,
  PluginEventHandler,
  InvokeBackendStreamOptions,
} from '@/types/plugin'
import { PLUGIN_PERMISSIONS } from '@/types/plugin'
import type {
  PluginManifest as SDKPluginManifest,
  PluginPermission as SDKPluginPermission,
  PluginEvent as SDKPluginEvent,
  PluginContext as SDKPluginContext,
  PluginEventHandler as SDKPluginEventHandler,
  InvokeBackendStreamOptions as SDKInvokeBackendStreamOptions,
} from '@swallow-note/plugin-sdk'

describe('宿主↔SDK 插件类型一致性（B7 单源）', () => {
  it('共享类型与 SDK 类型双向可赋值（防改回本地副本）', () => {
    expectTypeOf<PluginManifest>().toEqualTypeOf<SDKPluginManifest>()
    expectTypeOf<PluginPermission>().toEqualTypeOf<SDKPluginPermission>()
    expectTypeOf<PluginEvent>().toEqualTypeOf<SDKPluginEvent>()
    expectTypeOf<PluginContext>().toEqualTypeOf<SDKPluginContext>()
    expectTypeOf<PluginEventHandler>().toEqualTypeOf<SDKPluginEventHandler>()
    expectTypeOf<InvokeBackendStreamOptions>().toEqualTypeOf<SDKInvokeBackendStreamOptions>()
  })

  it('宿主 PLUGIN_PERMISSIONS 覆盖 SDK 全部权限（穷尽性检查）', () => {
    // SDK 权限联合中不允许存在宿主清单缺失的权限；
    // SDK 新增权限而宿主未同步时，MissingInHost 不再是 never，tsc/此断言报红。
    type HostPermissions = (typeof PLUGIN_PERMISSIONS)[number]['permission']
    type MissingInHost = Exclude<SDKPluginPermission, HostPermissions>
    expectTypeOf<MissingInHost>().toEqualTypeOf<never>()
  })

  it('invokeBackendStream options 含 onStart（B7 补齐宿主缺失字段）', () => {
    const opts = {} as InvokeBackendStreamOptions
    expectTypeOf(opts.onStart).toEqualTypeOf<((info: { requestId: number }) => void) | undefined>()
  })

  it('invokeBackend 为泛型签名（B1：调用处可省 as 断言）', () => {
    // 模拟插件侧调用：泛型参数生效则返回类型为 T，无需断言（noop 实现，运行时无害）。
    // 仅验证类型层签名，故绕开 PluginContext 其余必填字段的字面量检查。
    const ctx = { invokeBackend: () => Promise.resolve() } as unknown as PluginContext
    expectTypeOf(ctx.invokeBackend<{ value: number }>('cmd')).toEqualTypeOf<Promise<{ value: number }>>()
  })
})
