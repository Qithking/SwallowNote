/**
 * P0-1 回归测试：同步后刷新 tab 时，冲突文件的 dirty tab 不得被静默关闭。
 *
 * 根因（审计 P0-1）：refreshOpenTabsAfterSync 对冲突文件的普通 tab 先于
 * dirty 保护执行 removeTab——未保存编辑随 tab 一起丢失。
 *
 * 修复语义（约束：冲突文件只标记不写冲突标识内容，冲突只能在冲突面板处理）：
 * - 冲突文件 + dirty tab：保留 tab 与未保存编辑，标记外部变更（磁盘已是冲突态）
 * - 冲突文件 + 非 dirty tab：保持现行为，关闭 tab 引导走冲突面板
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const removeTab = vi.fn()
const markExternalChange = vi.fn()
const loadTabContent = vi.fn().mockResolvedValue(undefined)

let fakeTabs: Array<{
  id: string
  path: string
  name: string
  type: string
  isDirty: boolean
  frontmatterDirty: boolean
  hasExternalChange?: boolean
}> = []

let fakeConflictFilesMap: Record<string, string[]> = {}

vi.mock('@/stores/editor', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: fakeTabs,
      removeTab,
      markExternalChange,
      loadTabContent,
    }),
  },
}))

vi.mock('@/stores/git', () => ({
  useGitStore: {
    getState: () => ({
      conflictFilesMap: fakeConflictFilesMap,
    }),
  },
}))

import { refreshOpenTabsAfterSync } from '../refreshOpenTabs'

function makeTab(overrides: Partial<{ id: string; path: string; isDirty: boolean; frontmatterDirty: boolean }> = {}) {
  return {
    id: overrides.id ?? 'tab-1',
    path: overrides.path ?? '/ws/repo/note.md',
    name: 'note.md',
    type: 'file',
    isDirty: overrides.isDirty ?? false,
    frontmatterDirty: overrides.frontmatterDirty ?? false,
  }
}

describe('refreshOpenTabsAfterSync — 冲突文件 dirty tab 保护（P0-1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeTabs = []
    fakeConflictFilesMap = {}
  })

  it('冲突文件 + dirty tab：不关闭 tab、保留未保存编辑、标记外部变更', async () => {
    fakeTabs = [makeTab({ isDirty: true })]
    fakeConflictFilesMap = { '/ws/repo': ['/ws/repo/note.md'] }

    await refreshOpenTabsAfterSync(['/ws/repo'])

    // 核心断言：不得 removeTab（旧实现会静默丢弃未保存编辑）
    expect(removeTab).not.toHaveBeenCalled()
    expect(markExternalChange).toHaveBeenCalledWith('tab-1')
    // 不得把含冲突标记的磁盘内容载入覆盖用户编辑
    expect(loadTabContent).not.toHaveBeenCalled()
  })

  it('冲突文件 + frontmatterDirty tab：同样不关闭并标记外部变更', async () => {
    fakeTabs = [makeTab({ frontmatterDirty: true })]
    fakeConflictFilesMap = { '/ws/repo': ['/ws/repo/note.md'] }

    await refreshOpenTabsAfterSync(['/ws/repo'])

    expect(removeTab).not.toHaveBeenCalled()
    expect(markExternalChange).toHaveBeenCalledWith('tab-1')
  })

  it('冲突文件 + 非 dirty tab：保持现行为，关闭 tab 引导走冲突面板', async () => {
    fakeTabs = [makeTab({ isDirty: false })]
    fakeConflictFilesMap = { '/ws/repo': ['/ws/repo/note.md'] }

    await refreshOpenTabsAfterSync(['/ws/repo'])

    expect(removeTab).toHaveBeenCalledWith('tab-1')
    expect(markExternalChange).not.toHaveBeenCalled()
    expect(loadTabContent).not.toHaveBeenCalled()
  })

  it('非冲突文件 dirty tab：行为不变（保留编辑标记外部变更）', async () => {
    fakeTabs = [makeTab({ isDirty: true })]
    fakeConflictFilesMap = {}

    await refreshOpenTabsAfterSync(['/ws/repo'])

    expect(removeTab).not.toHaveBeenCalled()
    expect(markExternalChange).toHaveBeenCalledWith('tab-1')
    expect(loadTabContent).not.toHaveBeenCalled()
  })
})
