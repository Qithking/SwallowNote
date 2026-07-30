/**
 * PluginMarketView 搜索框 aria-label i18n 测试
 *
 * 行为契约: 搜索框的 aria-label 应通过 t() 获取,
 * 不存在硬编码英文 "Search marketplace"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const tCalls: string[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      tCalls.push(key)
      return key
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/plugin-market', () => ({
  usePluginMarketStore: () => ({
    index: null,
    isFetching: false,
    repoSources: [],
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
  OFFICIAL_REPO_URL: 'https://official.example.com/repo.json',
}))

describe('PluginMarketView search aria-label i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('搜索框 aria-label 使用 i18n 键而非硬编码英文 "Search marketplace"', async () => {
    const { PluginMarketView } = await import('@/components/Plugin/PluginMarketView')
    const { container } = render(<PluginMarketView />)

    await waitFor(() => {
      expect(tCalls).toContain('plugin.market.searchAriaLabel')
    })

    // 验证不存在硬编码英文
    const searchInput = container.querySelector('input[aria-label]')
    expect(searchInput?.getAttribute('aria-label')).not.toBe('Search marketplace')
  })
})
