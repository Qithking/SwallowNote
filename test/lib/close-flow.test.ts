/**
 * I1 回归锚点：「保存并关闭」保存结果校验
 *
 * 因果链：saveAllDirtyTabs 内部 catch 吞掉写盘错误（仅派发 save-error 事件）
 * → App.tsx handleSaveAndClose 若不校验剩余脏 tab，失败时也无条件销毁窗口
 * → 会话持久化只存 tab 元数据不存正文，未保存内容永久丢失。
 *
 * getDirtyCloseGuard 是关闭流程的决策点：保存后仍有脏 tab（含 frontmatterDirty）
 * 必须返回 abort=true，App 据此中止关闭并重新弹出保存对话框。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, type EditorTab } from '@/stores/editor'
import { getDirtyCloseGuard } from '@/lib/close-flow'

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    path: '/tmp/note.md',
    name: 'note.md',
    content: 'hello',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    ...overrides,
  } as EditorTab
}

describe('getDirtyCloseGuard（I1：保存并关闭校验保存结果）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('无脏 tab 时 abort=false（保存成功应正常关闭）', () => {
    useEditorStore.setState({ tabs: [makeTab({ isDirty: false, frontmatterDirty: false })] })
    expect(getDirtyCloseGuard()).toEqual({ abort: false, dirtyNames: [] })
  })

  it('保存失败仍有脏 tab（isDirty）时 abort=true 并给出名称摘要', () => {
    useEditorStore.setState({ tabs: [makeTab({ isDirty: true })] })
    const guard = getDirtyCloseGuard()
    expect(guard.abort).toBe(true)
    expect(guard.dirtyNames).toEqual(['note.md'])
  })

  it('frontmatterDirty 也计为脏（属性面板修改未保存同样中止关闭）', () => {
    useEditorStore.setState({ tabs: [makeTab({ frontmatterDirty: true })] })
    expect(getDirtyCloseGuard().abort).toBe(true)
  })

  it('超过 5 个脏 tab 时名称截断为 5 个加 ...', () => {
    const tabs = Array.from({ length: 7 }, (_, i) =>
      makeTab({ id: `tab-${i}`, name: `n${i}.md`, isDirty: true })
    )
    useEditorStore.setState({ tabs })
    expect(getDirtyCloseGuard().dirtyNames).toEqual(['n0.md', 'n1.md', 'n2.md', 'n3.md', 'n4.md', '...'])
  })
})
