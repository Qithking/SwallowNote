/**
 * PluginInstalledCard i18n 测试
 *
 * 行为契约: 组件中所有用户可见文本都应通过 t() 获取，
 * 不存在硬编码中文字符串。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { PluginDefinition } from '@/types/plugin'

const tCalls: string[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      tCalls.push(key)
      return key
    },
  }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: (s: unknown) => unknown) => selector,
}))

const mockGetPluginHealth = vi.fn(() => 'unknown')

const mockPluginState = {
  setPluginAutoUpdate: vi.fn(),
  getPluginHealth: mockGetPluginHealth,
  pluginConflicts: {} as Record<string, unknown[]>,
}

vi.mock('@/stores', () => ({
  usePluginStore: Object.assign(
    (selector?: (s: typeof mockPluginState) => unknown) =>
      selector ? selector(mockPluginState) : mockPluginState,
    {
      getState: () => mockPluginState,
    },
  ),
  usePluginMarketStore: () => ({ repoSources: [] }),
}))

vi.mock('@/stores/plugin-market', () => ({
  OFFICIAL_REPO_URL: 'https://official.example.com/repo.json',
}))

function makePlugin(overrides: Partial<PluginDefinition> = {}): PluginDefinition {
  return {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: '',
    author: '',
    enabled: true,
    source: 'local',
    permissions: [],
    hasSettingsSchema: false,
    ...overrides,
  } as unknown as PluginDefinition
}

describe('PluginInstalledCard i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
    mockGetPluginHealth.mockReturnValue('unknown')
  })

  it('切换开关标签使用 i18n 键而非硬编码中文', async () => {
    const { PluginInstalledCard } = await import('@/components/Plugin/PluginInstalledCard')
    const { container } = render(
      <PluginInstalledCard plugin={makePlugin({ enabled: true })} index={1} />,
    )
    expect(tCalls).toContain('plugin.pa.card.switchOn')
    expect(container.textContent).not.toMatch(/启用|禁用/)
  })

  it('来源标签使用 i18n 键而非硬编码中文', async () => {
    const { PluginInstalledCard } = await import('@/components/Plugin/PluginInstalledCard')
    const { container } = render(
      <PluginInstalledCard plugin={makePlugin({ source: 'local' })} index={1} />,
    )
    expect(tCalls).toContain('plugin.pa.card.sourceLocal')
    expect(container.textContent).not.toMatch(/本地|未知来源|官网/)
  })

  it('更新提示使用 i18n 键而非硬编码中文', async () => {
    const { PluginInstalledCard } = await import('@/components/Plugin/PluginInstalledCard')
    render(
      <PluginInstalledCard
        plugin={makePlugin()}
        index={1}
        hasUpdate
        remoteVersion="2.0.0"
        onUpdate={() => {}}
      />,
    )
    expect(tCalls).toContain('plugin.pa.card.hasUpdate')
  })

  it('健康标签使用 i18n 键', async () => {
    mockGetPluginHealth.mockReturnValue('unhealthy')
    const { PluginInstalledCard } = await import('@/components/Plugin/PluginInstalledCard')
    render(
      <PluginInstalledCard plugin={makePlugin()} index={1} />,
    )
    expect(tCalls).toContain('plugin.pa.card.healthUnhealthy')
  })
})
