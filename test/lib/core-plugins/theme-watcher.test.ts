/**
 * C2：theme-watcher 初始主题快照水合回归测试。
 *
 * 背景：原实现读 `localStorage('appSettings')`，但宿主设置早已迁移到
 * Tauri session_state，该 key 全库无写入 → 初始快照恒为 (unknown)。
 * 修复：水合值改为读宿主真实状态源（UI store 的 theme + i18n 当前语言）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { uiState, i18nState } = vi.hoisted(() => ({
  uiState: { theme: 'dark' as string },
  i18nState: { language: 'zh-CN' as string },
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: { getState: () => uiState },
}))

vi.mock('@/i18n', () => ({
  default: i18nState,
}))

vi.mock('@/lib/plugin-host', () => ({
  pluginEventBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
  getPluginStorage: vi.fn(),
}))

vi.mock('@/lib/plugin-hooks', () => ({
  usePluginStorage: vi.fn(() => [false, vi.fn()]),
  usePluginEvents: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readHostThemeLocale } from '@/lib/core-plugins/theme-watcher'

describe('C2: theme-watcher 初始快照从宿主真实状态源水合', () => {
  beforeEach(() => {
    uiState.theme = 'dark'
    i18nState.language = 'zh-CN'
  })

  it('返回 UI store 的 theme 与 i18n 的当前语言', () => {
    expect(readHostThemeLocale()).toEqual({ theme: 'dark', locale: 'zh-CN' })
  })

  it('是动态读取：宿主状态变化后再次调用反映新值', () => {
    uiState.theme = 'light'
    i18nState.language = 'en'
    expect(readHostThemeLocale()).toEqual({ theme: 'light', locale: 'en' })
  })
})
