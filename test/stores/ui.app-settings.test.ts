/**
 * 应用设置新增字段测试：日志上限 + 更新渠道
 * Source: spec/settings-log-export-update-channel AC-1/AC-3/AC-4/AC-7
 *
 * 行为契约:
 * - logMaxFileSize 默认 10（MB），档位值经 saveAppSettings 持久化为字符串
 * - updateChannel 默认 'github'，仅支持 'github' | 'ghproxy'
 * - loadSettings 读取持久化值，非法/缺失回退默认
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import i18n from '@/i18n'
import { useUIStore } from '@/stores/ui'
import { saveAppSettings, getAppSettings } from '@/lib/tauri'
import { emitSettingChanged } from '@/lib/plugin-host'

vi.mock('@/lib/tauri', () => ({
  getLatestFolder: vi.fn().mockResolvedValue(null),
  getAppSettings: vi.fn().mockResolvedValue({}),
  saveAppSettings: vi.fn().mockResolvedValue(undefined),
  setAutoStartEnabled: vi.fn().mockResolvedValue(undefined),
  isAutoStartEnabled: vi.fn().mockResolvedValue(false),
  encryptApiKey: vi.fn().mockResolvedValue(''),
  decryptApiKey: vi.fn().mockResolvedValue(''),
  restartAiProxy: vi.fn().mockResolvedValue(undefined),
  getBuiltinAiModels: vi.fn().mockResolvedValue([]),
  restartApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/plugin-host', () => ({
  emitSettingChanged: vi.fn(),
  emitThemeChanged: vi.fn(),
}))

describe('日志上限与更新渠道设置（store 持久化）', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('默认值：logMaxFileSize=10，updateChannel=github', () => {
    const state = useUIStore.getState()
    expect(state.logMaxFileSize).toBe(10)
    expect(state.updateChannel).toBe('github')
  })

  it('setLogMaxFileSize 更新状态并持久化为字符串', async () => {
    useUIStore.getState().setLogMaxFileSize(20)
    // emitSettingChanged 包在 queueMicrotask 中，flush 后再断言
    await Promise.resolve()

    expect(useUIStore.getState().logMaxFileSize).toBe(20)
    expect(vi.mocked(saveAppSettings)).toHaveBeenCalledWith({ logMaxFileSize: '20' })
    expect(vi.mocked(emitSettingChanged)).toHaveBeenCalledWith('logMaxFileSize', 20)
  })

  it('setUpdateChannel 切换 ghproxy 并持久化', async () => {
    useUIStore.getState().setUpdateChannel('ghproxy')
    await Promise.resolve()

    expect(useUIStore.getState().updateChannel).toBe('ghproxy')
    expect(vi.mocked(saveAppSettings)).toHaveBeenCalledWith({ updateChannel: 'ghproxy' })
    expect(vi.mocked(emitSettingChanged)).toHaveBeenCalledWith('updateChannel', 'ghproxy')
  })

  it('loadSettings 读取持久化值', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ logMaxFileSize: '50', updateChannel: 'ghproxy' })

    await useUIStore.getState().loadSettings()

    const state = useUIStore.getState()
    expect(state.logMaxFileSize).toBe(50)
    expect(state.updateChannel).toBe('ghproxy')
  })

  it('loadSettings 缺失字段回退默认值', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({})

    await useUIStore.getState().loadSettings()

    const state = useUIStore.getState()
    expect(state.logMaxFileSize).toBe(10)
    expect(state.updateChannel).toBe('github')
  })

  it('loadSettings 非法值回退默认值', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ logMaxFileSize: 'abc', updateChannel: 'mirror-x' })

    await useUIStore.getState().loadSettings()

    const state = useUIStore.getState()
    expect(state.logMaxFileSize).toBe(10)
    expect(state.updateChannel).toBe('github')
  })
})
