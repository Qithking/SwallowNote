/**
 * filetree store reveal 链路回归测试（dev-fix：切 tab/恢复 tab 时文件树
 * 「展开但空」+ 定位到旧文件）。
 *
 * 场景 ①：watcher 事件 → refreshNode 重写父目录 children 时丢弃已加载
 * 孙辈（与 treeUtils 根因同源，此处验证 store 链路端到端行为）。
 * 场景 ②：快速连续切 tab 时，旧 revealPath 的 batch 迟到返回后覆盖
 * selectedPath（reveal 无代际 token），导致定位到旧文件。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn(async () => []),
  loadDirectoriesBatch: vi.fn(async () => []),
}))

vi.mock('@/lib/tauri', () => ({
  pathExists: vi.fn(async () => true),
}))

import { useFileTreeStore } from '../filetree'
import type { FileNode } from '../filetree'
import { loadDirectory, loadDirectoriesBatch } from '@/lib/api'
import { findNodeByPath } from '@/lib/utils/treeUtils'

function dir(path: string, children?: FileNode[]): FileNode {
  return {
    id: path,
    name: path.split('/').pop() || path,
    path,
    isDirectory: true,
    ...(children ? { children } : {}),
  } as FileNode
}

function file(path: string): FileNode {
  return { id: path, name: path.split('/').pop() || path, path, isDirectory: false } as FileNode
}

describe('filetree reveal 链路', () => {
  beforeEach(() => {
    vi.mocked(loadDirectory).mockReset().mockImplementation(async () => [])
    vi.mocked(loadDirectoriesBatch).mockReset().mockImplementation(async () => [])
    useFileTreeStore.setState({
      nodes: [],
      expanded: new Set(),
      selectedPath: null,
      multiSelectedPaths: new Set(),
      lastClickedPath: null,
      isLoading: false,
    })
  })

  describe('refreshNode：重写父目录不丢已加载子树', () => {
    it('refreshNode 后孙辈 children 仍保留，新文件正常出现（RED：旧实现 b.children 被覆盖为 undefined）', async () => {
      // 初始树：root/a/b/f1.md 均已加载，a、b 已展开
      useFileTreeStore.setState({
        nodes: [dir('/root', [dir('/root/a', [dir('/root/a/b', [file('/root/a/b/f1.md')])])])],
        expanded: new Set(['/root', '/root/a', '/root/a/b']),
      })

      // watcher 触发的 refreshNode('/root/a')：磁盘上 b 仍在、新增 f2.md
      vi.mocked(loadDirectory).mockResolvedValue([dir('/root/a/b'), file('/root/a/f2.md')])

      await useFileTreeStore.getState().refreshNode('/root/a')

      const { nodes } = useFileTreeStore.getState()
      // 展开的 b 必须仍有子行，且 f1.md 未丢
      const b = findNodeByPath('/root/a/b', nodes)
      expect(b?.children?.map((c) => c.path)).toContain('/root/a/b/f1.md')
      // 新文件正常出现
      const a = findNodeByPath('/root/a', nodes)
      expect(a?.children?.map((c) => c.path)).toContain('/root/a/f2.md')
    })
  })

  describe('revealPath：快速连续切 tab 的竞态', () => {
    it('旧 reveal 的 batch 迟到返回后不得覆盖新 selectedPath（RED：定位到旧文件）', async () => {
      let resolveBatchA!: (v: Array<{ path: string; children: FileNode[] }>) => void
      vi.mocked(loadDirectoriesBatch)
        .mockImplementationOnce(
          () =>
            new Promise((res) => {
              resolveBatchA = res
            })
        )
        .mockImplementationOnce(async () => [])

      // 第一次切 tab：reveal fileA，推进至 batch 挂起（网络慢，IPC 已发出）
      const revealA = useFileTreeStore.getState().revealPath('/root/a1/f1.md', '/root')
      // 条件等待：确保 A 的 batch 真正挂起（而非靠固定 sleep）
      await vi.waitFor(() => {
        expect(vi.mocked(loadDirectoriesBatch)).toHaveBeenCalledTimes(1)
      })

      // 第二次切 tab：reveal fileB，batch 立即完成
      const revealB = useFileTreeStore.getState().revealPath('/root/b2/f2.md', '/root')
      await revealB
      expect(useFileTreeStore.getState().selectedPath).toBe('/root/b2/f2.md')

      // 旧 reveal 的 batch 迟到返回
      resolveBatchA([
        { path: '/root', children: [dir('/root/a1')] },
        { path: '/root/a1', children: [file('/root/a1/f1.md')] },
      ])
      await revealA

      // 期望仍是 fileB（旧实现被 A 覆盖为 /root/a1/f1.md → RED）
      expect(useFileTreeStore.getState().selectedPath).toBe('/root/b2/f2.md')
    })
  })
})
