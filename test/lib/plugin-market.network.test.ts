/**
 * E-M9: plugin-market.ts 缓存/URL 辅助函数失败时不应静默吞错
 *
 * 行为契约: readZipFromCache / writeZipToCache / resolveDownloadUrl
 * 的 catch 块在失败时必须记日志（logger.warn），不能完全静默，
 * 否则网络/缓存错误对用户不可见，表现为"无插件"而非"出错"。
 *
 * 注: 这些 catch 是缓存/URL 降级路径（失败后回退到网络或原值），
 * 保留 return null / 回退值的行为不变，仅补充日志可见性。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadPluginZip } from '@/lib/plugin-market'
import type { PluginIndexEntry } from '@/types/plugin'

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}))

describe('E-M9: plugin-market cache failure must be logged (not silent)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs warn when download URL parse fails instead of silently swallowing', async () => {
    // 用无效的 base URL 触发 resolveDownloadUrl 的 catch 块
    // （new URL('not-a-valid-url', 'also-invalid') 会抛 TypeError）
    const entry = {
      id: 'com.test.plugin',
      version: '1.0.0',
      downloadUrl: 'not-a-valid-url',
      sha256: 'abc123',
    } as PluginIndexEntry

    // downloadPluginZip 先读缓存（jsdom 无 indexedDB → 返回 null），
    // 再调 resolveDownloadUrl（URL 解析失败 → catch），
    // 随后 fetch('not-a-valid-url') 也会失败 → reject
    await expect(
      downloadPluginZip(entry, 'also-invalid'),
    ).rejects.toThrow()

    // URL 解析失败时必须记日志（当前代码静默吞掉 → RED）
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'plugin-market',
      expect.any(String),
      expect.anything(),
    )
  })
})
