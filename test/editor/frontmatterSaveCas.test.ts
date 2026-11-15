/**
 * I11 回归测试：保存进行中修改 frontmatter 不得被 in-flight 保存覆盖。
 *
 * 此前 CAS（saveAllDirtyTabs / handleSaveFile）只比较 content 不比较
 * frontmatter——保存期间在属性面板改 frontmatter，保存结束仍命中 CAS，
 * 用保存前旧快照覆盖并清脏，属性面板的修改被静默还原。
 * 修复：CAS 同时比较 frontmatter 引用，期间被改则跳过清理（保留用户新值
 * 与脏标记，等待用户再次保存）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// writeFile 用受控 promise：保存「进行中」窗口内注入 frontmatter 修改
let pendingWrite: ((v: void) => void) | null = null
const mockWriteFile = vi.fn(() => new Promise<void>((resolve) => { pendingWrite = resolve }))

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    indexSavedFile: vi.fn().mockResolvedValue(undefined),
    gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@/lib/plugin-host', () => ({
  emitNoteSaved: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitLocaleChanged: vi.fn(),
}))
vi.mock('@/lib/utils/searchQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/searchQuery')>()
  return { ...actual, invalidateFrontmatterCache: vi.fn() }
})

import { useEditorStore } from '@/stores'

const TAB_ID = 'fm-cas-tab'

function setEditableTab() {
  useEditorStore.setState({
    tabs: [{
      id: TAB_ID,
      path: '/root/note.md',
      name: 'note.md',
      content: '# t\n\nbody',
      frontmatter: { title: 'old' },
      isDirty: true,
      isEdited: true,
      frontmatterDirty: false,
      viewMode: 'source' as const,
    }],
    activeTabId: TAB_ID,
    savingPaths: new Set(),
  })
}

describe('保存进行中 frontmatter CAS（I11）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingWrite = null
    setEditableTab()
  })

  it('保存期间属性面板改 frontmatter：完成后保留新值与脏标记', async () => {
    const savePromise = useEditorStore.getState().saveAllDirtyTabs()

    // 保存「进行中」（writeFile pending），在属性面板修改 frontmatter
    await new Promise((r) => setTimeout(r, 5))
    expect(pendingWrite).not.toBeNull()
    useEditorStore.getState().updateTabFrontmatter(TAB_ID, { title: 'new' })

    pendingWrite!()
    await savePromise

    const tab = useEditorStore.getState().tabs.find((t) => t.id === TAB_ID)
    // 新值不被保存前旧快照覆盖
    expect(tab?.frontmatter?.title).toBe('new')
    // 未写入磁盘的部分保持脏标记，等待用户再次保存
    expect(tab?.frontmatterDirty).toBe(true)
    expect(tab?.isDirty).toBe(true)
  })

  it('保存期间无改动：正常清脏并写入 updated（回归保护）', async () => {
    const savePromise = useEditorStore.getState().saveAllDirtyTabs()
    await new Promise((r) => setTimeout(r, 5))
    pendingWrite!()
    await savePromise

    const tab = useEditorStore.getState().tabs.find((t) => t.id === TAB_ID)
    expect(tab?.isDirty).toBe(false)
    expect(tab?.frontmatterDirty).toBe(false)
    expect(tab?.frontmatter?.updated).toBeTruthy()
    expect(tab?.frontmatter?.title).toBe('old')
  })
})
