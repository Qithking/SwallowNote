/**
 * BUILT_IN_THEMES 主题名动态化测试
 * Source: plan/i18n-audit P1
 *
 * 行为契约: 当用户切换语言时，内置主题名应随当前语言更新，
 * 而非冻结在模块加载时的语言。用户自定义主题名保持不变。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import i18n from '@/i18n'
import { useUIStore, BUILT_IN_THEMES, type CustomTheme } from '@/stores/ui'

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

describe('BUILT_IN_THEMES 主题名动态化', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useUIStore.setState({ customThemes: [...BUILT_IN_THEMES] })
  })

  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('切换到英文后内置主题名更新为英文', async () => {
    const zhName = useUIStore.getState().customThemes.find((t) => t.id === 'builtin-light')?.name
    expect(zhName).toBe('浅色主题')

    await i18n.changeLanguage('en')

    const enName = useUIStore.getState().customThemes.find((t) => t.id === 'builtin-light')?.name
    expect(enName).toBe('Light Theme')
  })

  it('切换语言后保留用户自定义主题名', async () => {
    const userTheme: CustomTheme = {
      id: 'custom-test',
      name: '我的主题',
      isBuiltIn: false,
      themeType: 'light',
      light: { ...BUILT_IN_THEMES[0].light },
      dark: { ...BUILT_IN_THEMES[0].dark },
    }
    useUIStore.setState({
      customThemes: [...BUILT_IN_THEMES, userTheme],
    })

    await i18n.changeLanguage('en')

    const stored = useUIStore.getState().customThemes.find((t) => t.id === 'custom-test')
    expect(stored?.name).toBe('我的主题')
  })

  it('每个内置主题都有 nameKey 且能通过 i18n.t 解析为非空字符串', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.nameKey, `主题 ${theme.id} 缺少 nameKey`).toBeDefined()
      const resolved = i18n.t(theme.nameKey!)
      expect(resolved, `主题 ${theme.id} 的 nameKey "${theme.nameKey}" 解析为空`).not.toBe(theme.nameKey!)
      expect(resolved.length).toBeGreaterThan(0)
    }
  })

  it('切换到英文后所有内置主题名都更新为英文', async () => {
    await i18n.changeLanguage('en')

    for (const theme of BUILT_IN_THEMES) {
      const stored = useUIStore.getState().customThemes.find((t) => t.id === theme.id)
      const expected = i18n.t(theme.nameKey!)
      expect(stored?.name, `主题 ${theme.id} 名称未更新`).toBe(expected)
    }
  })
})
