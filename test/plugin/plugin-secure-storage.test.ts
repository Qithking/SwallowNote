/**
 * P1.5 secure-storage tests — host takeover overrides + SDK module API.
 *
 * Follows the plugin-host-takeover permission-gate precedent (TC-09.6-*):
 * makePlugin/makeModule factories, runPluginLifecycleHook installs the
 * per-plugin overrides, `mod.setHost.mock.calls.at(-1)` recovers them
 * for direct invocation, `setGranted`/`clearAll` control the grant.
 *
 * The `@tauri-apps/api/core` invoke is mocked globally in test/setup.ts;
 * these tests only assert on its call arguments / return values, so the
 * full chain (override → tauri bridge → invoke command) is exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getSecure,
  setSecure,
  deleteSecure,
  listSecureKeys,
  dropPluginSettings,
  setHost as sdkSetHost,
  clearHost as sdkClearHost,
} from '@swallow-note/plugin-sdk'
import type { HostOverrides } from '@swallow-note/plugin-sdk'
import {
  PluginPermissionDeniedError,
  setGranted as setGrantedSync,
  clearGranted,
  clearAll,
} from '@/lib/plugin-permission-guard'
import { runPluginLifecycleHook } from '@/lib/plugin-host-takeover'
import type { PluginContext, PluginDefinition } from '@/types/plugin'

// ─── shared factories（与 plugin-host-takeover.test.ts 保持一致） ─────────────

function makePlugin(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'com.test.sample',
    name: 'Sample',
    description: '',
    version: '0.0.0',
    author: '',
    publishedAt: '2026-01-01',
    iconPosition: 'sidebar',
    contentPosition: 'leftPanel',
    order: 100,
    enabled: true,
    icon: () => null,
    panel: () => null,
    pluginPath: '/tmp/sample',
    hasBackend: false,
    permissions: [],
    ...overrides,
  } as PluginDefinition
}

function makeModule(overrides: Record<string, unknown> = {}): {
  setHost: ReturnType<typeof vi.fn>
} & Record<string, unknown> {
  return {
    // 必须透传第二参 pluginId：宿主经 mod.setHost(overrides, plugin.id)
    // 绑定隐式解析层，SDK 模块级 API（getSecure 等）依赖它解析当前插件
    setHost: vi.fn((o, pid) => sdkSetHost(o, pid)),
    ...overrides,
  }
}

const ctx: PluginContext = {
  pluginId: 'com.test.sample',
  pluginPath: '/tmp/sample',
  invokeBackend: async () => null,
}

/**
 * Run a lifecycle hook with the takeover installed, silencing the
 * hook-error console noise (vitest's jsdom wrapper obscures vi.spyOn).
 * Returns the overrides object the host installed, for direct calls.
 */
async function runHookWithOverrides(
  plugin: PluginDefinition,
  hook: (c: PluginContext) => void | Promise<void>
): Promise<HostOverrides> {
  const mod = makeModule()
  const originalError = console.error
  console.error = () => {}
  try {
    await runPluginLifecycleHook(
      { ...plugin, __pluginModule: mod } as PluginDefinition,
      hook,
      ctx,
      'onLoad'
    )
  } finally {
    console.error = originalError
  }
  return mod.setHost.mock.calls.at(-1)![0] as HostOverrides
}

/** Hook body that captures the rejection of an awaited async SDK call. */
function captureRejection(call: () => Promise<unknown>): {
  hook: (c: PluginContext) => Promise<void>
  error: () => unknown
} {
  let captured: unknown
  const hook = async () => {
    try {
      await call()
    } catch (e) {
      captured = e
      throw e
    }
  }
  return { hook, error: () => captured }
}

// ─── 1. host takeover overrides：权限门控 + IPC 转发 ─────────────────────────

describe('P1.5: secure-storage host takeover overrides', () => {
  const PID = 'com.test.secure-a'

  beforeEach(() => {
    sdkClearHost()
    clearAll()
    // mockReset 同时清 calls 与 Once 队列，避免用例间残留排队返回值
    vi.mocked(invoke).mockReset()
  })
  afterEach(() => {
    sdkClearHost()
    clearAll()
  })

  it('denies get/set/delete/keys without the secure-storage grant', async () => {
    const plugin = makePlugin({ id: PID, permissions: [] })

    // get：无授权 → assertPermission 先于 IPC 抛错
    let c = captureRejection(() => getSecure('apiKey'))
    await runHookWithOverrides(plugin, c.hook)
    expect(c.error()).toBeInstanceOf(PluginPermissionDeniedError)
    expect((c.error() as PluginPermissionDeniedError).permission).toBe('secure-storage')
    expect((c.error() as PluginPermissionDeniedError).pluginId).toBe(PID)
    expect((c.error() as PluginPermissionDeniedError).operation).toContain('read secure storage key')

    // set
    c = captureRejection(() => setSecure('apiKey', 'v'))
    await runHookWithOverrides(plugin, c.hook)
    expect((c.error() as PluginPermissionDeniedError).operation).toContain('write secure storage key')

    // delete
    c = captureRejection(() => deleteSecure('apiKey'))
    await runHookWithOverrides(plugin, c.hook)
    expect((c.error() as PluginPermissionDeniedError).operation).toContain('delete secure storage key')

    // keys
    c = captureRejection(() => listSecureKeys())
    await runHookWithOverrides(plugin, c.hook)
    expect((c.error() as PluginPermissionDeniedError).operation).toContain('list secure storage keys')

    // 全部在权限检查处被拦下，没有触达 IPC
    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
  })

  it('forwards to the tauri bridge with the bound pluginId after grant', async () => {
    // 同步热路径授权（先例：async localStorage 辅助函数会与 hook 的同步检查竞态）
    setGrantedSync(PID, ['secure-storage'])
    const plugin = makePlugin({ id: PID, permissions: ['secure-storage'] })

    vi.mocked(invoke).mockResolvedValueOnce(undefined) // set
    vi.mocked(invoke).mockResolvedValueOnce('enc-value') // get
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // delete
    vi.mocked(invoke).mockResolvedValueOnce(['b', 'a']) // keys

    await runHookWithOverrides(plugin, async () => {
      await setSecure('apiKey', 'plain')
      await expect(getSecure('apiKey')).resolves.toBe('enc-value')
      await deleteSecure('apiKey')
      // 桥接层只透传；排序由 Rust repo 层 / SDK stub 保证
      await expect(listSecureKeys()).resolves.toEqual(['b', 'a'])
    })

    // 四条 IPC 都带上了正确的命令名与参数（密文语义：明文只走内存/IPC）
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['secure_storage_set', { pluginId: PID, key: 'apiKey', value: 'plain' }],
      ['secure_storage_get', { pluginId: PID, key: 'apiKey' }],
      ['secure_storage_delete', { pluginId: PID, key: 'apiKey' }],
      ['secure_storage_keys', { pluginId: PID }],
    ])
  })

  it('installed overrides can be invoked directly after the hook (explicit pluginId)', async () => {
    setGrantedSync(PID, ['secure-storage'])
    const overrides = await runHookWithOverrides(
      makePlugin({ id: PID, permissions: ['secure-storage'] }),
      () => {}
    )

    vi.mocked(invoke).mockResolvedValueOnce('direct-value')
    await expect(overrides.__pluginSecureStorage_get!(PID, 'k')).resolves.toBe('direct-value')
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['secure_storage_get', { pluginId: PID, key: 'k' }],
    ])

    // 直调同样受权限门控约束
    clearGranted(PID)
    await expect(overrides.__pluginSecureStorage_get!(PID, 'k')).rejects.toBeInstanceOf(
      PluginPermissionDeniedError
    )
  })
})

// ─── 2. SDK 模块级 API：隐式绑定 + standalone stub ───────────────────────────

describe('P1.5: SDK module-level secure API (implicit binding + stub)', () => {
  afterEach(() => {
    sdkClearHost()
    // 清理 standalone stub 的内存残留，避免泄漏到相邻用例
    dropPluginSettings('com.test.sdk-a')
    dropPluginSettings('com.test.sdk-b')
  })

  it('resolves the pluginId implicitly and forwards to the installed override', async () => {
    const setOverride = vi.fn(async () => {})
    const getOverride = vi.fn(async () => 'from-override')
    const delOverride = vi.fn(async () => {})
    const keysOverride = vi.fn(async () => ['x'])

    sdkSetHost(
      {
        __pluginSecureStorage_set: setOverride,
        __pluginSecureStorage_get: getOverride,
        __pluginSecureStorage_delete: delOverride,
        __pluginSecureStorage_keys: keysOverride,
      },
      'com.test.sdk-a'
    )

    // 调用方不传 pluginId：SDK 从 override 层隐式解析
    await setSecure('k', 'v')
    await expect(getSecure('k')).resolves.toBe('from-override')
    await deleteSecure('k')
    await expect(listSecureKeys()).resolves.toEqual(['x'])

    expect(setOverride).toHaveBeenCalledWith('com.test.sdk-a', 'k', 'v')
    expect(getOverride).toHaveBeenCalledWith('com.test.sdk-a', 'k')
    expect(delOverride).toHaveBeenCalledWith('com.test.sdk-a', 'k')
    expect(keysOverride).toHaveBeenCalledWith('com.test.sdk-a')
  })

  it('rejects when no pluginId is resolvable (no silent cross-plugin access)', async () => {
    sdkClearHost()
    await expect(getSecure('k')).rejects.toThrow(/没有可解析的 pluginId/)
    await expect(setSecure('k', 'v')).rejects.toThrow(/没有可解析的 pluginId/)
    await expect(deleteSecure('k')).rejects.toThrow(/没有可解析的 pluginId/)
    await expect(listSecureKeys()).rejects.toThrow(/没有可解析的 pluginId/)
  })

  it('standalone stub round-trips in-memory, isolated per plugin', async () => {
    // 外层带 pluginId 绑定但不含 secure override → SDK 回落 standalone stub
    const restoreA = sdkSetHost({ emit: () => {} }, 'com.test.sdk-a')
    await setSecure('b', '2')
    await setSecure('a', '1')
    await expect(getSecure('a')).resolves.toBe('1')
    await expect(getSecure('missing')).resolves.toBeNull()

    // 内层插件看不到外层插件的数据（stub 按 pluginId 分 map）
    const restoreB = sdkSetHost({ emit: () => {} }, 'com.test.sdk-b')
    await expect(getSecure('a')).resolves.toBeNull()
    await setSecure('z', '9')
    await expect(listSecureKeys()).resolves.toEqual(['z'])
    restoreB()

    // 回到 A 的视角：keys 按字典序
    await expect(listSecureKeys()).resolves.toEqual(['a', 'b'])
    restoreA()
  })

  it('deleteSecure is idempotent; dropPluginSettings clears the stub', async () => {
    const restore = sdkSetHost({ emit: () => {} }, 'com.test.sdk-a')
    await setSecure('k', 'v')
    await deleteSecure('k')
    await deleteSecure('k') // 幂等
    await expect(getSecure('k')).resolves.toBeNull()

    // dropPluginSettings 统一清理 settings 缓存 + secureStorage stub
    await setSecure('k', 'v2')
    dropPluginSettings('com.test.sdk-a')
    await expect(getSecure('k')).resolves.toBeNull()
    restore()
  })
})
