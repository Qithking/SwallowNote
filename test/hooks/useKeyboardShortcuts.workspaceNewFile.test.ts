/**
 * I4 回归测试：workspace 模式下新建文件/文件夹快捷键不应静默失效。
 *
 * 此前 handleNewFile / handleNewFolder 以 `rootPath` 为前置条件，而
 * workspace 模式下 rootPath 恒为 null（loadWorkspaceFile 从不设置它），
 * Ctrl+N / Ctrl+Shift+N 在 workspace 模式下无任何反应。
 * 修复后：workspace 模式取当前选中目录/其父目录，无选中回退首个 workspace 根。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))
// useKeyboardShortcuts 直接 import 'i18next' 单例（未初始化），t() 会返回 key；
// mock 为最小映射（含初始化链式 API），保证 createFile 路径断言稳定
vi.mock('i18next', () => {
  const i18n = {
    t: (k: string) =>
      k === 'fileTree.defaultFileName' ? '新文件.md'
      : k === 'fileTree.defaultFolderName' ? '新文件夹'
      : k,
    use: () => i18n,
    init: () => i18n,
    changeLanguage: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    language: 'zh-CN',
  }
  return { default: i18n }
})
vi.mock('@/lib/tauri', () => ({
  openFolderDialog: vi.fn(),
  openWorkspaceDialog: vi.fn(),
  createFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  openInFinder: vi.fn(),
  // file-ops 允许根解析的测试简化版：所有树内路径均归属 mockWsRoot
  workspaceRootFor: (p: string) =>
    p === mockWsRoot || p.startsWith(mockWsRoot + '/') ? mockWsRoot : null,
}))
vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/plugin-host', () => ({
  emitLocaleChanged: vi.fn(),
  emitNoteSaved: vi.fn(),
}))
vi.mock('@/lib/plugin-commands', () => ({
  listPluginCommands: vi.fn().mockReturnValue([]),
}))
vi.mock('@/lib/editor-flush', () => ({
  flushAllEditors: vi.fn().mockResolvedValue(undefined),
}))

import { handleNewFile, handleNewFolder } from '@/hooks/useKeyboardShortcuts'
import { useFileTreeStore, useWorkspaceStore } from '@/stores'
import { useUIStore } from '@/stores/ui'
import { createFile } from '@/lib/tauri'
import type { FileNode } from '@/stores/filetree'

function makeNode(partial: Partial<FileNode> & Pick<FileNode, 'id' | 'name' | 'path' | 'isDirectory'>): FileNode {
  return partial
}

// mock 工厂（被 hoist）内引用的变量必须以 mock 前缀声明
const mockWsRoot = '/wks/alpha'
const WS_ROOT = mockWsRoot

/** workspace 模式树：根目录 + notes 子目录 + 一个文件 */
function workspaceTreeNodes(): FileNode[] {
  return [
    makeNode({ id: 'root', name: 'alpha', path: WS_ROOT, isDirectory: true }),
    makeNode({
      id: 'notes', name: 'notes', path: `${WS_ROOT}/notes`, isDirectory: true,
      children: [makeNode({ id: 'note1', name: 'note.md', path: `${WS_ROOT}/notes/note.md`, isDirectory: false })],
    }),
  ]
}

function setStateFor(overrides: {
  workspaceMode?: 'folder' | 'workspace'
  rootPath?: string | null
  workspaceFolders?: string[]
  selectedPath?: string | null
  nodes?: FileNode[]
}) {
  useUIStore.setState({ workspaceMode: overrides.workspaceMode ?? 'workspace' })
  useWorkspaceStore.setState({
    rootPath: overrides.rootPath ?? null,
    workspaceFolders: overrides.workspaceFolders ?? [WS_ROOT],
  })
  useFileTreeStore.setState({
    selectedPath: overrides.selectedPath ?? null,
    nodes: overrides.nodes ?? workspaceTreeNodes(),
  })
}

describe('useKeyboardShortcuts 新建快捷键在 workspace 模式（I4）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('选中文件时在所属目录新建（createFile 不再被 rootPath=null 短路）', async () => {
    setStateFor({ selectedPath: `${WS_ROOT}/notes/note.md` })
    await handleNewFile()
    expect(createFile).toHaveBeenCalledWith(`${WS_ROOT}/notes/新文件.md`, false)
  })

  it('无选中时回退首个 workspace 根', async () => {
    setStateFor({ selectedPath: null })
    await handleNewFile()
    expect(createFile).toHaveBeenCalledWith(`${WS_ROOT}/新文件.md`, false)
  })

  it('选中目录时在该目录新建', async () => {
    setStateFor({ selectedPath: `${WS_ROOT}/notes` })
    await handleNewFile()
    expect(createFile).toHaveBeenCalledWith(`${WS_ROOT}/notes/新文件.md`, false)
  })

  it('folder 模式无 rootPath 仍静默跳过（保持原行为）', async () => {
    setStateFor({ workspaceMode: 'folder', rootPath: null })
    await handleNewFile()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('新建文件夹：workspace 模式选中文件时在其父目录创建', async () => {
    setStateFor({ selectedPath: `${WS_ROOT}/notes/note.md` })
    await handleNewFolder()
    expect(createFile).toHaveBeenCalledWith(`${WS_ROOT}/notes/新文件夹`, true)
  })

  it('新建文件夹：folder 模式无 rootPath 仍静默跳过', async () => {
    setStateFor({ workspaceMode: 'folder', rootPath: null })
    await handleNewFolder()
    expect(createFile).not.toHaveBeenCalled()
  })
})
