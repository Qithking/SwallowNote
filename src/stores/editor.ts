/**
 * Editor Store - Manages editor state
 */
import { create } from 'zustand'

export interface EditorTab {
  id: string
  path: string
  name: string
  content: string
  isDirty: boolean
  isEdited: boolean // 文件是否被编辑过
  fileSize?: string
  modifiedTime?: string
  wordCount?: number
  cursorPosition?: {
    line: number
    column: number
  }
  // View mode for markdown files: 'preview' (BlockNote) or 'source' (CodeMirror)
  viewMode: 'preview' | 'source'
}

export interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  addTab: (tab: EditorTab) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabContent: (id: string, content: string) => void
  updateTabDirty: (id: string, isDirty: boolean) => void
  updateTabEdited: (id: string, isEdited: boolean) => void
  updateCursorPosition: (id: string, line: number, column: number) => void
  toggleViewMode: () => void
  getActiveTab: () => EditorTab | undefined
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.path === tab.path)
      if (existing) {
        return { activeTabId: existing.id }
      }
      // 新打开的文件 isEdited 默认为 false, viewMode 默认为 'preview'
      return {
        tabs: [...state.tabs, { ...tab, isEdited: false, viewMode: 'preview' }],
        activeTabId: tab.id,
      }
    }),
  removeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      const newTabs = state.tabs.filter((t) => t.id !== id)
      let newActiveId = state.activeTabId
      if (state.activeTabId === id) {
        if (newTabs.length > 0) {
          newActiveId = newTabs[Math.min(index, newTabs.length - 1)].id
        } else {
          newActiveId = null
        }
      }
      return { tabs: newTabs, activeTabId: newActiveId }
    }),
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTabContent: (id, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, content, isDirty: true, isEdited: true } : t
      ),
    })),
  updateTabDirty: (id, isDirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty } : t)),
    })),
  updateTabEdited: (id, isEdited) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isEdited } : t)),
    })),
  updateCursorPosition: (id, line, column) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, cursorPosition: { line, column } } : t
      ),
    })),
  getActiveTab: () => {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId)
  },
  toggleViewMode: () =>
    set((state) => {
      const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!activeTab) return state
      return {
        tabs: state.tabs.map((t) =>
          t.id === state.activeTabId
            ? { ...t, viewMode: t.viewMode === 'preview' ? 'source' : 'preview' }
            : t
        ),
      }
    }),
}))
