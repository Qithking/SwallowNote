/**
 * I9 回归测试：文件树打开文件必须展示真实 mtime。
 *
 * 此前 FileTreeView 两处 addTab 用 `new Date().toLocaleString()`——
 * 修改时间显示为「打开时刻」且永不更新，违背 editor store 中
 * 「失败时保留已有 modifiedTime、不回退当前时间」的既有约定。
 * 修复后经 resolveNodeModifiedTime 取真实 mtime，获取失败返回
 * undefined（保持缺省）而不是假时间。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetFileMetadata = vi.fn()
vi.mock('@/lib/tauri', () => ({
  getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
}))

import { resolveNodeModifiedTime } from '@/components/FileTree/FileTreeView'

describe('resolveNodeModifiedTime 取真实 mtime（I9）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getFileMetadata 成功时返回真实 modified_time', async () => {
    mockGetFileMetadata.mockResolvedValueOnce({ modified_time: '2026-11-14 10:00:00' })
    await expect(resolveNodeModifiedTime('/root/a.md')).resolves.toBe('2026-11-14 10:00:00')
    expect(mockGetFileMetadata).toHaveBeenCalledWith('/root/a.md')
  })

  it('获取失败返回 undefined（不回退当前时间）', async () => {
    mockGetFileMetadata.mockRejectedValueOnce(new Error('stat failed'))
    const result = await resolveNodeModifiedTime('/root/a.md')
    expect(result).toBeUndefined()
    // 明确不是「当前时刻」字符串
    expect(result).not.toBe(new Date().toLocaleString())
  })
})
