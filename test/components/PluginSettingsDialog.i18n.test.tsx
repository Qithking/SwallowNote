/**
 * PluginSettingsDialog i18n 测试
 *
 * 行为契约: select 字段的 placeholder 应通过 t() 获取,
 * 不存在硬编码中文 "请选择"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// 捕获 t() 调用的键
const tCalls: string[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      tCalls.push(key)
      return key
    },
  }),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock plugin-settings
vi.mock('@/lib/plugin-settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    schema: {
      type: 'object',
      fields: [
        {
          key: 'mode',
          type: 'select',
          label: 'Mode',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'slow', label: 'Slow' },
          ],
        },
      ],
    },
    values: {},
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  hasSettings: vi.fn().mockReturnValue(true),
  isFieldVisible: vi.fn().mockReturnValue(true),
}))

describe('PluginSettingsDialog i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('select 字段 placeholder 使用 i18n 键而非硬编码中文 "请选择"', async () => {
    const { PluginSettingsDialog } = await import('@/components/Plugin/PluginSettingsDialog')
    const { container } = render(
      <PluginSettingsDialog
        pluginId="com.test.plugin"
        pluginName="Test Plugin"
        open
        onOpenChange={() => {}}
      />,
    )

    // 等待异步加载 settings schema
    await waitFor(() => {
      expect(tCalls).toContain('plugin.pa.settings.selectPlaceholder')
    })

    // 验证不存在硬编码中文
    expect(container.textContent).not.toContain('请选择')
  })
})
