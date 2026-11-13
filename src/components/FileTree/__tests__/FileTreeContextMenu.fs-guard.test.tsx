/**
 * 右键菜单 fs_guard 白名单根回归测试（dev-fix: ctx-menu-fs-guard）
 *
 * 根因：fs_guard 收编后，FileTreeContextMenu 两处「组件直连 invoke」未同步
 * 新的授权语义（workspaceRoot = 目标路径所属的工作区根）：
 *  - 「在文件资源管理器中显示」仍传旧全局语义 rootPath || null，
 *    workspace 模式下 rootPath 恒为 null → 后端允许根只剩 app_data → 误拒 → 静默无效
 *  - 「粘贴」invoke('copy_file') 完全未传 workspaceRoot → 误拒 → 粘贴全失败
 *
 * pattern analysis 同根因漏网点一并收编后的断言契约：
 *  - openInFinder wrapper / 调用点收到的 workspaceRoot = 目标路径所属的 workspace folder
 *  - copy_file / rename_file（拖拽移动）收到的 workspaceRoot = 源路径所属的 workspace folder
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, renderHook, act } from '@testing-library/react'
import { invoke as invokeMock } from '@tauri-apps/api/core'
import { TreeNodeContextMenu } from '../FileTreeContextMenu'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'
import { useFileTreeStore } from '@/stores/filetree'
import { useEditorStore } from '@/stores/editor'
import { openInFinder } from '@/lib/tauri'
import { useFileTreeDragDrop } from '@/hooks/useFileTreeDragDrop'
import type { FileNode } from '@/stores/filetree'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  // ui store 导入 i18n 初始化链需要此导出
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

// 插件贡献项与本测试无关，mock 掉避免拉入插件链
vi.mock('@/components/Plugin/PluginContextMenuItems', () => ({
  PluginContextMenuItems: () => null,
}))

// api 层 mock：paste/open 后的 loadDirectory 刷新返回空
vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn(async () => ''),
  loadDirectory: vi.fn(async () => []),
}))

// lib/tauri barrel：保留真实 workspaceRootFor/openInFinder/renameFile（端到端验证选根语义），
// mock 掉与本测试无关的文件写操作
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    deleteFile: vi.fn(async () => undefined),
    removeFolderHistory: vi.fn(async () => undefined),
  }
})

const FOLDER_A = '/data/ws/impl'

function makeFileNode(path: string, name: string, isDirectory: boolean): FileNode {
  return { id: path, name, path, isDirectory }
}

beforeEach(() => {
  vi.mocked(invokeMock).mockImplementation(async () => undefined)
  // workspace 模式：rootPath 恒为 null，多根 folders 生效
  useWorkspaceStore.setState({ rootPath: null, workspaceFolders: [FOLDER_A, '/data/other/proj'] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function openMenuAndClick(itemName: string) {
  render(
    <TreeNodeContextMenu node={makeFileNode('/data/ws/impl/notes', 'notes', true)}>
      <div>trigger</div>
    </TreeNodeContextMenu>,
  )
  fireEvent.contextMenu(screen.getByText('trigger'))
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }))
}

describe('右键菜单 fs_guard 白名单根（workspace 模式）', () => {
  it('「在文件资源管理器中显示」传节点所属 folder 作为 workspaceRoot', async () => {
    useUIStore.setState({ workspaceMode: 'workspace' })
    render(
      <TreeNodeContextMenu node={makeFileNode(`${FOLDER_A}/notes/x.md`, 'x.md', false)}>
        <div>trigger</div>
      </TreeNodeContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('trigger'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.showInExplorer' }))
    await Promise.resolve()

    const call = vi.mocked(invokeMock).mock.calls.find(([cmd]) => cmd === 'open_in_finder')
    expect(call).toBeDefined()
    expect(call![1]).toEqual({ path: `${FOLDER_A}/notes/x.md`, workspaceRoot: FOLDER_A })
  })

  it('「粘贴」传源文件所属 folder 作为 workspaceRoot', async () => {
    useUIStore.setState({ workspaceMode: 'workspace', clipboardFiles: [`${FOLDER_A}/a.md`], clipboardIsCut: false })
    openMenuAndClick('contextMenu.paste')
    await Promise.resolve()

    const call = vi.mocked(invokeMock).mock.calls.find(([cmd]) => cmd === 'copy_file')
    expect(call).toBeDefined()
    expect(call![1]).toEqual({
      req: { old_path: `${FOLDER_A}/a.md`, new_path: `${FOLDER_A}/notes/a.md` },
      workspaceRoot: FOLDER_A,
    })
  })
})

describe('openInFinder wrapper（fs_guard 收编统一注入点）', () => {
  it('workspace 模式按目标路径所属 folder 选根', async () => {
    await openInFinder(`${FOLDER_A}/notes/x.md`)

    const call = vi.mocked(invokeMock).mock.calls.find(([cmd]) => cmd === 'open_in_finder')
    expect(call).toBeDefined()
    expect(call![1]).toEqual({ path: `${FOLDER_A}/notes/x.md`, workspaceRoot: FOLDER_A })
  })
})

describe('拖拽移动（useFileTreeDragDrop → renameFile wrapper）', () => {
  it('rename_file 按源路径所属 folder 选根', async () => {
    useUIStore.setState({ workspaceMode: 'workspace', clipboardFiles: [], clipboardIsCut: false })
    useEditorStore.setState({ tabs: [] })
    useFileTreeStore.setState({ nodes: [], expanded: new Set(), multiSelectedPaths: new Set() })

    const nodes = [
      makeFileNode(`${FOLDER_A}/a.md`, 'a.md', false),
      makeFileNode(`${FOLDER_A}/sub`, 'sub', true),
    ]
    const { result } = renderHook(() => useFileTreeDragDrop(nodes))

    const srcNode = nodes[0]
    const targetNode = nodes[1]
    const startEvent = {
      stopPropagation: vi.fn(),
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    } as unknown as React.DragEvent

    act(() => {
      result.current.handleDragStart(startEvent, srcNode)
    })

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {},
    } as unknown as React.DragEvent

    await act(async () => {
      await result.current.handleDrop(dropEvent, targetNode)
    })

    const call = vi.mocked(invokeMock).mock.calls.find(([cmd]) => cmd === 'rename_file')
    expect(call).toBeDefined()
    expect(call![1]).toEqual({
      req: { old_path: `${FOLDER_A}/a.md`, new_path: `${FOLDER_A}/sub/a.md` },
      workspaceRoot: FOLDER_A,
    })
  })
})
