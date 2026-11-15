/**
 * I12 回归测试：tab content 内存淘汰按最近使用（LRU）而非数组顺序。
 *
 * 此前 setActiveTab 淘汰用 `slice(-5)`（数组顺序）——交替使用最早的两个
 * tab 会互相驱逐 content，每次切换都重载出现 loading 闪烁（脏 tab 保留，
 * 无数据丢失，纯体验问题）。
 * 修复：EditorTab.lastActivated 记录最近激活序号，淘汰时保留最近使用的
 * 5 个（dirty 与 diff/conflict/plugin tab 仍受既有保护）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/plugin-host', () => ({
  emitNoteSaved: vi.fn(),
  emitNoteOpened: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitLocaleChanged: vi.fn(),
}))

import { useEditorStore } from '@/stores'
import type { EditorTab } from '@/stores/editor'

function makeTab(i: number): EditorTab {
  return {
    id: `t${i}`,
    path: `/root/f${i}.txt`,
    name: `f${i}.txt`,
    content: `content-${i}`,
    isDirty: false,
    isEdited: false,
    viewMode: 'source',
  }
}

function openTabs(count: number) {
  for (let i = 0; i < count; i++) useEditorStore.getState().addTab(makeTab(i))
}

describe('tab content LRU 淘汰（I12）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null, savingPaths: new Set() })
  })

  it('交替使用最早打开的两个 tab：其 content 被保留，淘汰的是最久未用者', () => {
    const base = Array.from({ length: 8 }, (_, i) => makeTab(i))
    // 模拟长期使用历史：t0/t1 打开最早但最近刚交替使用过，其余 tab 更久未用
    const activated = base.map((t, i) => ({ ...t, lastActivated: i < 2 ? 100 + i : i }))
    useEditorStore.setState({ tabs: activated, activeTabId: 't7', activationSeq: 110 })
    // 交替激活最早打开的两个 tab（I12 场景）
    useEditorStore.getState().setActiveTab('t0')
    useEditorStore.getState().setActiveTab('t1')

    const tab = (id: string) => useEditorStore.getState().tabs.find((t) => t.id === id)
    // 刚用过的最早 tab content 不被驱逐（旧逻辑 slice(-5) 按数组顺序会驱逐 t0）
    expect(tab('t0')?.content).toBe('content-0')
    expect(tab('t1')?.content).toBe('content-1')
    // 最久未用的 t2 被淘汰
    expect(tab('t2')?.content).toBeUndefined()
    // 最近的其余 tab 正常保留
    expect(tab('t6')?.content).toBe('content-6')
    expect(tab('t4')?.content).toBe('content-4')
  })

  it('超过上限时保留最近使用的 5 个 + 活动 tab', () => {
    openTabs(8)
    useEditorStore.getState().setActiveTab('t7') // 已是 active，addTab 设置了
    useEditorStore.getState().setActiveTab('t3')
    useEditorStore.getState().setActiveTab('t7')

    const state = useEditorStore.getState()
    const loaded = state.tabs.filter((t) => t.content !== undefined)
    // 活动 tab + 5 个 LRU = 最多 6 个保留 content（dirty 等保护可能额外保留）
    expect(loaded.length).toBeLessThanOrEqual(6)
    expect(state.tabs.find((t) => t.id === 't3')?.content).toBe('content-3')
    expect(state.tabs.find((t) => t.id === 't7')?.content).toBe('content-7')
    expect(state.tabs.find((t) => t.id === 't0')?.content).toBeUndefined()
  })

  it('dirty tab 不被淘汰（既有保护回归）', () => {
    openTabs(7)
    useEditorStore.setState({
      tabs: useEditorStore.getState().tabs.map((t) => (t.id === 't2' ? { ...t, isDirty: true } : t)),
    })
    useEditorStore.getState().setActiveTab('t0')
    useEditorStore.getState().setActiveTab('t1')

    expect(useEditorStore.getState().tabs.find((t) => t.id === 't2')?.content).toBe('content-2')
  })
})
