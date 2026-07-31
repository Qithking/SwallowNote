/**
 * Close 按钮 i18n 测试
 *
 * 行为契约:
 * - DialogContent 的 sr-only 关闭文本应使用 t('common.close')
 * - PluginLoadFailuresDialog 的关闭按钮 aria-label 应使用 t('common.close')
 * 不存在硬编码英文 "Close"。
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
  getPluginStorageEntries: vi.fn().mockResolvedValue([]),
  deletePluginStorageEntry: vi.fn().mockResolvedValue(undefined),
  clearPluginStorage: vi.fn().mockResolvedValue(undefined),
}))

describe('DialogContent close button i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('sr-only 关闭文本使用 t("common.close") 而非硬编码英文', async () => {
    const { Dialog, DialogContent, DialogTrigger } = await import('@/components/ui/dialog')

    const { container } = render(
      <Dialog open>
        <DialogTrigger asChild>
          <button>Open</button>
        </DialogTrigger>
        <DialogContent>
          <span>content</span>
        </DialogContent>
      </Dialog>,
    )

    await waitFor(() => {
      expect(tCalls).toContain('common.close')
    })

    // 验证不存在硬编码英文 "Close"
    const srOnly = container.querySelector('.sr-only')
    expect(srOnly?.textContent).not.toBe('Close')
  })
})

describe('PluginLoadFailuresDialog close button i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('关闭按钮 aria-label 使用 t("common.close") 而非硬编码英文', async () => {
    const { PluginLoadFailuresDialog } = await import('@/components/Plugin/PluginLoadFailuresDialog')

    const failures = [
      {
        id: 'com.test.plugin',
        name: 'Test Plugin',
        error: 'Test error',
      },
    ]

    const { container } = render(
      <PluginLoadFailuresDialog
        failures={failures}
        open
        onOpenChange={() => {}}
      />,
    )

    await waitFor(() => {
      expect(tCalls).toContain('common.close')
    })

    // 验证不存在硬编码英文
    const closeBtn = container.querySelector('.pa-popup-close')
    expect(closeBtn?.getAttribute('aria-label')).not.toBe('Close')
  })
})
