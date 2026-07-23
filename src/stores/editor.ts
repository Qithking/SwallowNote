/**
 * Editor Store - Manages editor state
 */
import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ReactNode } from 'react'
import { loadFileContent } from '@/lib/api'
import { writeFile, gitAutoCommit } from '@/lib/tauri'
import { emitNoteChanged, emitNoteClosed, emitNoteOpened, emitNoteSaved } from '@/lib/plugin-host'
import { countWords } from '@/lib/utils/wordCount'
import { parseFrontmatter, serializeFrontmatter, stripFrontmatter } from '@/lib/utils/frontmatter'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'

/**
 * 编辑器工具栏配置：控制各工具栏项的显示/隐藏。
 * 未设置的字段默认显示（保持向后兼容）。插件 tab 通过此配置隐藏不适用的功能。
 */
export interface EditorToolbarConfig {
  /** 复制完整路径按钮（默认 true） */
  copyPath?: boolean
  /** 在文件夹中显示按钮（默认 true） */
  openLocation?: boolean
  /** 打开历史记录按钮（默认 true） */
  openHistory?: boolean
  /** 笔记属性面板按钮（默认 true） */
  noteProperties?: boolean
  /** 大纲/目录按钮（默认 true） */
  directory?: boolean
  /** 源码视图切换按钮（默认 true） */
  sourceView?: boolean
  /** 宽窄模式切换按钮（默认 true） */
  noteWidth?: boolean
  /** 内容布局按钮（默认 true） */
  contentLayout?: boolean
  /** 下载远程图片按钮（默认 true） */
  downloadRemoteImages?: boolean
  /** 左侧文件路径显示（默认 true） */
  showFilePath?: boolean
  /** 外部变更警告（默认 true） */
  externalChangeWarning?: boolean
  /** 冲突指示器（默认 true） */
  conflictIndicator?: boolean
}

/**
 * 插件 tab 运行时数据：不参与序列化，进程内有效。
 * 存储 icon（ReactNode）和 onChange 回调等不可序列化的数据。
 */
export interface PluginTabRuntime {
  /** tab 标题图标（替换默认 FileText） */
  icon?: ReactNode
  /** 内容变化回调：宿主通过此回调将编辑器内容传回插件 */
  onChange?: (content: string) => void
}

/** 插件 tab 运行时数据注册表：tabId → 运行时数据 */
const pluginTabRuntime = new Map<string, PluginTabRuntime>()

/** 注册插件 tab 运行时数据（icon、onChange 回调） */
export function registerPluginTabRuntime(tabId: string, runtime: PluginTabRuntime) {
  pluginTabRuntime.set(tabId, runtime)
}

/** 注销插件 tab 运行时数据（tab 关闭时调用） */
export function unregisterPluginTabRuntime(tabId: string) {
  pluginTabRuntime.delete(tabId)
}

/** 获取插件 tab 运行时数据（供 TabBar/EditorToolbar/Editor 使用） */
export function getPluginTabRuntime(tabId: string): PluginTabRuntime | undefined {
  return pluginTabRuntime.get(tabId)
}

/** 最大同时打开的 tab 数量上限：超出时强制关闭最旧的非活动、非 dirty 的 tab */
const MAX_OPEN_TABS = 20

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
  // 视图模式：'preview'(BlockNote) 或 'source'(CodeMirror)
  viewMode: 'preview' | 'source'
  // tab 类型：file/diff/conflict/plugin
  type?: 'file' | 'diff' | 'conflict' | 'plugin'
  // For diff tabs: commit hash and diff content
  commitHash?: string
  diffContent?: string
  // For conflict tabs: conflict info
  conflictRepoPath?: string
  conflictRepoName?: string
  // 冲突 tab：打开时是否自动隐藏文件树
  conflictAutoHideTree?: boolean
  // 冲突 tab：当前选中的冲突文件（仓库内相对路径）
  conflictSelectedFile?: string
  // 冲突 tab：本地编辑器光标行号
  conflictCursorLine?: number
  /** 缓存的 frontmatter 数据（仅 .md 文件） */
  frontmatter?: NoteFrontmatter
  /** 属性面板编辑导致的脏状态，与编辑器内容脏状态独立 */
  frontmatterDirty?: boolean
  /** 插件 tab：标识来源插件 ID（如 'com.swallownote.secret-disk'） */
  pluginId?: string
  /** 插件 tab：工具栏显示配置（未设置的字段默认显示） */
  toolbarConfig?: EditorToolbarConfig
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
  /** 将所有已打开 .md tab 的 frontmatter.categories 中旧路径替换为新路径 */
  renameCategoryInTabs: (oldPath: string, newPath: string) => void
  /** 从所有已打开 .md tab 的 frontmatter.categories 中移除指定路径 */
  removeCategoryFromTabs: (path: string) => void
}

/** Auto-close the noteProperties panel when all tabs are closed. */
function autoCloseNoteProperties() {
  if (useEditorStore.getState().activeTabId !== null) return
  queueMicrotask(async () => {
    try {
      const { useUIStore } = await import('@/stores/ui')
      if (useUIStore.getState().rightPanelType === 'noteProperties') {
        useUIStore.getState().setRightPanelType(null)
      }
    } catch { /* ignore — may fail in test environment */ }
  })
}

// 启用 subscribeWithSelector，按切片变化触发，避免无关保存
export const useEditorStore = create<EditorState>()(subscribeWithSelector((set, get) => ({
  tabs: [],
  activeTabId: null,
  savingPaths: new Set<string>(),
  addTab: (tab) => {
    // 达到最大打开 tab 上限时，先尝试关闭最旧的可关闭 tab，避免无限增长
    const current = get()
    if (current.tabs.length >= MAX_OPEN_TABS) {
      // 仅关闭非活动、非 diff/conflict、非 dirty tab
      const closable = current.tabs.find(t =>
        t.id !== current.activeTabId &&
        t.type !== 'diff' &&
        t.type !== 'conflict' &&
        !t.isDirty &&
        !t.frontmatterDirty
      )
      if (closable) {
        get().removeTab(closable.id)
      }
      // 无可关闭 tab 时允许超过上限，避免数据丢失
    }
    set((state) => {
      const existing = state.tabs.find((t) => t.path === tab.path)
      if (existing) {
        // 同 path 复用既有 tab；仅未加载时更新 content（避免覆盖空文件）
        if (existing.content === undefined && tab.content !== undefined) {
          // .md 文件解析 frontmatter
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
      // 新 .md tab 解析 frontmatter
      const isMarkdown = tab.path.toLowerCase().endsWith('.md')
      const newTab = { ...tab, isDirty: false, isEdited: false, viewMode: 'preview' as const }
      if (isMarkdown && tab.content !== undefined) {
        const result = parseFrontmatter(tab.content)
        newTab.content = result.body
        newTab.frontmatter = result.data
      }
      const newTabs = [...state.tabs, newTab]
      // 提交后通知插件：新 tab 已打开
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
        // tab 已存在时更新 auto-hide/auto-select
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
      // 捕获被移除的 tab 以在提交后发射 note:close（不存在则不发）
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
    // 清理插件 tab 运行时数据（icon、onChange 回调）
    unregisterPluginTabRuntime(id)
    // 全部 tab 关闭时自动关属性面板
    autoCloseNoteProperties()
  },
  removeTabs: (ids) => {
    const idSet = new Set(ids)
    let removedTabs: EditorTab[] = []
    set((state) => {
      removedTabs = state.tabs.filter((t) => idSet.has(t.id))
      const newTabs = state.tabs.filter((t) => !idSet.has(t.id))
      let newActiveId = state.activeTabId
      if (newActiveId && idSet.has(newActiveId)) {
        newActiveId = newTabs.length > 0 ? newTabs[0].id : null
      }
      return { tabs: newTabs, activeTabId: newActiveId }
    })
    // 清理插件 tab 运行时数据
    for (const id of ids) {
      unregisterPluginTabRuntime(id)
    }
    // 为每个被移除的 tab 发射 note:close
    for (const tab of removedTabs) {
      queueMicrotask(() => emitNoteClosed(tab.id, tab.path))
    }
    // 全部 tab 关闭时自动关属性面板
    autoCloseNoteProperties()
  },
  setActiveTab: (id) => {
    set((state) => {
      const prevActiveId = state.activeTabId
      if (prevActiveId === id) return state
      // 内存策略：保留活动 tab + 最近 5 个 tab 的 content
      const recentTabIds = new Set<string>([id])
      state.tabs
        .filter(t => t.id !== id)
        .slice(-5)
        .forEach(t => recentTabIds.add(t.id))
      const tabs = state.tabs.map((t) => {
        // 保留集合中的 tab content
        if (recentTabIds.has(t.id)) return t
        // 保留 dirty tab 的 content，避免丢失修改
        if (t.isDirty || t.frontmatterDirty) return t
        // diff/conflict/plugin tab 无法 reload，保留
        if (t.type === 'diff' || t.type === 'conflict' || t.type === 'plugin') return t
        // 释放 content/frontmatter，重置 isLoading 以便重载
        if (t.content !== undefined || t.frontmatter !== undefined) {
          return { ...t, content: undefined as unknown as string, frontmatter: undefined, isLoading: false }
        }
        return t
      })
      return { tabs, activeTabId: id }
    })
    // 切换到非 .md 文件时关属性面板
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
    // 检查 tab 是否需加载（undefined=未加载，''=空文件）
    // force=true 跳过 content 检查以支持重载
    if (!tab || tab.isLoading) return
    if (!force && tab.content !== undefined) return
    // conflict/diff/plugin tab 无磁盘文件内容可加载
    if (tab.type === 'conflict' || tab.type === 'diff' || tab.type === 'plugin') return

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
          logger.warn('editor-store', `Failed to load tab content, retrying (${currentRetry + 1}/${maxRetries}):`, tab.path)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return tryLoadContent(currentRetry + 1)
        }
        throw e
      }
    }

    try {
      const rawContent = await tryLoadContent()
      const cursorPosition = tab.cursorPosition || { line: 1, column: 1 }
      // Get actual file modification time from backend.
      // 失败时保留 tab 已有的 modifiedTime（不回退到当前时间），
      // 否则用户会看到错误的"修改时间"。
      let modifiedTime = tab.modifiedTime
      try {
        const { getFileMetadata } = await import('@/lib/tauri')
        const metadata = await getFileMetadata(tab.path)
        if (metadata?.modified_time) {
          modifiedTime = metadata.modified_time
        }
      } catch (e) {
        logger.warn('editor-store', 'getFileMetadata failed, keeping previous modifiedTime', e)
      }

      // .md 文件解析 frontmatter，存储正文为 content
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
                // force 重载丢弃本地编辑，重置 dirty/edited
                isDirty: force ? false : t.isDirty,
                isEdited: force ? false : t.isEdited,
                fileSize: rawContent.length > 1024 ? `${(rawContent.length / 1024).toFixed(1)}Kb` : `${rawContent.length}B`,
                modifiedTime,
                wordCount: countWords(content),
                cursorPosition,
              }
            : t
        ),
      }))
      // 发射 note:change，让插件收到初始内容
      const loadedTab = get().tabs.find((t) => t.id === id)
      if (loadedTab) {
        queueMicrotask(() => emitNoteChanged(loadedTab.id, loadedTab.path, loadedTab.content ?? ''))
      }
    } catch (e) {
      logger.error('editor-store', 'Failed to load tab content after retries:', e)
      // 不关闭 tab，标记外部变更；content 置 '' 避免无限重试
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, content: '', isLoading: false, hasExternalChange: true } : t
        ),
      }))
      // 仅首次加载失败时弹错误对话框
      if (tab.content === undefined) {
        window.dispatchEvent(new CustomEvent('tab-load-error', {
          detail: { id, path: tab.path, name: tab.name }
        }))
      }
    }
  },
  updateTabContent: (id, content) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id)
      if (!tab) return state
      // 只有内容真正变化时才标记为 dirty
      // undefined 与 '' 等价，避免空文件被误标 dirty
      const currentNormalized = tab.content ?? ''
      const newNormalized = content ?? ''
      // 内容未变时返回同一 state，避免无谓重渲染
      if (currentNormalized === newNormalized) return state
      // 插件 tab：不标记 isDirty（插件自己负责保存）
      // 仍更新 content，并通过 onChange 回调通知插件
      const isPluginTab = tab.type === 'plugin'
      const tabs = state.tabs.map((t) =>
        t.id === id ? {
          ...t,
          content,
          isDirty: isPluginTab ? t.isDirty : true,
          isEdited: isPluginTab ? t.isEdited : true,
        } : t
      )
      // 仅内容真正变化时发射 note:changed
      queueMicrotask(() => emitNoteChanged(id, tab.path, content ?? ''))
      // 插件 tab：调用 onChange 回调通知插件保存
      if (isPluginTab) {
        const runtime = pluginTabRuntime.get(id)
        runtime?.onChange?.(content ?? '')
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
  updateTabPath: (oldPath, newPath, newName) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        // 更新 path 以 oldPath 开头的 tab（含目录移动）
        t.path === oldPath
          ? { ...t, path: newPath, name: newName }
          : t.path.startsWith(oldPath + '/')
            // 子文件自身名字未变，仅父目录路径变化，故只更新 path，name 保留 t.name
            ? { ...t, path: newPath + t.path.slice(oldPath.length) }
            : t
      ),
    }))

    // 同步更新 frontmatter.categories（移动后路径替换）
    queueMicrotask(async () => {
      try {
        const { useWorkspaceStore } = await import('@/stores/workspace')
        const rootPath = useWorkspaceStore.getState().rootPath
        if (!rootPath) return

        // categories 存相对路径，需转绝对路径为相对路径
        const toRel = (absPath: string): string => {
          if (absPath.startsWith(rootPath + '/')) {
            return absPath.slice(rootPath.length + 1)
          }
          return absPath
        }
        const oldRel = toRel(oldPath)
        const newRel = toRel(newPath)

        set((state) => ({
          tabs: state.tabs.map((t) => {
            // 只处理 .md 文件且有 categories 的 tab
            if (!t.path.toLowerCase().endsWith('.md') || !t.frontmatter?.categories) return t
            // 只处理 path 已被上方 set 更新为 newPath（或其子路径）的 tab
            if (t.path !== newPath && !t.path.startsWith(newPath + '/')) return t

            const cats = t.frontmatter.categories as string[]
            let changed = false
            // 匹配等于 oldRel 或以 oldRel + '/' 开头的分类路径，替换为对应的新路径
            const newCats = cats.map((c) => {
              if (c === oldRel) {
                changed = true
                return newRel
              }
              if (oldRel && c.startsWith(oldRel + '/')) {
                changed = true
                return newRel + c.slice(oldRel.length)
              }
              return c
            })
            if (!changed) return t

            return {
              ...t,
              frontmatter: {
                ...t.frontmatter,
                categories: newCats,
              },
              frontmatterDirty: true,
            }
          }),
        }))
      } catch { /* 测试环境可能未初始化 workspace store，忽略 */ }
    })
  },
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
  filterTabs: (predicate) => {
    let removedTabs: EditorTab[] = []
    set((state) => {
      const keptTabs = state.tabs.filter(predicate)
      if (keptTabs.length === state.tabs.length) return state

      removedTabs = state.tabs.filter(t => !predicate(t))
      const keptIds = new Set(keptTabs.map(t => t.id))
      let newActiveId = state.activeTabId

      if (state.activeTabId && !keptIds.has(state.activeTabId)) {
        newActiveId = keptTabs.length > 0 ? keptTabs[0].id : null
      }

      return { tabs: keptTabs, activeTabId: newActiveId }
    })
    // 为每个被过滤的 tab 发射 note:close
    for (const tab of removedTabs) {
      // 清理插件 tab 运行时数据，避免 runtime 残留
      if (tab.type === 'plugin') {
        unregisterPluginTabRuntime(tab.id)
      }
      queueMicrotask(() => emitNoteClosed(tab.id, tab.path))
    }
    // 全部 tab 关闭时自动关属性面板
    autoCloseNoteProperties()
  },
  saveAllDirtyTabs: async () => {
    const dirtyTabs = get().tabs.filter((t) => t.isDirty || t.frontmatterDirty)
    for (const tab of dirtyTabs) {
      try {
        // .md 文件写入前合并 frontmatter
        const isMarkdown = tab.path.toLowerCase().endsWith('.md')
        // 防御：content===undefined 时跳过写入避免丢失正文
        if (tab.content === undefined && isMarkdown) {
          logger.warn('editor-store', `Skipping save for tab with undefined content: ${tab.path}`)
          continue
        }

        // 标记保存中，防止 file-watcher 关闭 tab
        set((state) => {
          const newSet = new Set(state.savingPaths)
          newSet.add(tab.path)
          return { savingPaths: newSet }
        })

        let writeContent = tab.content
        // 保存前正文基准，用于 CAS 判断避免误标已保存
        const savingContent = tab.content
        let fm: NoteFrontmatter | undefined
        if (isMarkdown) {
          fm = { ...(tab.frontmatter || {}), updated: new Date().toISOString() }
          // 防御性剥离 frontmatter（源码模式可能含完整内容）
          const body = stripFrontmatter(tab.content ?? '')
          writeContent = serializeFrontmatter(fm, body)
        }

        await writeFile(tab.path, writeContent)
        // 保存 .md 文件后，同步更新 md_frontmatter 表
        if (isMarkdown) {
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('index_saved_file', { path: tab.path })
          } catch (e) {
            // 索引线程会异步补偿，但记录日志便于排查
            logger.error('editor-store', 'Failed to index saved file:', tab.path, e)
          }
        }
        // CAS 保护：仅期间无新编辑才清脏标记
        const currentTab = get().tabs.find((t) => t.id === tab.id)
        if (currentTab && currentTab.content === savingContent) {
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tab.id ? { ...t, frontmatter: fm, isDirty: false, isEdited: false, frontmatterDirty: false } : t
            ),
          }))
        }
        // 提交后通知插件：脏 tab 已保存
        queueMicrotask(() => emitNoteSaved(tab.id, tab.path))
        // 失效 frontmatter 缓存以刷新搜索/文件树
        if (isMarkdown) {
          const { invalidateFrontmatterCache } = await import('@/lib/utils/searchQuery')
          invalidateFrontmatterCache(tab.path)
        }
        window.dispatchEvent(new CustomEvent('file-saved', { detail: { path: tab.path } }))
        // 若在 git 仓库则自动提交（异步非阻塞）
        try {
          await gitAutoCommit(tab.path)
        } catch (e) {
          logger.warn('editor-store', 'gitAutoCommit failed for', tab.path, e)
        }
      } catch (e) {
        logger.error('editor-store', 'Failed to save tab:', tab.path, e)
        window.dispatchEvent(new CustomEvent('save-error', { detail: { path: tab.path, error: e } }))
      } finally {
        // 延迟移除 savingPaths，等 file-watcher 平息
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
        logger.error('editor-store', 'Failed to reset dirty tab:', tab.path, e)
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
  renameCategoryInTabs: (oldPath: string, newPath: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (!t.path.toLowerCase().endsWith('.md') || !t.frontmatter?.categories) return t
        const cats = t.frontmatter.categories as string[]
        if (!cats.includes(oldPath)) return t
        return {
          ...t,
          frontmatter: {
            ...t.frontmatter,
            categories: cats.map((c) => (c === oldPath ? newPath : c)),
          },
          frontmatterDirty: true,
          isDirty: true,
          isEdited: true,
        }
      }),
    }))
  },
  removeCategoryFromTabs: (path: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (!t.path.toLowerCase().endsWith('.md') || !t.frontmatter?.categories) return t
        const cats = t.frontmatter.categories as string[]
        if (!cats.includes(path)) return t
        return {
          ...t,
          frontmatter: {
            ...t.frontmatter,
            categories: cats.filter((c) => c !== path),
          },
          frontmatterDirty: true,
          isDirty: true,
          isEdited: true,
        }
      }),
    }))
  },
})))
