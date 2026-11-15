/**
 * 批次③附带发现回归测试：FileTreeContextMenu 剪切粘贴/删除后 frontmatter 索引同步
 * 不得直传 rootPath（workspace 模式恒 null → fs_guard 拒绝 → 缓存 stale）。
 *
 * 修复前 :249/:287 `invalidateFrontmatterCache(..., useWorkspaceStore.getState().rootPath)`。
 * 修复后统一走 workspaceRootFor(目标路径)，与 I14 同款语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))
vi.mock('@/components/Plugin/PluginContextMenuItems', () => ({
  PluginContextMenuItems: () => null,
}))
vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn(async () => ''),
  loadDirectory: vi.fn(async () => []),
}))
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    deleteFile: vi.fn(async () => undefined),
    removeFolderHistory: vi.fn(async () => undefined),
  }
})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

import { TreeNodeContextMenu } from '@/components/FileTree/FileTreeContextMenu'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode } from '@/stores/filetree'

const FOLDER_A = '/wks/alpha'

function makeFileNode(path: string, name: string, isDirectory: boolean): FileNode {
  return { id: path, name, path, isDirectory }
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({ rootPath: null, workspaceFolders: [FOLDER_A] })
  useUIStore.setState({ workspaceMode: 'workspace' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderMenu(node: FileNode) {
  render(
    <TreeNodeContextMenu node={node}>
      <div>trigger</div>
    </TreeNodeContextMenu>,
  )
  fireEvent.contextMenu(screen.getByText('trigger'))
}

describe('FileTreeContextMenu 索引同步允许根（批次③遗留）', () => {
  it('剪切粘贴：源文件删除后 trigger_frontmatter_scan 收到所属 folder 根', async () => {
    const sourcePath = `${FOLDER_A}/a.md`
    useUIStore.setState({ workspaceMode: 'workspace', clipboardFiles: [sourcePath], clipboardIsCut: true })
    renderMenu(makeFileNode(`${FOLDER_A}/notes`, 'notes', true))

    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.paste' }))
    await new Promise((r) => setTimeout(r, 10))

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ path: sourcePath, workspaceRoot: FOLDER_A })
  })

  it('右键删除：trigger_frontmatter_scan 收到被删节点所属 folder 根', async () => {
    const target = `${FOLDER_A}/del.md`
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderMenu(makeFileNode(target, 'del.md', false))

    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.hardDelete' }))
    await new Promise((r) => setTimeout(r, 10))

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ path: target, workspaceRoot: FOLDER_A })
    vi.restoreAllMocks()
  })
})
