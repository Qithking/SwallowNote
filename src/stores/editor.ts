/**
 * Editor Store - Manages editor state
 */
import { create } from 'zustand'
import { loadFileContent } from '@/lib/api'
import { writeFile, gitAutoCommit } from '@/lib/tauri'
import { emitNoteChanged, emitNoteClosed, emitNoteOpened, emitNoteSaved } from '@/lib/plugin-host'
import { countWords } from '@/lib/utils/wordCount'
import { parseFrontmatter, serializeFrontmatter, stripFrontmatter } from '@/lib/utils/frontmatter'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'

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
  // Tab type: 'file' for normal files, 'diff' for git diff view, 'conflict' for conflict resolution
  type?: 'file' | 'diff' | 'conflict'
  // For diff tabs: commit hash and diff content
  commitHash?: string
  diffContent?: string
  // For conflict tabs: conflict info
  conflictRepoPath?: string
  conflictRepoName?: string
  // For conflict tabs: whether to auto-hide the file tree on open
  conflictAutoHideTree?: boolean
  // For conflict tabs: the currently selected conflict file (relative path within repo)
  conflictSelectedFile?: string
  // For conflict tabs: cursor line number in the local editor
  conflictCursorLine?: number
  /** 缓存的 frontmatter 数据（仅 .md 文件） */
  frontmatter?: NoteFrontmatter
  /** 属性面板编辑导致的脏状态，与编辑器内容脏状态独立 */
  frontmatterDirty?: boolean
}

export interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  /** Set of file paths currently being saved (to ignore file-watcher remove events during atomic writes) */
  savingPaths: Set<string>
  addTab: (tab: EditorTab) => void
  openDiffTab: (filePath: string, commitHash: string, commitMessage: string) => Promise<void>
  openConflictTab: (repoPath: string, repoName: string, options?: { autoSelectFile?: string; autoHideTree?: boolean }) => void
  removeTab: (id: string) => void
  removeTabs: (ids: string[]) => void
  setActiveTab: (id: string) => void
  loadTabContent: (id: string, retryCount?: number, force?: boolean) => Promise<void>
  updateTabContent: (id: string, content: string) => void
  updateTabDirty: (id: string, isDirty: boolean) => void
  updateTabEdited: (id: string, isEdited: boolean) => void
  markExternalChange: (id: string) => void
  clearExternalChange: (id: string) => void
  updateTabPath: (oldPath: string, newPath: string, newName: string) => void
  updateCursorPosition: (id: string, line: number, column: number) => void
  updateConflictTabState: (id: string, selectedFile: string | undefined, cursorLine: number | undefined) => void
  toggleViewMode: () => void
  getActiveTab: () => EditorTab | undefined
  scrollToLine: (line: number) => void
  insertAtCursor: (text: string) => void
  replaceContent: (text: string) => void
  restoreTabs: (tabsData: EditorTab[], activeTabId: string | null) => void
  filterTabs: (predicate: (tab: EditorTab) => boolean) => void
  saveAllDirtyTabs: () => Promise<void>
  resetDirtyTabs: () => Promise<void>
  getDirtyTabsCount: () => number
  isPathSaving: (path: string) => boolean
  updateTabFrontmatter: (tabId: string, data: Partial<NoteFrontmatter>) => void
  /** Replace the entire frontmatter object (used for deleting keys) */
  replaceTabFrontmatter: (tabId: string, data: NoteFrontmatter) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  savingPaths: new Set<string>(),
  addTab: (tab) => {
    set((state) => {
      const existing = state.tabs.find((t) => t.path === tab.path)
      if (existing) {
        // If same path exists, always reuse the existing tab's id for consistency.
        // Only update content when existing tab hasn't been loaded yet (undefined).
        // Using === undefined instead of !content to avoid overwriting empty files ('').
        if (existing.content === undefined && tab.content !== undefined) {
          // For .md files, parse frontmatter from the content
          const isMarkdown = tab.path.toLowerCase().endsWith('.md')
          let content = tab.content
          let frontmatter = existing.frontmatter
          if (isMarkdown) {
            const result = parseFrontmatter(tab.content)
            frontmatter = result.data
            content = result.body
          }
          return {
            tabs: state.tabs.map((t) =>
              t.path === tab.path
                ? {
                    ...t,
                    content,
                    frontmatter,
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
      // For new .md tabs, parse frontmatter from content if present
      const isMarkdown = tab.path.toLowerCase().endsWith('.md')
      let newTab = { ...tab, isDirty: false, isEdited: false, viewMode: 'preview' as const }
      if (isMarkdown && tab.content !== undefined) {
        const result = parseFrontmatter(tab.content)
        newTab.content = result.body
        newTab.frontmatter = result.data
      }
      const newTabs = [...state.tabs, newTab]
      // Notify plugins: a fresh tab was opened. We emit after set so the
      // store update is committed before subscribers (which may read
      // `state.tabs` from a parent store snapshot) observe the event.
      queueMicrotask(() => emitNoteOpened(tab.id, tab.path))
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
  openConflictTab: (repoPath: string, repoName: string, options?: { autoSelectFile?: string; autoHideTree?: boolean }) => {
    const conflictTabId = `conflict-${repoPath}`
    
    set((state) => {
      const existing = state.tabs.find((t) => t.id === conflictTabId)
      if (existing) {
        // If tab already exists, update auto-hide and auto-select if provided
        const updatedTab = { ...existing }
        if (options?.autoHideTree !== undefined) updatedTab.conflictAutoHideTree = options.autoHideTree
        if (options?.autoSelectFile !== undefined) updatedTab.conflictSelectedFile = options.autoSelectFile
        return {
          tabs: state.tabs.map((t) => t.id === conflictTabId ? updatedTab : t),
          activeTabId: conflictTabId,
        }
      }
      
      const newTab: EditorTab = {
        id: conflictTabId,
        path: repoPath,
        name: `⚠ ${repoName}`,
        content: '',
        isDirty: false,
        isEdited: false,
        type: 'conflict',
        conflictRepoPath: repoPath,
        conflictRepoName: repoName,
        conflictAutoHideTree: options?.autoHideTree ?? false,
        conflictSelectedFile: options?.autoSelectFile,
        viewMode: 'source',
      }
      
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: conflictTabId,
      }
    })
  },
  removeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      // Capture the tab being removed so we can emit a `note:close`
      // after the state update commits. We do NOT emit if the tab
      // doesn't exist (e.g. already removed) – that would generate
      // spurious close events for plugins tracking active notes.
      const removedTab = index >= 0 ? state.tabs[index] : null
      const newTabs = state.tabs.filter((t) => t.id !== id)
      let newActiveId = state.activeTabId
      if (state.activeTabId === id) {
        if (newTabs.length > 0) {
          newActiveId = newTabs[Math.min(index, newTabs.length - 1)].id
        } else {
          newActiveId = null
        }
      }
      if (removedTab) {
        queueMicrotask(() => emitNoteClosed(removedTab.id, removedTab.path))
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
    set((state) => {
      const prevActiveId = state.activeTabId
      // Release content of non-active, non-dirty file tabs to save memory
      const tabs = state.tabs.map((t) => {
        if (t.id === prevActiveId && t.id !== id && !t.isDirty && t.type !== 'diff' && t.type !== 'conflict' && t.content !== undefined) {
          return { ...t, content: undefined as unknown as string, frontmatter: undefined, isLoading: false }
        }
        return t
      })
      return { tabs, activeTabId: id }
    })
    // Auto-close noteProperties panel when switching to a non-.md file
    const newTab = get().tabs.find((t) => t.id === id)
    if (newTab && !newTab.path.toLowerCase().endsWith('.md')) {
      queueMicrotask(async () => {
        const { useUIStore } = await import('@/stores/ui')
        if (useUIStore.getState().rightPanelType === 'noteProperties') {
          useUIStore.getState().setRightPanelType(null)
        }
      })
    }
  },
  loadTabContent: async (id, retryCount = 0, force = false) => {
    const tab = get().tabs.find((t) => t.id === id)
    // Check if tab exists and needs loading
    // tab.content === undefined means not loaded yet
    // tab.content === '' means loaded but empty file
    // force=true bypasses the content check to support reload (e.g. external changes)
    if (!tab || tab.isLoading) return
    if (!force && tab.content !== undefined) return
    // Conflict and diff tabs don't have file content to load
    if (tab.type === 'conflict' || tab.type === 'diff') return

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isLoading: true } : t
      ),
    }))

    const maxRetries = 2
    const retryDelay = 500 // ms

    const tryLoadContent = async (currentRetry = retryCount): Promise<string> => {
      try {
        return await loadFileContent(tab.path)
      } catch (e) {
        if (currentRetry < maxRetries) {
          console.warn(`Failed to load tab content, retrying (${currentRetry + 1}/${maxRetries}):`, tab.path)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return tryLoadContent(currentRetry + 1)
        }
        throw e
      }
    }

    try {
      const rawContent = await tryLoadContent()
      const cursorPosition = tab.cursorPosition || { line: 1, column: 1 }
      // Get actual file modification time from backend
      let modifiedTime = new Date().toLocaleString()
      try {
        const { getFileMetadata } = await import('@/lib/tauri')
        const metadata = await getFileMetadata(tab.path)
        if (metadata?.modified_time) {
          modifiedTime = metadata.modified_time
        }
      } catch { /* ignore */ }

      // For .md files, parse frontmatter and store body as content
      const isMarkdown = tab.path.toLowerCase().endsWith('.md')
      let content: string
      let frontmatter: NoteFrontmatter | undefined
      if (isMarkdown) {
        const result = parseFrontmatter(rawContent)
        frontmatter = result.data
        content = result.body
      } else {
        content = rawContent
      }

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                content,
                frontmatter,
                isLoading: false,
                hasExternalChange: false,
                fileSize: rawContent.length > 1024 ? `${(rawContent.length / 1024).toFixed(1)}Kb` : `${rawContent.length}B`,
                modifiedTime,
                wordCount: countWords(content),
                cursorPosition,
              }
            : t
        ),
      }))
      // Emit note:change so plugins receive the initial content after load
      const loadedTab = get().tabs.find((t) => t.id === id)
      if (loadedTab) {
        queueMicrotask(() => emitNoteChanged(loadedTab.id, loadedTab.path, loadedTab.content ?? ''))
      }
    } catch (e) {
      console.error('Failed to load tab content after retries:', e)
      // Instead of closing the tab, mark it as having external change
      // This keeps the tab open and lets the user decide what to do.
      // Set content to '' (loaded but empty) to prevent EditorView useEffect
      // from infinitely retrying (content === undefined triggers reload).
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, content: '', isLoading: false, hasExternalChange: true } : t
        ),
      }))
      // Only show error dialog for initial load (when content was not loaded before)
      // Don't show for external file changes to avoid interrupting user
      if (tab.content === undefined) {
        window.dispatchEvent(new CustomEvent('tab-load-error', {
          detail: { id, path: tab.path, name: tab.name }
        }))
      }
    }
  },
  updateTabContent: (id, content) => {
    set((state) => {
      const tabs = state.tabs.map((t) => {
        if (t.id !== id) return t
        // 只有内容真正变化时才标记为 dirty
        // Note: t.content can be undefined (not loaded yet) while content might be '' (empty file)
        // Treat undefined and '' as equivalent to avoid falsely marking empty files as dirty
        const currentNormalized = t.content ?? ''
        const newNormalized = content ?? ''
        if (currentNormalized === newNormalized) return t
        return { ...t, content, isDirty: true, isEdited: true }
      })
      // Locate the tab that actually changed. The map above already
      // updated `isDirty`/`isEdited`, so we can re-read the tab from
      // the new array. We emit only on a real content transition to
      // avoid one event per keystroke that ends up a no-op due to
      // normalisation (e.g. setting '' to '' when the file is empty).
      const updated = tabs.find((t) => t.id === id)
      if (updated && (updated.content ?? '') === (content ?? '') && updated.isDirty) {
        queueMicrotask(() => emitNoteChanged(updated.id, updated.path, updated.content ?? ''))
      }
      return { tabs }
    })
  },
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
  updateConflictTabState: (id, selectedFile, cursorLine) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, conflictSelectedFile: selectedFile, conflictCursorLine: cursorLine } : t
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
  insertAtCursor: (text: string) => {
    // 触发窗口事件让编辑器在光标位置插入文本
    window.dispatchEvent(new CustomEvent('insert-at-cursor', { detail: { text } }))
  },
  replaceContent: (text: string) => {
    // 触发窗口事件让编辑器替换选中内容或整个文件内容
    window.dispatchEvent(new CustomEvent('replace-content', { detail: { text } }))
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
    const dirtyTabs = get().tabs.filter((t) => t.isDirty || t.frontmatterDirty)
    for (const tab of dirtyTabs) {
      try {
        // Mark path as saving to prevent file-watcher from closing the tab
        set((state) => {
          const newSet = new Set(state.savingPaths)
          newSet.add(tab.path)
          return { savingPaths: newSet }
        })

        // For .md files, merge frontmatter with body before writing
        const isMarkdown = tab.path.toLowerCase().endsWith('.md')
        let writeContent = tab.content
        if (isMarkdown) {
          const fm = { ...(tab.frontmatter || {}), updated: new Date().toISOString() }
          // stripFrontmatter is defensive: tab.content normally holds only
          // the body (loadTabContent strips frontmatter on load), but source
          // mode edits may store the full file content including frontmatter.
          // Calling stripFrontmatter on an already-stripped body is a no-op.
          const body = stripFrontmatter(tab.content ?? '')
          writeContent = serializeFrontmatter(fm, body)
          // Update store frontmatter to match what was written
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tab.id ? { ...t, frontmatter: fm } : t
            ),
          }))
        }

        await writeFile(tab.path, writeContent)
        // Invalidate frontmatter cache so search/file-tree use fresh data
        if (isMarkdown) {
          const { invalidateFrontmatterCache } = await import('@/lib/utils/searchQuery')
          invalidateFrontmatterCache(tab.path)
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, isDirty: false, isEdited: false, frontmatterDirty: false } : t
          ),
        }))
        // Notify plugins: a dirty tab has been successfully persisted.
        // We emit after the store commit so the `isDirty=false` state
        // is observable by subscribers reading from the store.
        queueMicrotask(() => emitNoteSaved(tab.id, tab.path))
        // Auto commit if file is in a git repo (async, non-blocking)
        try {
          await gitAutoCommit(tab.path)
        } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('file-saved', { detail: { path: tab.path } }))
      } catch (e) {
        console.error('Failed to save tab:', tab.path, e)
        window.dispatchEvent(new CustomEvent('save-error', { detail: { path: tab.path, error: e } }))
      } finally {
        // Delay removing from savingPaths to allow file-watcher events to settle
        const savedPath = tab.path
        setTimeout(() => {
          set((state) => {
            const newSet = new Set(state.savingPaths)
            newSet.delete(savedPath)
            return { savingPaths: newSet }
          })
        }, 1000)
      }
    }
  },
  resetDirtyTabs: async () => {
    const dirtyTabs = get().tabs.filter((t) => (t.isDirty || t.frontmatterDirty) && t.type !== 'diff')
    for (const tab of dirtyTabs) {
      try {
        const rawContent = await loadFileContent(tab.path)
        const isMarkdown = tab.path.toLowerCase().endsWith('.md')
        let content: string
        let frontmatter: NoteFrontmatter | undefined
        if (isMarkdown) {
          const result = parseFrontmatter(rawContent)
          frontmatter = result.data
          content = result.body
        } else {
          content = rawContent
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, content, frontmatter, isDirty: false, isEdited: false, frontmatterDirty: false }
              : t
          ),
        }))
      } catch (e) {
        console.error('Failed to reset dirty tab:', tab.path, e)
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, isDirty: false, isEdited: false, frontmatterDirty: false } : t
          ),
        }))
      }
    }
  },
  getDirtyTabsCount: () => {
    return get().tabs.filter((t) => t.isDirty || t.frontmatterDirty).length
  },
  isPathSaving: (path: string) => {
    return get().savingPaths.has(path)
  },
  updateTabFrontmatter: (tabId: string, data: Partial<NoteFrontmatter>) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, frontmatter: { ...t.frontmatter, ...data }, frontmatterDirty: true, isDirty: true, isEdited: true }
          : t
      ),
    }))
  },
  replaceTabFrontmatter: (tabId: string, data: NoteFrontmatter) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, frontmatter: data, frontmatterDirty: true, isDirty: true, isEdited: true }
          : t
      ),
    }))
  },
}))
