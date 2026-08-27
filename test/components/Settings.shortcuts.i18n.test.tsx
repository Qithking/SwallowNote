/**
 * Settings 快捷键 i18n 键路径测试
 *
 * 行为契约: 快捷键设置页应使用顶层 'shortcuts.*' 键,
 * 而非错误的 'settings.shortcuts.*' 键。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 加载 locale 中的真实键集 - 使用 i18next 的路径解析
import en from '@/i18n/locales/en.json'

// 收集所有嵌套键（展平）
function collectKeys(obj: any, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      collectKeys(obj[k], fullKey).forEach(v => keys.add(v))
    } else {
      keys.add(fullKey)
    }
  }
  return keys
}

const validShortcutsKeys = collectKeys(en.shortcuts, 'shortcuts')

const tCalls: string[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      tCalls.push(key)
      return key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// 模拟 useShallow - 直接返回传入的 selector 结果
vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector,
}))

// Mock stores
const mockStore = {
  customShortcuts: {},
  pluginCommandShortcuts: {},
  setShortcut: vi.fn(),
  resetShortcut: vi.fn(),
  resetAllShortcuts: vi.fn(),
  resetAllPluginCommandShortcuts: vi.fn(),
  customThemes: [],
  customThemeTab: 'all',
  settingsSection: 'shortcuts',
  setSettingsSection: vi.fn(),
  theme: 'light',
  noteWidth: 'normal',
  language: 'en',
  setLanguage: vi.fn(),
  aiModels: [],
  activeModelId: '',
  pluginCommands: [],
}

vi.mock('@/stores', () => ({
  useUIStore: Object.assign(
    (selector?: (s: any) => any) => selector ? selector(mockStore) : mockStore,
    mockStore,
  ),
  usePluginStore: () => ({
    pluginCommands: {},
  }),
}))

vi.mock('@/lib/plugin-hooks', () => ({
  usePluginCommands: () => [],
}))

describe('Settings shortcuts i18n keys', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('使用正确的 shortcuts.* 键而非 settings.shortcuts.*', async () => {
    const { SettingsView } = await import('@/components/Settings/SettingsView')
    const { render } = await import('@testing-library/react')

    render(<SettingsView />)

    // 验证没有使用错误的 settings.shortcuts.* 键（除了 settings.shortcuts 本身作为菜单标签）
    const wrongKeys = tCalls.filter(k =>
      k.startsWith('settings.shortcuts.') && k !== 'settings.shortcuts'
    )
    expect(wrongKeys, `发现错误的 i18n 键: ${wrongKeys.join(', ')}`).toEqual([])

    // 验证使用了正确的 shortcuts.* 键
    const usedShortcutsKeys = tCalls.filter(k => k.startsWith('shortcuts.'))
    expect(usedShortcutsKeys.length).toBeGreaterThan(0)

    // 验证所有使用的 shortcuts 键在 locale 中存在
    for (const key of usedShortcutsKeys) {
      const baseKey = key.replace(/\.desc$/, '')
      const exists = validShortcutsKeys.has(key) || validShortcutsKeys.has(baseKey)
      expect(exists, `i18n 键 "${key}" 应在 locale 中存在`).toBe(true)
    }
  })
})
