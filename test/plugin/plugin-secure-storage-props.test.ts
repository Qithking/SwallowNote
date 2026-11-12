/**
 * P1.5 secure-storage tests — Props 注入通道。
 *
 * createPluginPanelProps / createToolbarButtonProps 通过闭包 pluginId
 * 显式注入 secureStorage 四方法（面板/工具栏场景不走 SDK 隐式解析）。
 * 本文件单独拆出：`@/stores` 的 mock 会影响整条依赖树，与 takeover
 * 测试文件（走真实桥接 + 全局 invoke mock）互不干扰。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createPluginPanelProps, createToolbarButtonProps } from '@/lib/plugin-utils'
import {
  PluginPermissionDeniedError,
  setGranted as setGrantedSync,
  clearAll,
} from '@/lib/plugin-permission-guard'

// 仅 mock 构造期会立即触达的 UIStore（pendingPluginRequest 读取），
// 其余依赖（plugin-host/settings/write-api/stream）为惰性闭包，真实加载无副作用。
vi.mock('@/stores', () => ({
  useUIStore: { getState: vi.fn(() => ({ pendingPluginRequest: null })) },
  usePluginStore: { getState: vi.fn(() => ({})) },
}))

describe('P1.5: secureStorage Props injection', () => {
  const PID = 'com.test.props-a'
  const close = vi.fn()

  beforeEach(() => {
    clearAll()
    vi.mocked(invoke).mockClear()
  })
  afterEach(() => {
    clearAll()
  })

  it('panel props expose the four secureStorage methods', () => {
    const props = createPluginPanelProps(PID, true, close)
    expect(typeof props.secureStorage.get).toBe('function')
    expect(typeof props.secureStorage.set).toBe('function')
    expect(typeof props.secureStorage.delete).toBe('function')
    expect(typeof props.secureStorage.keys).toBe('function')
  })

  it('denies secure storage without the grant (before touching IPC)', async () => {
    const props = createPluginPanelProps(PID, true, close)
    // get/delete/keys 是同步包装：assertPermission 同步抛出
    expect(() => props.secureStorage.get('k')).toThrow(PluginPermissionDeniedError)
    expect(() => props.secureStorage.delete('k')).toThrow(PluginPermissionDeniedError)
    expect(() => props.secureStorage.keys()).toThrow(PluginPermissionDeniedError)
    // set 是 async：拒绝以 rejected promise 形式出现
    await expect(props.secureStorage.set('k', 'v')).rejects.toMatchObject({
      pluginId: PID,
      permission: 'secure-storage',
    })
    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
  })

  it('forwards to the tauri bridge with the closure pluginId after grant', async () => {
    setGrantedSync(PID, ['secure-storage'])
    const props = createPluginPanelProps(PID, true, close)

    vi.mocked(invoke).mockResolvedValueOnce(undefined) // set
    vi.mocked(invoke).mockResolvedValueOnce('enc') // get
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // delete
    vi.mocked(invoke).mockResolvedValueOnce(['b', 'a']) // keys

    await props.secureStorage.set('apiKey', 'plain')
    await expect(props.secureStorage.get('apiKey')).resolves.toBe('enc')
    await props.secureStorage.delete('apiKey')
    await expect(props.secureStorage.keys()).resolves.toEqual(['b', 'a'])

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['secure_storage_set', { pluginId: PID, key: 'apiKey', value: 'plain' }],
      ['secure_storage_get', { pluginId: PID, key: 'apiKey' }],
      ['secure_storage_delete', { pluginId: PID, key: 'apiKey' }],
      ['secure_storage_keys', { pluginId: PID }],
    ])
  })

  it('toolbar props get the same secureStorage channel', async () => {
    setGrantedSync(PID, ['secure-storage'])
    const props = createToolbarButtonProps(PID, true, 16, vi.fn(), vi.fn())
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await props.secureStorage.delete('k')
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['secure_storage_delete', { pluginId: PID, key: 'k' }],
    ])
  })
})
