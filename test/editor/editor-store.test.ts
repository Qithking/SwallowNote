import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEditorStore, EditorTab } from '@/stores/editor'

vi.mock('@/lib/api', () => ({
  loadFileContent: vi.fn().mockResolvedValue('# Test Note'),
}))

vi.mock('@/lib/tauri', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/plugin-host', () => ({
  emitNoteOpened: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitNoteChanged: vi.fn(),
  emitNoteSaved: vi.fn(),
}))

describe('TC-010: Markdown基础编辑测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createTestTab = (id: string, path: string, content: string = ''): EditorTab => ({
    id,
    path,
    name: path.split('/').pop() || path,
    content,
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
  })

  it('TC-010-01: 创建新笔记并设置内容', () => {
    const store = useEditorStore.getState()
    const testTab = createTestTab('tab-1', '/workspace/test.md')
    
    store.addTab(testTab)
    
    const activeTab = useEditorStore.getState().getActiveTab()
    expect(activeTab?.id).toBe('tab-1')
    expect(activeTab?.path).toBe('/workspace/test.md')
    expect(activeTab?.viewMode).toBe('preview')
  })

  it('TC-010-02: 更新笔记内容', () => {
    const store = useEditorStore.getState()
    const testTab = createTestTab('tab-1', '/workspace/test.md', '# Initial Content')
    store.addTab(testTab)
    
    store.updateTabContent('tab-1', '# Updated Content\n\nThis is a paragraph.')
    
    const updatedTab = useEditorStore.getState().getActiveTab()
    expect(updatedTab?.content).toBe('# Updated Content\n\nThis is a paragraph.')
    expect(updatedTab?.isDirty).toBe(true)
    expect(updatedTab?.isEdited).toBe(true)
  })

  it('TC-010-03: 内容变化时标记为dirty', () => {
    const store = useEditorStore.getState()
    const testTab = createTestTab('tab-1', '/workspace/test.md', 'original')
    store.addTab(testTab)
    
    expect(useEditorStore.getState().getActiveTab()?.isDirty).toBe(false)
    
    store.updateTabContent('tab-1', 'modified')
    
    expect(useEditorStore.getState().getActiveTab()?.isDirty).toBe(true)
  })

  it('TC-010-04: 相同内容不标记为dirty', () => {
    const store = useEditorStore.getState()
    const testTab = createTestTab('tab-1', '/workspace/test.md', 'same content')
    store.addTab(testTab)
    
    store.updateTabContent('tab-1', 'same content')
    
    expect(useEditorStore.getState().getActiveTab()?.isDirty).toBe(false)
  })

  it('TC-010-05: 切换视图模式', () => {
    const store = useEditorStore.getState()
    const testTab = createTestTab('tab-1', '/workspace/test.md')
    store.addTab(testTab)
    
    expect(useEditorStore.getState().getActiveTab()?.viewMode).toBe('preview')
    
    store.toggleViewMode()
    
    expect(useEditorStore.getState().getActiveTab()?.viewMode).toBe('source')
    
    store.toggleViewMode()
    
    expect(useEditorStore.getState().getActiveTab()?.viewMode).toBe('preview')
  })

  it('TC-010-06: 获取dirty标签数量', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/test1.md'))
    store.addTab(createTestTab('tab-2', '/workspace/test2.md'))
    
    expect(useEditorStore.getState().getDirtyTabsCount()).toBe(0)
    
    store.updateTabContent('tab-1', 'modified content')
    
    expect(useEditorStore.getState().getDirtyTabsCount()).toBe(1)
    
    store.updateTabContent('tab-2', 'modified content')
    
    expect(useEditorStore.getState().getDirtyTabsCount()).toBe(2)
  })
})

describe('TC-011: 编辑器标签管理测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createTestTab = (id: string, path: string): EditorTab => ({
    id,
    path,
    name: path.split('/').pop() || path,
    content: '',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
  })

  it('TC-011-01: 打开多个标签页', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/note1.md'))
    store.addTab(createTestTab('tab-2', '/workspace/note2.md'))
    store.addTab(createTestTab('tab-3', '/workspace/note3.md'))
    
    const state = useEditorStore.getState()
    expect(state.tabs.length).toBe(3)
    expect(state.activeTabId).toBe('tab-3')
  })

  it('TC-011-02: 切换活动标签', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/note1.md'))
    store.addTab(createTestTab('tab-2', '/workspace/note2.md'))
    
    expect(useEditorStore.getState().activeTabId).toBe('tab-2')
    
    store.setActiveTab('tab-1')
    
    const state = useEditorStore.getState()
    expect(state.activeTabId).toBe('tab-1')
    expect(state.getActiveTab()?.path).toBe('/workspace/note1.md')
  })

  it('TC-011-03: 关闭标签页', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/note1.md'))
    store.addTab(createTestTab('tab-2', '/workspace/note2.md'))
    store.addTab(createTestTab('tab-3', '/workspace/note3.md'))
    
    expect(useEditorStore.getState().tabs.length).toBe(3)
    
    store.removeTab('tab-2')
    
    const state = useEditorStore.getState()
    expect(state.tabs.length).toBe(2)
    expect(state.tabs.find(t => t.id === 'tab-2')).toBeUndefined()
  })

  it('TC-011-04: 关闭活动标签后切换到相邻标签', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/note1.md'))
    store.addTab(createTestTab('tab-2', '/workspace/note2.md'))
    store.addTab(createTestTab('tab-3', '/workspace/note3.md'))
    
    store.setActiveTab('tab-2')
    expect(useEditorStore.getState().activeTabId).toBe('tab-2')
    
    store.removeTab('tab-2')
    
    expect(useEditorStore.getState().activeTabId).toBe('tab-3')
  })

  it('TC-011-05: 关闭最后一个标签', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/note1.md'))
    
    const state1 = useEditorStore.getState()
    expect(state1.tabs.length).toBe(1)
    expect(state1.activeTabId).toBe('tab-1')
    
    store.removeTab('tab-1')
    
    const state2 = useEditorStore.getState()
    expect(state2.tabs.length).toBe(0)
    expect(state2.activeTabId).toBeNull()
  })

  it('TC-011-06: 打开相同路径的文件复用标签', () => {
    const store = useEditorStore.getState()
    
    store.addTab(createTestTab('tab-1', '/workspace/same.md'))
    store.addTab(createTestTab('tab-2', '/workspace/same.md'))
    
    const state = useEditorStore.getState()
    expect(state.tabs.length).toBe(1)
    expect(state.activeTabId).toBe('tab-1')
  })
})

describe('TC-012: 编辑器状态恢复测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-012-01: 恢复标签状态', () => {
    const store = useEditorStore.getState()
    const tabs: EditorTab[] = [
      { id: 'tab-1', path: '/workspace/note1.md', name: 'note1.md', content: '# Note 1', isDirty: false, isEdited: false, viewMode: 'preview' },
      { id: 'tab-2', path: '/workspace/note2.md', name: 'note2.md', content: '# Note 2', isDirty: true, isEdited: true, viewMode: 'source' },
    ]
    
    store.restoreTabs(tabs, 'tab-2')
    
    const state = useEditorStore.getState()
    expect(state.tabs.length).toBe(2)
    expect(state.activeTabId).toBe('tab-2')
    expect(state.tabs[1].isDirty).toBe(true)
    expect(state.tabs[1].viewMode).toBe('source')
  })

  it('TC-012-02: 过滤标签', () => {
    const store = useEditorStore.getState()
    
    store.addTab({ id: 'tab-1', path: '/workspace/note1.md', name: 'note1.md', content: '', isDirty: false, isEdited: false, viewMode: 'preview' })
    store.addTab({ id: 'tab-2', path: '/workspace/note2.md', name: 'note2.md', content: '', isDirty: false, isEdited: false, viewMode: 'preview' })
    store.addTab({ id: 'tab-3', path: '/workspace/note3.md', name: 'note3.md', content: '', isDirty: false, isEdited: false, viewMode: 'preview' })
    
    store.updateTabContent('tab-2', 'modified content')
    
    const stateBefore = useEditorStore.getState()
    expect(stateBefore.tabs.length).toBe(3)
    expect(stateBefore.tabs.find(t => t.id === 'tab-2')?.isDirty).toBe(true)
    
    useEditorStore.getState().filterTabs(t => t.isDirty)
    
    const state = useEditorStore.getState()
    expect(state.tabs.length).toBe(1)
    expect(state.tabs[0].id).toBe('tab-2')
  })
})
