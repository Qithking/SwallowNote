/**
 * I6 回归测试：YAML 筛选按工作区根限定查询，跨根去重合并。
 *
 * 此前 handleYamlSearch 直接 invoke('search_frontmatter', { filters })，
 * 后端查全局 SQLite 索引无路径过滤，其它工作区的记录混入当前结果。
 * 修复后：searchFrontmatterByRoots 按当前 roots 逐个传 pathPrefix，
 * 单根失败静默为空，跨根重复 file_path 只保留一条。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}))

import { searchFrontmatterByRoots } from '@/components/Search/SearchView'
import { invoke } from '@tauri-apps/api/core'

describe('searchFrontmatterByRoots 按工作区根限定（I6）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('每个根各发一次 invoke 且带 pathPrefix，跨根重复 file_path 只保留一条', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: unknown) => {
      const { pathPrefix } = args as { pathPrefix: string }
      if (pathPrefix === '/a') {
        return [
          { file_path: '/a/x.md', title: 'X' },
          { file_path: '/shared.md', title: 'Shared' },
        ]
      }
      if (pathPrefix === '/b') {
        return [
          { file_path: '/b/y.md', title: 'Y' },
          { file_path: '/shared.md', title: 'Duplicate' },
        ]
      }
      return []
    })

    const result = await searchFrontmatterByRoots(['/a', '/b'], { status: 'draft' })

    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('search_frontmatter', {
      filters: { status: 'draft' },
      pathPrefix: '/a',
    })
    // 共享路径只保留首个根的记录
    expect(result.map((r) => r.file_path).sort()).toEqual(['/a/x.md', '/b/y.md', '/shared.md'])
  })

  it('单根查询失败静默为空，不影响其它根结果', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: unknown) => {
      const { pathPrefix } = args as { pathPrefix: string }
      if (pathPrefix === '/a') throw new Error('boom')
      return [{ file_path: '/b/y.md', title: 'Y' }]
    })

    const result = await searchFrontmatterByRoots(['/a', '/b'], {})

    expect(result.map((r) => r.file_path)).toEqual(['/b/y.md'])
  })

  it('无工作区根时不发起查询', async () => {
    const result = await searchFrontmatterByRoots([], { status: 'draft' })

    expect(result).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
