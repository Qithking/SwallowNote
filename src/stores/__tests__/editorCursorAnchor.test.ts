/**
 * editor store 光标锚点保存/清理回归测试（dev-fix：光标位置恢复）。
 *
 * 期望语义：
 * 1. setActiveTab 离开旧 tab 前，把模块级缓存的光标锚点同步进旧 tab
 *    （与 scrollTop 同路径，应用重启后随会话持久化）；
 * 2. removeTab / removeTabs 清理锚点缓存。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../editor'
import { setCursorAnchorCache, getCursorAnchorCache, clearCursorAnchorCache } from '@/lib/cursor-anchor'
import type { CursorAnchor } from '@/lib/cursor-anchor'
import type { EditorTab } from '../editor'

const anchor: CursorAnchor = { pos: 42, before: 'before-text', after: 'after-text' }

function makeTab(overrides: Partial<EditorTab>): EditorTab {
  return {
    id: 'tab-x',
    name: 'x.md',
    path: '/tmp/x.md',
    type: 'file',
    content: 'content',
    ...overrides,
  } as EditorTab
}

describe('editor store cursor anchor', () => {
  beforeEach(() => {
    clearCursorAnchorCache('tab-a')
    clearCursorAnchorCache('tab-b')
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('setActiveTab 切换时把缓存锚点写入离开的旧 tab', () => {
    const tabA = makeTab({ id: 'tab-a' })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })
    setCursorAnchorCache('tab-a', anchor)

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.cursorAnchor).toEqual(anchor)
  })

  it('无缓存锚点时切换 tab 不覆盖已有锚点', () => {
    const tabA = makeTab({ id: 'tab-a', cursorAnchor: anchor })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.cursorAnchor).toEqual(anchor)
  })

  it('removeTab 清理锚点缓存', () => {
    useEditorStore.setState({ tabs: [makeTab({ id: 'tab-a' })], activeTabId: 'tab-a' })
    setCursorAnchorCache('tab-a', anchor)

    useEditorStore.getState().removeTab('tab-a')

    expect(getCursorAnchorCache('tab-a')).toBeUndefined()
    expect(useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')).toBeUndefined()
  })

  it('removeTabs 清理各锚点缓存', () => {
    useEditorStore.setState({
      tabs: [makeTab({ id: 'tab-a' }), makeTab({ id: 'tab-b' })],
      activeTabId: 'tab-a',
    })
    setCursorAnchorCache('tab-a', anchor)
    setCursorAnchorCache('tab-b', anchor)

    useEditorStore.getState().removeTabs(['tab-a', 'tab-b'])

    expect(getCursorAnchorCache('tab-a')).toBeUndefined()
    expect(getCursorAnchorCache('tab-b')).toBeUndefined()
  })

  it('updateCursorAnchor 直接更新指定 tab 的锚点', () => {
    useEditorStore.setState({ tabs: [makeTab({ id: 'tab-a' })], activeTabId: 'tab-a' })

    useEditorStore.getState().updateCursorAnchor('tab-a', anchor)

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.cursorAnchor).toEqual(anchor)
  })
})
