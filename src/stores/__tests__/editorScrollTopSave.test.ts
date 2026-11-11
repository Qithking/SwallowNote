/**
 * editor store scrollTop 保存回归测试（dev-fix：滚回顶部后切 tab 恢复到旧位置）。
 *
 * 根因：保存端把 scrollTop=0 当「无效值」跳过（DOM 读取兜底与保存守卫都是
 * `> 0`），导致滚回顶部再切 tab 时 store 残留上一次非零位置，恢复时回到
 * 「前几次的位置」。
 *
 * 期望语义：
 * 1. 0 是合法位置（顶部）：保存链路不得丢弃 0（根因：保存端 `> 0` 守卫
 *    把读取端正确返回的 0 丢掉，store 残留旧位置，恢复回到「前几次的位置」）；
 * 2. DOM 读到 0（假 0，编辑器 remount 后尚未恢复）时回退监听缓存；
 * 3. DOM 读不到时回退监听缓存，缓存为 0 同样保存；
 * 4. DOM 与缓存都读不到（位置未知，null）时才不覆盖旧值。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/scroll-position', () => ({
  findScrollContainer: vi.fn(() => null),
}))

import { useEditorStore, setLastScrollTop, clearLastScrollTopCache, setEditorContainerEl } from '../editor'
import { findScrollContainer } from '@/lib/scroll-position'
import type { EditorTab } from '../editor'

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

/** 注册一个假编辑器容器，使 readActiveEditorScrollTop 走 DOM 读取分支 */
function mountFakeContainer() {
  setEditorContainerEl(document.createElement('div'))
}

describe('editor store scrollTop 保存（0 为合法位置）', () => {
  beforeEach(() => {
    vi.mocked(findScrollContainer).mockReset().mockReturnValue(null)
    setEditorContainerEl(null)
    clearLastScrollTopCache()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('滚回顶部（DOM scrollTop=0）后切 tab：旧 tab 应保存 0，不得残留旧值', () => {
    mountFakeContainer()
    vi.mocked(findScrollContainer).mockReturnValue({ scrollTop: 0 } as HTMLElement)
    const tabA = makeTab({ id: 'tab-a', scrollTop: 500 })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.scrollTop).toBe(0)
  })

  it('DOM 假 0（编辑器 remount 尚未恢复）时回退到非零监听缓存', () => {
    mountFakeContainer()
    vi.mocked(findScrollContainer).mockReturnValue({ scrollTop: 0 } as HTMLElement)
    setLastScrollTop('tab-a', 500)
    const tabA = makeTab({ id: 'tab-a', scrollTop: 500 })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.scrollTop).toBe(500)
  })

  it('DOM 读不到、监听缓存为 0 时：保存 0', () => {
    setLastScrollTop('tab-a', 0)
    const tabA = makeTab({ id: 'tab-a', scrollTop: 500 })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.scrollTop).toBe(0)
  })

  it('DOM 读到非零值时保存该值（回归保护）', () => {
    mountFakeContainer()
    vi.mocked(findScrollContainer).mockReturnValue({ scrollTop: 300 } as HTMLElement)
    const tabA = makeTab({ id: 'tab-a', scrollTop: 500 })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.scrollTop).toBe(300)
  })

  it('DOM 与缓存都读不到（null）时不覆盖旧值（回归保护）', () => {
    const tabA = makeTab({ id: 'tab-a', scrollTop: 500 })
    const tabB = makeTab({ id: 'tab-b' })
    useEditorStore.setState({ tabs: [tabA, tabB], activeTabId: 'tab-a' })

    useEditorStore.getState().setActiveTab('tab-b')

    const saved = useEditorStore.getState().tabs.find((t) => t.id === 'tab-a')
    expect(saved?.scrollTop).toBe(500)
  })
})
