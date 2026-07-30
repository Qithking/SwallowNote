/**
 * plugin-loader.ts i18n 测试
 *
 * 行为契约: manifest 无效时的 failure.reason 应通过 i18n.t() 获取,
 * 不存在硬编码英文基础原因字符串。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tCalls: string[] = []
const tSpy = vi.fn((key: string) => {
  tCalls.push(key)
  return key
})

vi.mock('@/i18n', () => ({
  default: {
    t: tSpy,
    language: 'en',
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock tauri to make readFile throw (path doesn't exist)
vi.mock('@/lib/tauri', () => ({
  invoke: vi.fn(),
  readFile: vi.fn().mockRejectedValue(new Error('File not found')),
  getFileMetadata: vi.fn().mockRejectedValue(new Error('File not found')),
}))

describe('plugin-loader manifest invalid i18n', () => {
  beforeEach(() => {
    tCalls.length = 0
    tSpy.mockClear()
  })

  it('manifest 无效时的 failure reason 使用 i18n 键而非硬编码英文', async () => {
    const { loadAllPlugins } = await import('@/lib/plugin-loader')

    const rustMetas = [
      {
        id: 'com.broken.plugin',
        name: 'Broken Plugin',
        version: '1.0.0',
        description: '',
        author: 'test',
        source: 'local',
        plugin_path: '/nonexistent/path/to/plugin',
        has_backend: false,
        order: 0,
        enabled: true,
      },
    ]

    const result = await loadAllPlugins(rustMetas)
    const { failures } = result

    // 应该有失败项
    expect(failures.length).toBeGreaterThan(0)

    const reason = failures[0].reason
    // 不应包含硬编码英文
    expect(reason).not.toContain('did not export a valid `manifest` object')
    expect(reason).not.toContain('The plugin package may be incomplete or corrupted')

    // 应使用 i18n 键
    expect(tCalls.some(k => k.startsWith('pluginLoader.'))).toBe(true)
  })
})
