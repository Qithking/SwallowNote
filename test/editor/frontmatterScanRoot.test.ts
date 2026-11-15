/**
 * 批次③附带发现回归测试：editor store saveAllDirtyTabs 保存后 frontmatter
 * 索引同步不得直传 rootPath（workspace 模式恒 null → fs_guard 拒绝 → 缓存 stale）。
 *
 * 修复前 :901 `invalidateFrontmatterCache(tab.path, useWorkspaceStore.getState().rootPath)`
 * 在 workspace 模式下 rootPath 恒 null。修复后统一走 workspaceRootFor(tab.path)，
 * 与 I14（useKeyboardShortcuts）同款语义。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    indexSavedFile: vi.fn().mockResolvedValue(undefined),
    gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn(async () => ''),
}))
vi.mock('@/lib/plugin-host', () => ({
  emitNoteChanged: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitNoteOpened: vi.fn(),
  emitNoteSaved: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { invoke } from '@tauri-apps/api/core'

function setDirtyMarkdownTab(path: string) {
  useEditorStore.setState({
    tabs: [{
      id: path,
      path,
      name: path.split('/').pop()!,
      content: '# hi',
      frontmatter: { title: 't' },
      isDirty: true,
      isEdited: true,
      frontmatterDirty: false,
      viewMode: 'source',
    } as never],
    activeTabId: path,
    savingPaths: new Set(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({
    rootPath: null,
    workspaceFolders: [],
    currentWorkspacePath: null,
    sessionContextPath: null,
  })
})

describe('saveAllDirtyTabs 保存后索引同步允许根（批次③遗留）', () => {
  it('workspace 模式保存：trigger_frontmatter_scan 收到所属 folder 根而非 null', async () => {
    useWorkspaceStore.setState({ workspaceFolders: ['/wks/alpha'], rootPath: null })
    setDirtyMarkdownTab('/wks/alpha/notes/note.md')

    await useEditorStore.getState().saveAllDirtyTabs()

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ path: '/wks/alpha/notes/note.md', workspaceRoot: '/wks/alpha' })
  })

  it('folder 模式保存：允许根为 rootPath（回归保护）', async () => {
    useWorkspaceStore.setState({ rootPath: '/old/notes', workspaceFolders: [] })
    setDirtyMarkdownTab('/old/notes/note.md')

    await useEditorStore.getState().saveAllDirtyTabs()

    const scanCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'trigger_frontmatter_scan')
    expect(scanCall).toBeDefined()
    expect(scanCall![1]).toMatchObject({ workspaceRoot: '/old/notes' })
  })
})
