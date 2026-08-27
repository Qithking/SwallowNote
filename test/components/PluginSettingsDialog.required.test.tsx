/**
 * PluginSettingsDialog 必填字段验证 i18n 测试
 *
 * 行为契约: 必填字段为空时的验证错误应通过 t() 获取,
 * 不存在硬编码中文 "此字段为必填"。
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
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/plugin-settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    schema: {
      type: 'object',
      fields: [
        {
          key: 'apiKey',
          type: 'string',
          label: 'API Key',
          required: true,
        },
      ],
    },
    values: {},
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  hasSettings: vi.fn().mockReturnValue(true),
  isFieldVisible: vi.fn().mockReturnValue(true),
}))

describe('PluginSettingsDialog required field validation i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('必填字段验证错误使用 i18n 键而非硬编码中文', async () => {
    const { PluginSettingsDialog } = await import('@/components/Plugin/PluginSettingsDialog')
    const { container } = render(
      <PluginSettingsDialog
        pluginId="com.test.plugin"
        pluginName="Test Plugin"
        open
        onOpenChange={() => {}}
      />,
    )

    // 等待加载 schema
    await waitFor(() => {
      expect(tCalls).toContain('plugin.pa.settings.requiredField')
    })

    // 验证不存在硬编码中文
    expect(container.textContent).not.toContain('此字段为必填')
  })
})
