/**
 * I8 回归测试：Cmd+S 保存失败必须派发 `save-error` 事件。
 *
 * 此前 handleSaveFile 的 catch 仅 logger.error，未派发 `save-error`
 * （对比 saveAllDirtyTabs 会派发且 App.tsx 监听后弹 toast），
 * 用户按 Cmd+S 保存失败时无从得知原因，且可能误以为已保存而关闭窗口丢数据。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))
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
// 写盘失败：模拟磁盘满/权限错误
const mockWriteFile = vi.fn()
vi.mock('@/lib/tauri', () => ({
  openFolderDialog: vi.fn(),
  openWorkspaceDialog: vi.fn(),
  createFile: vi.fn().mockResolvedValue(undefined),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  openInFinder: vi.fn(),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  workspaceRootFor: () => null,
}))
vi.mock('@/lib/api', () => ({ loadDirectory: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/plugin-host', () => ({
  emitNoteSaved: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitLocaleChanged: vi.fn(),
}))
vi.mock('@/lib/plugin-commands', () => ({ listPluginCommands: vi.fn().mockReturnValue([]) }))
vi.mock('@/lib/editor-flush', () => ({ flushAllEditors: vi.fn().mockResolvedValue(undefined) }))

import { handleSaveFile } from '@/hooks/useKeyboardShortcuts'
import { useEditorStore } from '@/stores'

describe('handleSaveFile 保存失败派发 save-error（I8）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null, savingPaths: new Set() })
  })

  it('writeFile 失败时派发 save-error 事件（含路径）', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))
    const tabId = 'tab-1'
    useEditorStore.setState({
      activeTabId: tabId,
      tabs: [{
        id: tabId,
        path: '/root/note.md',
        name: 'note.md',
        content: '# hello',
        isDirty: true,
        isEdited: true,
        viewMode: 'source' as const,
      }],
    })

    const events: CustomEvent[] = []
    const listener = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('save-error', listener)
    try {
      await handleSaveFile()
    } finally {
      window.removeEventListener('save-error', listener)
    }

    expect(events).toHaveLength(1)
    expect(events[0].detail).toMatchObject({ path: '/root/note.md' })
    expect((events[0].detail as { error: unknown }).error).toBeInstanceOf(Error)
  })

  it('保存失败后 tab 保持脏标记（不误清）', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('permission denied'))
    const tabId = 'tab-2'
    useEditorStore.setState({
      activeTabId: tabId,
      tabs: [{
        id: tabId,
        path: '/root/b.md',
        name: 'b.md',
        content: 'body',
        isDirty: true,
        isEdited: true,
        viewMode: 'source' as const,
      }],
    })

    await handleSaveFile()

    const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId)
    expect(tab?.isDirty).toBe(true)
    expect(tab?.frontmatterDirty).toBeFalsy()
  })

  it('保存成功时不派发 save-error（回归保护）', async () => {
    mockWriteFile.mockResolvedValue(undefined)
    const tabId = 'tab-3'
    useEditorStore.setState({
      activeTabId: tabId,
      tabs: [{
        id: tabId,
        path: '/root/c.md',
        name: 'c.md',
        content: 'ok',
        isDirty: true,
        isEdited: true,
        viewMode: 'source' as const,
      }],
    })

    const events: CustomEvent[] = []
    const listener = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('save-error', listener)
    try {
      await handleSaveFile()
    } finally {
      window.removeEventListener('save-error', listener)
    }

    expect(events).toHaveLength(0)
    expect(useEditorStore.getState().tabs.find((t) => t.id === tabId)?.isDirty).toBe(false)
  })
})
