/**
 * useKeyboardShortcuts 查找/替换快捷键测试
 * Source: plan/editor-find-replace step 10
 *
 * AC-9: Ctrl+F 切换 FindReplacePanel 显隐
 * - searchPanel 默认改为 Ctrl+Shift+F(全局搜索)
 * - 新增 findReplace 快捷键 Ctrl+F → dispatch editor:toggle-find-replace
 * - 移除 CodeMirror 内不拦截逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: () => null,
}))

import { DEFAULT_SHORTCUTS_MAP, getShortcutKey } from '@/lib/shortcuts'
import { dispatchBuiltin, handleToggleSearch } from '@/hooks/useKeyboardShortcuts'
import { useUIStore } from '@/stores/ui'

function fakeKeyEvent(shortcut: string, keyOverrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const parts = shortcut.split('+')
  const mainKey = parts[parts.length - 1]
  const ctrl = parts.includes('Ctrl') || parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  return {
    key: mainKey,
    ctrlKey: ctrl,
    metaKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    preventDefault: vi.fn(),
    target: null,
    ...keyOverrides,
  } as unknown as KeyboardEvent
}

describe('useKeyboardShortcuts find/replace (Step 10)', () => {
  let toggleHandler: ((e: Event) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    toggleHandler = null
    useUIStore.setState({ pluginCommandShortcuts: {}, customShortcuts: {} })
  })

  afterEach(() => {
    if (toggleHandler) {
      window.removeEventListener('editor:toggle-find-replace', toggleHandler)
    }
  })

  it('searchPanel 默认快捷键应为 Ctrl+Shift+F', () => {
    expect(DEFAULT_SHORTCUTS_MAP['searchPanel']).toBe('Ctrl+Shift+F')
  })

  it('findReplace 快捷键应存在且默认为 Ctrl+F', () => {
    expect(DEFAULT_SHORTCUTS_MAP['findReplace']).toBe('Ctrl+F')
  })

  it('Ctrl+F 应匹配 findReplace 快捷键并派发 editor:toggle-find-replace', () => {
    const spy = vi.fn()
    window.addEventListener('editor:toggle-find-replace', spy)

    const handler = () => {
      window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
    }
    const e = fakeKeyEvent('Ctrl+F')
    const matched = dispatchBuiltin(e, 'findReplace', handler)

    expect(matched).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()

    window.removeEventListener('editor:toggle-find-replace', spy)
  })

  it('Ctrl+Shift+F 应匹配 searchPanel(全局搜索),不再匹配 findReplace', () => {
    const e = fakeKeyEvent('Ctrl+Shift+F')
    const findReplaceHandler = vi.fn()
    const matchedFindReplace = dispatchBuiltin(e, 'findReplace', findReplaceHandler)
    expect(matchedFindReplace).toBe(false)
    expect(findReplaceHandler).not.toHaveBeenCalled()
  })

  it('Ctrl+F 不再匹配 searchPanel(语义已改为全局搜索)', () => {
    const e = fakeKeyEvent('Ctrl+F')
    const searchHandler = vi.fn()
    const matchedSearch = dispatchBuiltin(e, 'searchPanel', searchHandler)
    expect(matchedSearch).toBe(false)
    expect(searchHandler).not.toHaveBeenCalled()
  })

  it('handleToggleSearch 仍能正常切换侧边栏 search 视图', () => {
    const setSidebarView = vi.fn()
    const setSidebarVisible = vi.fn()
    useUIStore.setState({
      sidebarView: 'explorer',
      sidebarVisible: true,
      settingsPanelVisible: false,
      setSidebarView,
      setSidebarVisible,
    } as any)

    handleToggleSearch()

    expect(setSidebarView).toHaveBeenCalledWith('search')
  })
})
