/**
 * 错误路径日志接入的集成测试。
 *
 * 验证「错误被捕获后必须接入 logger」的约定：对代表性模块
 * （searchQuery / plugin-permissions / upgrade）的失败路径，
 * 断言 logger.warn / logger.error 被调用且携带可定位的上下文。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import {
  getFileFrontmatter,
  queryFrontmatterByPrefix,
} from '@/lib/utils/searchQuery'
import {
  getPluginPermissions,
  getPermissionAuditLogs,
} from '@/lib/plugin-permissions'
import { downloadLatestRelease } from '@/lib/tauri/upgrade'
import type { FrontmatterRecord } from '@/lib/utils/searchQuery'

// getFileFrontmatter 回退路径动态 import 的 readFile，改为可控 mock
vi.mock('@/lib/tauri', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('read failed')),
}))

function makeRecord(overrides: Partial<FrontmatterRecord> = {}): FrontmatterRecord {
  return {
    id: 1,
    file_path: '/notes/a.md',
    title: null,
    created: null,
    updated: null,
    tags: null,
    categories: null,
    author: null,
    status: null,
    pinned: false,
    extra_yaml: null,
    raw_yaml: null,
    modified_at: '2026-01-01',
    indexed_at: '2026-01-01',
    ...overrides,
  }
}

describe('searchQuery 日志接入', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  it('后端查询失败且文件回退也失败时，两条 warn 均落日志并返回空对象', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('db closed'))
    const result = await getFileFrontmatter('/notes/a.md')

    expect(result).toEqual({})
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('后端查询失败')
    expect(String(warnSpy.mock.calls[1]?.[1])).toContain('回退解析也失败')
    // 上下文含文件路径，便于定位是哪个文件元数据缺失
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('/notes/a.md')
  })

  it('record 字段 JSON 损坏时 warn 留痕且不影响其余字段', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      makeRecord({ tags: 'not-json', author: 'someone' }),
    )
    const result = await getFileFrontmatter('/notes/a.md')

    expect(result.author).toBe('someone')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('tags 字段 JSON 损坏')
    // 损坏字段的日志需携带文件路径
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('/notes/a.md')
  })

  it('按前缀查询失败时 warn 并返回空数组（用户会误以为无匹配）', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('query failed'))
    const result = await queryFrontmatterByPrefix('/notes')

    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('按前缀查询 frontmatter 失败')
    expect(String(warnSpy.mock.calls[0]?.[1])).toContain('/notes')
  })
})

describe('plugin-permissions 日志接入', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  it('权限状态读取失败时 warn 并回退为未授权（空数组）', async () => {
    // jsdom 的 window.localStorage 每次访问可能返回新实例，spyOn 实例不可靠；
    // 在原型上 spy 才能影响模块内的 getItem 调用
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const result = await getPluginPermissions('evil-plugin')

    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(logger.warn).mock.calls[0]?.[1])).toContain('读取插件权限状态失败')
    expect(String(vi.mocked(logger.warn).mock.calls[0]?.[1])).toContain('evil-plugin')
  })

  it('审计日志读取失败时 warn 并返回空数组', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage broken')
    })
    const result = await getPermissionAuditLogs()

    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(logger.warn).mock.calls[0]?.[1])).toContain('读取权限审计日志失败')
  })
})

describe('upgrade 日志接入', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
  })

  it('应用更新下载失败时 error 落日志且 onError 收到错误信息', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network unreachable'))
    const onError = vi.fn()

    downloadLatestRelease('github', vi.fn(), vi.fn(), onError)
    // IIFE 异步注册监听器后才 invoke，让微任务队列跑完
    await new Promise((r) => setTimeout(r, 0))

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(logger.error).mock.calls[0]?.[0])).toBe('upgrade')
    expect(String(vi.mocked(logger.error).mock.calls[0]?.[1])).toContain('应用更新下载失败')
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('network unreachable'))
  })
})
