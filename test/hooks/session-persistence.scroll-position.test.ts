/**
 * Integration test: scrollTop save → persist → restore cycle.
 *
 * Reproduces bug: "应用退出时还是没有保存当前打开的tab下scrollTop。
 *                   再次打开应用tab没有恢复到之前的位置。"
 *
 * The test exercises the same code paths as the App.tsx close-requested
 * handler (readActiveEditorScrollTop + updateScrollTop + saveSessionStateNow)
 * and the useSessionPersistence restore path (restoreSessionState).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorStore, setEditorContainerEl, readActiveEditorScrollTop, type EditorTab } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/filetree'
import { useWorkspaceStore } from '@/stores/workspace'

// Capture saved session state so we can feed it back to getSessionState.
let savedSessionState: Record<string, string> = {}

vi.mock('@/lib/tauri', () => ({
  saveSessionState: vi.fn(async (states: Record<string, string>) => {
    savedSessionState = { ...states }
  }),
  getSessionState: vi.fn(async () => savedSessionState),
  loadFileContent: vi.fn().mockResolvedValue('hello world'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  gitAutoCommit: vi.fn().mockResolvedValue(undefined),
  getFileMetadata: vi.fn().mockResolvedValue({ modified_time: '', size: 0 }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    isFullscreen: vi.fn().mockResolvedValue(false),
    innerSize: vi.fn().mockResolvedValue({ width: 1000, height: 700 }),
    scaleFactor: vi.fn().mockResolvedValue(1),
    outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  }),
  availableMonitors: vi.fn().mockResolvedValue([]),
}))

import { useSessionPersistence } from '@/hooks/useSessionPersistence'
import { saveSessionState, getSessionState } from '@/lib/tauri'

const mockedSaveSessionState = vi.mocked(saveSessionState)
const mockedGetSessionState = vi.mocked(getSessionState)

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    path: '/tmp/note.md',
    name: 'note.md',
    content: 'hello world',
    isDirty: false,
    isEdited: false,
    viewMode: 'preview',
    ...overrides,
  }
}

describe('scrollTop save → persist → restore cycle', () => {
  beforeEach(() => {
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
    useFileTreeStore.getState().clearAll()
    useWorkspaceStore.getState().setRootPath('/tmp')
    savedSessionState = {}
    vi.clearAllMocks()
    // Re-seed the mocks after clearAllMocks
    mockedSaveSessionState.mockImplementation(async (states: Record<string, string>) => {
      savedSessionState = { ...states }
    })
    mockedGetSessionState.mockImplementation(async () => savedSessionState)
  })

  it('persists scrollTop when close handler saves it (save path)', async () => {
    // 1. Set up a tab with content
    const tab = makeTab({ id: 'tab-1', path: '/tmp/note.md', content: 'hello' })
    useEditorStore.getState().addTab(tab)

    // 2. Set up editorContainerEl with viewport at scrollTop=250
    const container = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-radix-scroll-area-viewport', '')
    Object.defineProperty(viewport, 'scrollTop', { value: 250, configurable: true, writable: true })
    container.appendChild(viewport)
    setEditorContainerEl(container)

    // 3. Simulate close-requested handler's save logic
    const activeId = useEditorStore.getState().activeTabId
    expect(activeId).toBe('tab-1')
    const top = readActiveEditorScrollTop()
    expect(top).toBe(250)
    if (top != null && top > 0) {
      useEditorStore.getState().updateScrollTop(activeId!, top)
    }

    // 4. Verify store has scrollTop
    const stored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(stored?.scrollTop).toBe(250)

    // 5. Call saveSessionStateNow and verify persisted data includes scrollTop
    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.saveSessionStateNow()
    })

    expect(mockedSaveSessionState).toHaveBeenCalled()
    const persistedTabs = JSON.parse(savedSessionState.tabs)
    expect(persistedTabs[0].scrollTop).toBe(250)

    setEditorContainerEl(null)
  })

  it('restores scrollTop from persisted session state (restore path)', async () => {
    // 1. Seed saved session state with scrollTop=300
    savedSessionState = {
      tabs: JSON.stringify([{
        id: 'tab-1',
        path: '/tmp/note.md',
        name: 'note.md',
        viewMode: 'preview',
        cursorPosition: { line: 1, column: 1 },
        scrollTop: 300,
      }]),
      activeTabId: 'tab-1',
    }

    // 2. Set up file tree so restoreSessionState doesn't skip
    useFileTreeStore.getState().setNodes([
      { path: '/tmp/note.md', name: 'note.md', type: 'file' } as any,
    ])

    // 3. Reset store to empty state
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })

    // 4. Call restoreSessionState
    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.restoreSessionState()
    })

    // 5. Verify restored tab has scrollTop
    const restored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(restored).toBeDefined()
    expect(restored?.scrollTop).toBe(300)
  })

  it('full cycle: save → persist → clear → restore', async () => {
    // 1. Set up a tab with scrollTop=500
    const tab = makeTab({ id: 'tab-1', path: '/tmp/note.md', content: 'hello' })
    useEditorStore.getState().addTab(tab)
    useEditorStore.getState().updateScrollTop('tab-1', 500)

    // 2. Set up file tree
    useFileTreeStore.getState().setNodes([
      { path: '/tmp/note.md', name: 'note.md', type: 'file' } as any,
    ])

    // 3. Save session state
    const { result } = renderHook(() => useSessionPersistence())
    await act(async () => {
      await result.current.saveSessionStateNow()
    })

    // 4. Verify persisted
    const persistedTabs = JSON.parse(savedSessionState.tabs)
    expect(persistedTabs[0].scrollTop).toBe(500)

    // 5. Clear store
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })

    // 6. Restore
    await act(async () => {
      await result.current.restoreSessionState()
    })

    // 7. Verify restored
    const restored = useEditorStore.getState().tabs.find(t => t.id === 'tab-1')
    expect(restored?.scrollTop).toBe(500)
  })
})
