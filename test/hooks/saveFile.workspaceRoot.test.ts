/**
 * I14 回归测试：保存后 frontmatter 索引同步在 workspace 模式不应传恒 null 根。
 *
 * 此前 handleSaveFile 直接传 `rootPath || null`，而 workspace 模式下
 * rootPath 恒为 null，后端 fs_guard fail-closed 拒绝 index_saved_file /
 * trigger_frontmatter_scan，导致 YAML 筛选与分类面板 stale。
 * 修复后：允许根统一走 workspaceRootFor(path)（folder/workspace 两模式通用）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))
// useKeyboardShortcuts 直接 import 'i18next' 单例（未初始化），mock 最小链式 API
vi.mock('i18next', () => {
  const i18n = {
    t: (k: string) => k,
    use: () => i18n,
    init: () => i18n,
    changeLanguage: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    language: 'zh-CN',
  }
  return { default: i18n }
})
// 保留真实 barrel（含 file-ops 的真实 workspaceRootFor），仅覆盖写盘/提交命令
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/editor-flush', () => ({
  flushAllEditors: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/plugin-host', () => ({
  emitNoteSaved: vi.fn(),
}))
vi.mock('@/lib/plugin-commands', () => ({
  listPluginCommands: vi.fn().mockReturnValue([]),
}))

import { handleSaveFile } from '@/hooks/useKeyboardShortcuts'
import { useEditorStore, type EditorTab } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'
import { invoke } from '@tauri-apps/api/core'

/** 最小可用 tab（handleSaveFile 只读 path/content/isDirty/frontmatterDirty/frontmatter） */
function makeDirtyTab(path: string): EditorTab {
  return {
    id: 't1',
    path,
    name: path.split('/').pop()!,
    content: '# hi',
    isDirty: true,
    isEdited: true,
    viewMode: 'source',
  } as unknown as EditorTab
}

describe('handleSaveFile 索引同步的允许根解析（I14）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ workspaceMode: 'workspace' })
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({
      rootPath: null,
      workspaceFolders: [],
      currentWorkspacePath: null,
      sessionContextPath: null,
    })
  })

  it('workspace 模式保存：index_saved_file 收到所属 folder 根而非 null', async () => {
    useWorkspaceStore.setState({ workspaceFolders: ['/wks/alpha'], rootPath: null })
    useEditorStore.setState({
      tabs: [makeDirtyTab('/wks/alpha/notes/note.md')],
      activeTabId: 't1',
    })

    await handleSaveFile()

    const indexCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'index_saved_file')
    expect(indexCall).toBeDefined()
    expect(indexCall![1]).toMatchObject({ path: '/wks/alpha/notes/note.md', workspaceRoot: '/wks/alpha' })
  })

  it('folder 模式保存：允许根为 rootPath（回归保护）', async () => {
    useUIStore.setState({ workspaceMode: 'folder' })
    useWorkspaceStore.setState({ rootPath: '/old/notes' })
    useEditorStore.setState({
      tabs: [makeDirtyTab('/old/notes/note.md')],
      activeTabId: 't1',
    })

    await handleSaveFile()

    const indexCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'index_saved_file')
    expect(indexCall![1]).toMatchObject({ workspaceRoot: '/old/notes' })
  })

  it('保存后 trigger_frontmatter_scan 同样收到所属 folder 根', async () => {
    useWorkspaceStore.setState({ workspaceFolders: ['/wks/alpha'], rootPath: null })
    useEditorStore.setState({
      tabs: [makeDirtyTab('/wks/alpha/notes/note.md')],
      activeTabId: 't1',
    })

    await handleSaveFile()

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ workspaceRoot: '/wks/alpha' })
  })
})
