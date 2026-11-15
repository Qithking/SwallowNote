/**
 * I5 回归测试：界面语言持久化与启动恢复。
 *
 * 此前 changeLanguage 只改运行时，settings 面板 / Ctrl+Shift+L 的语言选择
 * 重启即丢失（i18n init 硬编码 zh-CN，loadSettings 无恢复逻辑）。
 * 行为契约:
 * - changeAppLocale 切换 i18n 实例语言 + 通知 Rust 端（setAppLocale）
 *   + 派发插件 locale 事件 + 持久化 settings.appLocale
 * - loadSettings 读取 settings.appLocale 恢复语言；空值/非法值保持默认 zh-CN
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import i18n from '@/i18n'
import { useUIStore } from '@/stores/ui'
import { saveAppSettings, getAppSettings, setAppLocale } from '@/lib/tauri'
import { emitLocaleChanged } from '@/lib/plugin-host'

vi.mock('@/lib/tauri', () => ({
  getLatestFolder: vi.fn().mockResolvedValue(null),
  getAppSettings: vi.fn().mockResolvedValue({}),
  saveAppSettings: vi.fn().mockResolvedValue(undefined),
  setAppLocale: vi.fn().mockResolvedValue(undefined),
  setAutoStartEnabled: vi.fn().mockResolvedValue(undefined),
  isAutoStartEnabled: vi.fn().mockResolvedValue(false),
  restartApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/plugin-host', () => ({
  emitSettingChanged: vi.fn(),
  emitThemeChanged: vi.fn(),
  emitLocaleChanged: vi.fn(),
}))

describe('界面语言持久化（I5）', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('changeAppLocale 切换语言并持久化 + 通知后端 + 派发插件事件', async () => {
    useUIStore.getState().changeAppLocale('en')
    await Promise.resolve()

    expect(i18n.language).toBe('en')
    expect(vi.mocked(saveAppSettings)).toHaveBeenCalledWith({ appLocale: 'en' })
    expect(vi.mocked(setAppLocale)).toHaveBeenCalledWith('en')
    // emitLocaleChanged 包在 queueMicrotask 中，flush 后断言
    expect(vi.mocked(emitLocaleChanged)).toHaveBeenCalledWith('en')
  })

  it('loadSettings 恢复持久化语言为 en', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ appLocale: 'en' })

    await useUIStore.getState().loadSettings()

    expect(i18n.language).toBe('en')
  })

  it('loadSettings 空值保持默认 zh-CN', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({})

    await useUIStore.getState().loadSettings()

    expect(i18n.language).toBe('zh-CN')
  })

  it('loadSettings 非法值不切换语言', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({ appLocale: 'fr' })

    await useUIStore.getState().loadSettings()

    expect(i18n.language).toBe('zh-CN')
  })
})
