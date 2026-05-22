/**
 * Editor Store - Manages editor state
 */
import { create } from 'zustand'
import { loadFileContent } from '@/lib/api'
import { writeFile, gitAutoCommit } from '@/lib/tauri'

/**
 * Count words in content, properly handling CJK (Chinese, Japanese, Korean) characters.
 * CJK characters are counted individually as words, while Latin words are counted by whitespace separation.
 */
function countWords(content: string): number {
  let count = 0
  // Match CJK ideographs (Han), Hiragana, Katakana, Hangul
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
  const cjkMatches = content.match(cjkRegex)
  if (cjkMatches) {
    count += cjkMatches.length
  }
  // Remove CJK characters and count remaining words
  const withoutCjk = content.replace(cjkRegex, ' ')
  const latinWords = withoutCjk.split(/\s+/).filter(Boolean)
  count += latinWords.length
  return count
}

export interface EditorTab {
  id: string
  path: string
  name: string
  content: string
  isDirty: boolean
  isEdited: boolean // 文件是否被编辑过
  isLoading?: boolean // 文件是否正在加载中
  hasExternalChange?: boolean // 文件被外部修改但未应用到编辑器
  fileSize?: string
  modifiedTime?: string
  wordCount?: number
  cursorPosition?: {
    line: number
    column: number
  }
  // View mode for markdown files: 'preview' (BlockNote) or 'source' (CodeMirror)
  viewMode: 'preview' | 'source'
  // Tab type: 'file' for normal files, 'diff' for git diff view
  type?: 'file' | 'diff'
  // For diff tabs: commit hash and diff content
  commitHash?: string
  diffContent?: string
}

export interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  addTab: (tab: EditorTab) => void
  openDiffTab: (filePath: string, commitHash: string, commitMessage: string) => Promise<void>
  removeTab: (id: string) => void
  removeTabs: (ids: string[]) => void
  setActiveTab: (id: string) => void
  loadTabContent: (id: string) => Promise<void>
  updateTabContent: (id: string, content: string) => void
  updateTabDirty: (id: string, isDirty: boolean) => void
  updateTabEdited: (id: string, isEdited: boolean) => void
  markExternalChange: (id: string) => void
  clearExternalChange: (id: string) => void
  updateTabPath: (oldPath: string, newPath: string, newName: string) => void
  updateCursorPosition: (id: string, line: number, column: number) => void
  toggleViewMode: () => void
  getActiveTab: () => EditorTab | undefined
  scrollToLine: (line: number) => void
  restoreTabs: (tabsData: EditorTab[], activeTabId: string | null) => void
  filterTabs: (predicate: (tab: EditorTab) => boolean) => void
  saveAllDirtyTabs: () => Promise<void>
  resetDirtyTabs: () => Promise<void>
  getDirtyTabsCount: () => number
  restoreTabsState: () => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) => {
    set((state) => {
      const existing = state.tabs.find((t) => t.path === tab.path)
      if (existing) {
        // If same path exists, always reuse the existing tab's id for consistency
        if (!existing.content && tab.content) {
          return {
            tabs: state.tabs.map((t) =>
              t.path === tab.path
                ? {
                    ...t,
                    content: tab.content,
                    fileSize: tab.fileSize,
                    modifiedTime: tab.modifiedTime,
                    wordCount: tab.wordCount,
                  }
                : t
            ),
            activeTabId: existing.id,
          }
        }
        return { activeTabId: existing.id }
      }
      const newTabs = [...state.tabs, { ...tab, isDirty: false, isEdited: false, viewMode: 'preview' as const }]
      return {
        tabs: newTabs,
        activeTabId: tab.id,
      }
    })
  },
  openDiffTab: async (filePath: string, commitHash: string, commitMessage: string) => {
    const { gitShowDiff } = await import('@/lib/tauri')
    const diffContent = await gitShowDiff(filePath, commitHash)
    
    const diffTabId = `diff-${filePath}-${commitHash}`
    const shortHash = commitHash.slice(0, 7)
    const shortMessage = commitMessage.length > 20 ? `${commitMessage.slice(0, 20)}...` : commitMessage
    
    set((state) => {
      const existing = state.tabs.find((t) => t.id === diffTabId)
      if (existing) {
        return { activeTabId: existing.id }
      }
      
      const newTab: EditorTab = {
        id: diffTabId,
        path: filePath,
        name: `${shortMessage} (${shortHash})`,
        content: '',
        diffContent,
        isDirty: false,
        isEdited: false,
        type: 'diff',
        commitHash,
        viewMode: 'source',
      }
      
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: diffTabId,
      }
    })
  },
  removeTab: (id) => {
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
    })
  },
  removeTabs: (ids) => {
    const idSet = new Set(ids)
    set((state) => {
      const newTabs = state.tabs.filter((t) => !idSet.has(t.id))
      let newActiveId = state.activeTabId
      if (newActiveId && idSet.has(newActiveId)) {
        newActiveId = newTabs.length > 0 ? newTabs[0].id : null
      }
      return { tabs: newTabs, activeTabId: newActiveId }
    })
  },
  setActiveTab: (id) => {
    set({ activeTabId: id })
  },
  loadTabContent: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.content || tab.isLoading) return

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isLoading: true } : t
      ),
    }))

    try {
      const content = await loadFileContent(tab.path)
      const cursorPosition = tab.cursorPosition || { line: 1, column: 1 }
      // Get actual file modification time from backend
      let modifiedTime = new Date().toLocaleString()
      try {
        const { getFileMetadata } = await import('@/lib/tauri')
        const metadata = await getFileMetadata(tab.path)
        if (metadata?.modified_time) {
          modifiedTime = metadata.modified_time
        }
      } catch {}
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content,
                isLoading: false,
                fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
                modifiedTime,
                wordCount: countWords(content),
                cursorPosition,
              }
            : t
        ),
      }))
    } catch (e) {
      console.error('Failed to load tab content:', e)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, isLoading: false } : t
        ),
      }))
      window.dispatchEvent(new CustomEvent('tab-load-error', {
        detail: { id, path: tab.path, name: tab.name }
      }))
    }
  },
  updateTabContent: (id, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t
        // 只有内容真正变化时才标记为 dirty
        if (t.content === content) return t
        return { ...t, content, isDirty: true, isEdited: true }
      }),
    })),
  updateTabDirty: (id, isDirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty } : t)),
    })),
  updateTabEdited: (id, isEdited) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isEdited } : t)),
    })),
  markExternalChange: (id: string) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasExternalChange: true } : t)),
    })),
  clearExternalChange: (id: string) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasExternalChange: false } : t)),
    })),
  updateTabPath: (oldPath, newPath, newName) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        // Update tabs whose path starts with oldPath (handles both file and directory moves)
        t.path === oldPath
          ? { ...t, path: newPath, name: newName }
          : t.path.startsWith(oldPath + '/')
            ? { ...t, path: newPath + t.path.slice(oldPath.length), name: newName || t.name }
            : t
      ),
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
  scrollToLine: (line: number) => {
    // 触发窗口事件让编辑器滚动
    window.dispatchEvent(new CustomEvent('scroll-to-line', { detail: { line } }))
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
  restoreTabs: (tabsData, activeTabId) =>
    set({ tabs: tabsData, activeTabId }),
  filterTabs: (predicate) =>
    set((state) => {
      const keptTabs = state.tabs.filter(predicate)
      if (keptTabs.length === state.tabs.length) return state
      
      const keptIds = new Set(keptTabs.map(t => t.id))
      let newActiveId = state.activeTabId
      
      if (state.activeTabId && !keptIds.has(state.activeTabId)) {
        newActiveId = keptTabs.length > 0 ? keptTabs[0].id : null
      }
      
      return { tabs: keptTabs, activeTabId: newActiveId }
    }),
  saveAllDirtyTabs: async () => {
    const dirtyTabs = get().tabs.filter((t) => t.isDirty)
    for (const tab of dirtyTabs) {
      try {
        await writeFile(tab.path, tab.content)
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, isDirty: false, isEdited: false } : t
          ),
        }))
        // Auto commit if file is in a git repo (async, non-blocking)
        try {
          await gitAutoCommit(tab.path)
        } catch {}
        window.dispatchEvent(new CustomEvent('file-saved', { detail: { path: tab.path } }))
      } catch (e) {
        console.error('Failed to save tab:', tab.path, e)
        window.dispatchEvent(new CustomEvent('save-error', { detail: { path: tab.path, error: e } }))
      }
    }
  },
  resetDirtyTabs: async () => {
    const dirtyTabs = get().tabs.filter((t) => t.isDirty && t.type !== 'diff')
    for (const tab of dirtyTabs) {
      try {
        const content = await loadFileContent(tab.path)
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, content, isDirty: false, isEdited: false } : t
          ),
        }))
      } catch (e) {
        console.error('Failed to reset dirty tab:', tab.path, e)
        // Fallback: just mark as not dirty even though content couldn't be reloaded
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, isDirty: false, isEdited: false } : t
          ),
        }))
      }
    }
  },
  getDirtyTabsCount: () => {
    return get().tabs.filter((t) => t.isDirty).length
  },
  restoreTabsState: async () => {
    const { getSessionState, pathExists } = await import('@/lib/tauri')
    try {
      const state = await getSessionState()
      if (state.tabs) {
        const tabs: EditorTab[] = JSON.parse(state.tabs)
        const validTabs: EditorTab[] = []
        for (const tab of tabs) {
          if (tab.path && tab.path.trim()) {
            const exists = await pathExists(tab.path)
            if (exists) {
              validTabs.push({
                ...tab,
                content: tab.content || '',
                isDirty: tab.isDirty ?? false,
                isEdited: tab.isEdited ?? false,
                type: tab.type || 'file',
                viewMode: tab.viewMode || 'preview',
              })
            }
          }
        }
        const activeTabId = (validTabs.find(t => t.id === state.activeTabId)?.id) || (validTabs.length > 0 ? validTabs[0].id : null)
        set({ tabs: validTabs, activeTabId })
      }
    } catch (e) {
      console.error('Failed to restore tabs state:', e)
    }
  },
}))
