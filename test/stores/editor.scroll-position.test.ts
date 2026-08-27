import { describe, it, expect, beforeEach } from 'vitest'
import {
  useEditorStore,
  EditorTab,
  setEditorContainerEl,
  readActiveEditorScrollTop,
  setLastScrollTop,
  getLastScrollTopForTab,
  clearLastScrollTopCache,
} from '@/stores/editor'

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    path: '/tmp/note.md',
    name: 'note.md',
    content: '',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    ...overrides,
  }
}

describe('EditorTab.scrollTop field', () => {
  beforeEach(() => {
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
    clearLastScrollTopCache()
  })

  it('updateScrollTop sets scrollTop on the specified tab', () => {
    const tab = makeTab()
    useEditorStore.getState().addTab(tab)
    useEditorStore.getState().updateScrollTop('tab-1', 250)
    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBe(250)
  })

  it('updateScrollTop does not affect other tabs', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    const tab2 = makeTab({ id: 'tab-2', path: '/tmp/b.md' })
    useEditorStore.getState().addTab(tab1)
    useEditorStore.getState().addTab(tab2)
    useEditorStore.getState().updateScrollTop('tab-1', 100)
    useEditorStore.getState().updateScrollTop('tab-2', 200)
    useEditorStore.getState().updateScrollTop('tab-1', 999)
    const stored2 = useEditorStore.getState().tabs.find(t => t.id === 'tab-2')
    expect(stored2?.scrollTop).toBe(200)
  })

  it('updateScrollTop on non-existent tab is a no-op', () => {
    const tab = makeTab()
    useEditorStore.getState().addTab(tab)
    useEditorStore.getState().updateScrollTop('non-existent', 500)
    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBeUndefined()
  })

  it('updateScrollTop preserves other tab fields', () => {
    const tab = makeTab({ cursorPosition: { line: 5, column: 10 } })
    useEditorStore.getState().addTab(tab)
    useEditorStore.getState().updateScrollTop('tab-1', 300)
    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.cursorPosition).toEqual({ line: 5, column: 10 })
    expect(stored?.scrollTop).toBe(300)
  })
})

describe('setActiveTab saves scrollTop before switching', () => {
  beforeEach(() => {
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
    clearLastScrollTopCache()
  })

  it('saves current scrollTop to prev tab when switching to another tab', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    const tab2 = makeTab({ id: 'tab-2', path: '/tmp/b.md' })
    useEditorStore.getState().addTab(tab1)
    useEditorStore.getState().addTab(tab2)
    useEditorStore.getState().setActiveTab('tab-1')

    // 创建带 viewport 的容器
    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 250, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    useEditorStore.getState().setActiveTab('tab-2')

    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBe(250)

    setEditorContainerEl(null)
  })

  it('does not save scrollTop when switching to the same tab', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)

    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 250, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    useEditorStore.getState().setActiveTab('tab-1')

    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBeUndefined()

    setEditorContainerEl(null)
  })

  it('does not save scrollTop=0', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    const tab2 = makeTab({ id: 'tab-2', path: '/tmp/b.md' })
    useEditorStore.getState().addTab(tab1)
    useEditorStore.getState().addTab(tab2)
    useEditorStore.getState().setActiveTab('tab-1')

    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    useEditorStore.getState().setActiveTab('tab-2')

    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBeUndefined()

    setEditorContainerEl(null)
  })
})

describe('addTab saves scrollTop before switching active tab', () => {
  beforeEach(() => {
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
    clearLastScrollTopCache()
  })

  it('saves current scrollTop to prev active tab when opening a new file via addTab', () => {
    // 场景：用户在 tab-1 中滚动到 250px，然后通过文件树打开 tab-2（调用 addTab 而非 setActiveTab）
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)
    // addTab 会自动设置 activeTabId 为 tab-1

    // 模拟编辑器容器，viewport scrollTop = 250
    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 250, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    // 通过 addTab 打开新文件（模拟文件树点击）
    const tab2 = makeTab({ id: 'tab-2', path: '/tmp/b.md' })
    useEditorStore.getState().addTab(tab2)

    // tab-1 的 scrollTop 应当被保存
    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBe(250)

    setEditorContainerEl(null)
  })

  it('saves current scrollTop when opening existing file via addTab (same path)', () => {
    // 场景：用户在 tab-1 中滚动，然后通过文件树点击已打开的 tab-2
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    const tab2 = makeTab({ id: 'tab-2', path: '/tmp/b.md', content: 'existing' })
    useEditorStore.getState().addTab(tab1)
    useEditorStore.getState().addTab(tab2)
    // 现在 activeTabId 是 tab-2，切回 tab-1
    useEditorStore.getState().setActiveTab('tab-1')

    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 300, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    // 通过 addTab 切换到已存在的 tab-2（模拟文件树点击已打开的文件）
    useEditorStore.getState().addTab({ ...tab2 })

    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBe(300)

    setEditorContainerEl(null)
  })
})

describe('scrollTop cache fallback (DOM unavailable)', () => {
  beforeEach(() => {
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
    setEditorContainerEl(null)
    clearLastScrollTopCache()
  })

  it('getLastScrollTopForTab returns null when no cache set', () => {
    expect(getLastScrollTopForTab('tab-1')).toBeNull()
  })

  it('getLastScrollTopForTab returns cached value when tabId matches', () => {
    setLastScrollTop('tab-1', 420)
    expect(getLastScrollTopForTab('tab-1')).toBe(420)
  })

  it('getLastScrollTopForTab returns null when tabId does not match', () => {
    setLastScrollTop('tab-1', 420)
    expect(getLastScrollTopForTab('tab-2')).toBeNull()
  })

  it('readActiveEditorScrollTop falls back to cache when editorContainerEl is null', () => {
    // 场景：应用退出时 React 已卸载 Editor，editorContainerEl 变为 null
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)
    // activeTabId 现在是 tab-1

    // 模拟 scroll 监听器已记录的缓存值
    setLastScrollTop('tab-1', 380)
    // editorContainerEl 为 null（已在 beforeEach 中设置）

    const top = readActiveEditorScrollTop()
    expect(top).toBe(380)
  })

  it('readActiveEditorScrollTop falls back to cache when DOM viewport missing', () => {
    // 场景：容器存在但 viewport 还未渲染（编辑器异步 mount）
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)

    const container = document.createElement('div')
    // 容器内没有任何 viewport 子元素
    setEditorContainerEl(container)

    setLastScrollTop('tab-1', 512)

    const top = readActiveEditorScrollTop()
    expect(top).toBe(512)

    setEditorContainerEl(null)
  })

  it('readActiveEditorScrollTop falls back to cache when DOM scrollTop is 0', () => {
    // 场景：DOM 存在但 scrollTop 读到 0（CodeEditor remount 后尚未恢复）
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)

    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 0, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    setLastScrollTop('tab-1', 270)

    const top = readActiveEditorScrollTop()
    expect(top).toBe(270)

    setEditorContainerEl(null)
  })

  it('readActiveEditorScrollTop returns DOM value when scrollTop > 0 (cache not used)', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)

    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 180, configurable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    // 缓存值与 DOM 不同，应返回 DOM 值
    setLastScrollTop('tab-1', 999)

    const top = readActiveEditorScrollTop()
    expect(top).toBe(180)

    setEditorContainerEl(null)
  })

  it('readActiveEditorScrollTop returns null when no active tab and no cache', () => {
    useEditorStore.setState({ activeTabId: null })
    expect(readActiveEditorScrollTop()).toBeNull()
  })

  it('readActiveEditorScrollTop returns null when cache tabId mismatches active tab', () => {
    const tab1 = makeTab({ id: 'tab-1', path: '/tmp/a.md' })
    useEditorStore.getState().addTab(tab1)
    // activeTabId 是 tab-1，但缓存是 tab-2 的
    setLastScrollTop('tab-2', 500)

    const top = readActiveEditorScrollTop()
    expect(top).toBeNull()
  })
})
