/**
 * Tests for useSessionAutoSave hook (extracted from App.tsx).
 * Verifies debounced auto-save on store changes and immediate save on event.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEditorStore, type EditorTab } from '@/stores/editor'
import { useUIStore } from '@/stores'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { useSessionAutoSave } from '@/hooks/useSessionAutoSave'

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

describe('useSessionAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useEditorStore.getState().tabs = []
    useEditorStore.setState({ activeTabId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls saveSessionStateNow after 500ms debounce when editor tabs change', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    useEditorStore.getState().addTab(makeTab())

    expect(saveSessionStateNow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(499)
    expect(saveSessionStateNow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(saveSessionStateNow).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('calls saveSessionStateNow after 500ms debounce when sidebar width changes', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    useUIStore.getState().setSidebarWidth(300)

    vi.advanceTimersByTime(500)
    expect(saveSessionStateNow).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('calls saveSessionStateNow after 500ms debounce when right panel width changes', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    useUIStore.getState().setRightPanelWidth(400)

    vi.advanceTimersByTime(500)
    expect(saveSessionStateNow).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('calls saveSessionStateNow immediately when save-session-now event fires', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    window.dispatchEvent(new Event('save-session-now'))
    expect(saveSessionStateNow).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('debounces multiple rapid tab changes into a single save', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    useEditorStore.getState().addTab(makeTab({ id: 'tab-1' }))
    vi.advanceTimersByTime(200)
    useEditorStore.getState().addTab(makeTab({ id: 'tab-2' }))
    vi.advanceTimersByTime(200)
    useEditorStore.getState().addTab(makeTab({ id: 'tab-3' }))

    vi.advanceTimersByTime(500)
    expect(saveSessionStateNow).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('does not call saveSessionStateNow after unmount when tabs change', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    unmount()

    useEditorStore.getState().addTab(makeTab())
    vi.advanceTimersByTime(500)
    expect(saveSessionStateNow).not.toHaveBeenCalled()
  })

  it('does not call saveSessionStateNow after unmount when save-session-now fires', () => {
    const saveSessionStateNow = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSessionAutoSave(saveSessionStateNow))

    unmount()

    window.dispatchEvent(new Event('save-session-now'))
    expect(saveSessionStateNow).not.toHaveBeenCalled()
  })
})
