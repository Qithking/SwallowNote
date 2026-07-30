/**
 * PluginStorageInspector i18n 测试
 *
 * 行为契约: 表格的 aria-label 和 sr-only 文本应通过 t() 获取,
 * 不存在硬编码英文 "Storage entries" 或 "Actions"。
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
  Trans: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/plugin-host', () => ({
  getPluginStorageEntries: vi.fn().mockResolvedValue([
    { key: 'theme', size: 12 },
    { key: 'language', size: 15 },
  ]),
  deletePluginStorageEntry: vi.fn().mockResolvedValue(undefined),
  clearPluginStorage: vi.fn().mockResolvedValue(undefined),
}))

import type { PluginDefinition } from '@/types/plugin'

function makePlugin(): PluginDefinition {
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
  } as unknown as PluginDefinition
}

describe('PluginStorageInspector i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('表格 aria-label 和 sr-only 文本使用 i18n 键而非硬编码英文', async () => {
    const { PluginStorageInspector } = await import('@/components/Plugin/PluginStorageInspector')
    const { container } = render(
      <PluginStorageInspector
        plugin={makePlugin()}
        open
        onOpenChange={() => {}}
      />,
    )

    await waitFor(() => {
      expect(tCalls).toContain('plugin.pa.dialog.storageInspector.tableAriaLabel')
      expect(tCalls).toContain('plugin.pa.dialog.storageInspector.colAction')
    })

    // 验证不存在硬编码英文
    const table = container.querySelector('[role="table"]')
    expect(table?.getAttribute('aria-label')).not.toBe('Storage entries')
    expect(container.querySelector('.sr-only')?.textContent).not.toBe('Actions')
  })
})
