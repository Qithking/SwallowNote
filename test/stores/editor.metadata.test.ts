/**
 * E-M8: editor.ts getFileMetadata 失败时不应回退到当前时间
 *
 * 行为契约: 当 getFileMetadata 抛错时，tab 的 modifiedTime 必须
 * 保留原值（或不更新），而不是被替换为 `new Date().toLocaleString()`，
 * 否则用户会看到错误的"修改时间"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEditorStore, type EditorTab } from '@/stores/editor'

vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn().mockResolvedValue('# Test Note'),
}))

vi.mock('@/lib/tauri', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  getFileMetadata: vi.fn(),
}))

vi.mock('@/lib/plugin-host', () => ({
  emitNoteOpened: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitNoteChanged: vi.fn(),
  emitNoteSaved: vi.fn(),
}))

describe('E-M8: getFileMetadata failure must not fall back to current time', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('preserves previous modifiedTime when getFileMetadata throws', async () => {
    const previousMtime = '2024-01-01 12:00:00'
    const tab: EditorTab = {
      id: 'tab-1',
      path: '/workspace/test.md',
      name: 'test.md',
      content: '',
      isDirty: false,
      isEdited: false,
      viewMode: 'preview',
      modifiedTime: previousMtime,
    }
    useEditorStore.getState().addTab(tab)

    // 让 getFileMetadata 抛错
    const { getFileMetadata } = await import('@/lib/tauri')
    vi.mocked(getFileMetadata).mockRejectedValueOnce(new Error('boom'))

    // force=true 跳过 content 检查强制重载
    await useEditorStore.getState().loadTabContent('tab-1', 0, true)
    // flush queueMicrotask (emitNoteChanged)
    await Promise.resolve()

    const updated = useEditorStore.getState().tabs.find((t) => t.id === 'tab-1')
    // 不能是当前时间 —— 必须保留原值
    expect(updated?.modifiedTime).toBe(previousMtime)
    expect(updated?.modifiedTime).not.toBe(new Date().toLocaleString())
  })
})
