/**
 * 批次③附带发现回归测试：useFileTreeActions 重命名/删除后 frontmatter 索引同步
 * 不得直传 rootPath（workspace 模式恒 null → fs_guard 拒绝 → 缓存 stale）。
 *
 * 修复前 :120/:238 `invalidateFrontmatterCache(..., rootPath)`，workspace 模式恒 null。
 * 修复后统一走 workspaceRootFor(目标路径)，与 I14 同款语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

// 保留真实 barrel（workspaceRootFor 真实），仅覆盖与本测试无关的文件写操作
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    createFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    renameFile: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  }
})
vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn(async () => []),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

import { useFileTreeActions } from '@/hooks/useFileTreeActions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileTreeStore } from '@/stores/filetree'
import { useUIStore } from '@/stores/ui'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'

const FOLDER_A = '/wks/alpha'

function makeNode(path: string, isDirectory = false): FileNode {
  return { id: path, name: path.split('/').pop()!, path, isDirectory }
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({ rootPath: null, workspaceFolders: [FOLDER_A] })
  useUIStore.setState({ workspaceMode: 'workspace' })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFileTreeActions 索引同步允许根（批次③遗留）', () => {
  it('重命名提交：trigger_frontmatter_scan 收到旧路径所属 folder 根', async () => {
    useFileTreeStore.setState({
      nodes: [makeNode(`${FOLDER_A}/notes/a.md`), makeNode(`${FOLDER_A}/notes`, true)],
      expanded: new Set(),
      multiSelectedPaths: new Set(),
    })
    const { result } = renderHook(() => useFileTreeActions())

    act(() => {
      // 编辑框内容为「新名字」才能通过 editingName === node.name 提前返回检查
      result.current.handleStartEdit(`${FOLDER_A}/notes/a.md`, 'b.md', false)
    })
    await act(async () => {
      await result.current.handleFinishEdit()
    })

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ path: `${FOLDER_A}/notes/a.md`, workspaceRoot: FOLDER_A })
  })

  it('批量删除：trigger_frontmatter_scan 收到被删文件所属 folder 根', async () => {
    const target = `${FOLDER_A}/notes/a.md`
    useFileTreeStore.setState({
      nodes: [makeNode(target), makeNode(`${FOLDER_A}/notes`, true)],
      expanded: new Set(),
      multiSelectedPaths: new Set(),
      selectedPath: target,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = renderHook(() => useFileTreeActions())

    await act(async () => {
      await result.current.handleDeleteSelected()
    })

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ path: target, workspaceRoot: FOLDER_A })
    vi.restoreAllMocks()
  })
})
