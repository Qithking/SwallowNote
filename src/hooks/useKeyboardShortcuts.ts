import { useEffect, useRef } from 'react'
import { logger } from '@/lib/logger'
import { useUIStore, useEditorStore, useFileTreeStore, useWorkspaceStore, type Theme } from '@/stores'
import { ShortcutKey, matchShortcut, getShortcutKey } from '@/lib/shortcuts'
import { openFolderDialog, openWorkspaceDialog, createFile, writeFile } from '@/lib/tauri'
import { loadDirectory } from '@/lib/api'
import { injectDefaultFrontmatter } from '@/lib/utils/frontmatter'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'
import { invoke } from '@tauri-apps/api/core'
import { emitLocaleChanged, emitNoteSaved } from '@/lib/plugin-host'
import { listPluginCommands } from '@/lib/plugin-commands'
import { toast } from 'sonner'
import i18n from 'i18next'
import { findNodeByPath, generateUniqueName, updateNodesWithChildren } from '@/lib/utils/treeUtils'
import { flushAllEditors } from '@/lib/editor-flush'

function getShortcut(key: ShortcutKey): string {
  return getShortcutKey(key, useUIStore.getState().customShortcuts)
}

/** 返回与事件匹配的插件命令 binding key，用于检测冲突。 */
export function findConflictingPluginCommandKey(e: KeyboardEvent): string | null {
  const bindings = useUIStore.getState().pluginCommandShortcuts
  for (const [bindingKey, value] of Object.entries(bindings)) {
    if (!value) continue
    if (matchShortcut(e, value)) return bindingKey
  }
  return null
}

/**
 * 匹配并派发内置快捷键；冲突时弹 3s toast（200ms 节流）。
 * preventDefault 仅在匹配成功后调用。
 */
const PLUGIN_CONFLICT_THROTTLE_MS = 200
const MAX_CONFLICT_ENTRIES = 100
const lastPluginConflictShownAt = new Map<string, number>()

export function dispatchBuiltin(
  e: KeyboardEvent,
  key: ShortcutKey,
  action: () => void | Promise<void>,
): boolean {
  if (!matchShortcut(e, getShortcut(key))) return false
  e.preventDefault()
  const pluginBinding = findConflictingPluginCommandKey(e)
  if (pluginBinding) {
    // strip 尾部 commandId（用 lastIndexOf）
    const lastColon = pluginBinding.lastIndexOf(':')
    const pluginId =
      lastColon > 0 ? pluginBinding.slice(0, lastColon) : pluginBinding
    // 200ms 节流避免连按刷屏
    const now = Date.now()
    const lastShown = lastPluginConflictShownAt.get(pluginBinding) ?? 0
    if (now - lastShown >= PLUGIN_CONFLICT_THROTTLE_MS) {
      lastPluginConflictShownAt.set(pluginBinding, now)
      // 淘汰最旧条目，防止 Map 无限增长
      if (lastPluginConflictShownAt.size > MAX_CONFLICT_ENTRIES) {
        const oldest = lastPluginConflictShownAt.keys().next().value!
        lastPluginConflictShownAt.delete(oldest)
      }
      // toast 描述携带内置 action 名
      toast(i18n.t('settings.pluginCommandShadowed', { id: pluginId }), {
        // 稳定 id，避免重复冲突堆叠 toast
        id: `plugin-conflict-${key}`,
        description: i18n.t('settings.pluginCommandShadowedDesc', {
          action: key,
        }),
        // 延长到 3s，便于阅读标题与描述
        duration: 3000,
      })
    }
  }
  void action()
  return true
}

export async function handleNewFile() {
  const { selectedPath, nodes } = useFileTreeStore.getState()
  const { rootPath } = useWorkspaceStore.getState()
  if (!rootPath) return

  let targetDir = rootPath
  if (selectedPath) {
    const selected = findNodeByPath(selectedPath, nodes)
    if (selected?.isDirectory) {
      targetDir = selected.path
    } else if (selectedPath.includes('/')) {
      targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
    }
  }

  const children = (findNodeByPath(targetDir, nodes)?.children) || []
  const defaultFileName = i18n.t('fileTree.defaultFileName')
  const name = generateUniqueName(defaultFileName, children)
  const fullPath = targetDir + '/' + name

  try {
    await createFile(fullPath, false)
    if (fullPath.endsWith('.md')) {
      await writeFile(fullPath, injectDefaultFrontmatter(name))
    }
    const { showAllFiles, markdownOnly } = useUIStore.getState()
    const newChildren = await loadDirectory(targetDir, showAllFiles, markdownOnly)
    useFileTreeStore.getState().setNodes(
      updateNodesWithChildren(nodes, targetDir, newChildren)
    )
    useFileTreeStore.getState().setSelectedPath(fullPath)
  } catch (e) {
    logger.error('keyboard', 'Failed to create file:', e)
  }
}

async function handleNewFolder() {
  const { selectedPath, nodes } = useFileTreeStore.getState()
  const { rootPath } = useWorkspaceStore.getState()
  if (!rootPath) return

  let targetDir = rootPath
  if (selectedPath) {
    const selected = findNodeByPath(selectedPath, nodes)
    if (selected?.isDirectory) {
      targetDir = selected.path
    } else if (selectedPath.includes('/')) {
      targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
    }
  }

  const children = (findNodeByPath(targetDir, nodes)?.children) || []
  const defaultFolderName = i18n.t('fileTree.defaultFolderName')
  const name = generateUniqueName(defaultFolderName, children)
  const fullPath = targetDir + '/' + name

  try {
    await createFile(fullPath, true)
    const { showAllFiles, markdownOnly } = useUIStore.getState()
    const newChildren = await loadDirectory(targetDir, showAllFiles, markdownOnly)
    useFileTreeStore.getState().setNodes(
      updateNodesWithChildren(nodes, targetDir, newChildren)
    )
  } catch (e) {
    logger.error('keyboard', 'Failed to create folder:', e)
  }
}

export async function handleOpenFile() {
  const { workspaceMode } = useUIStore.getState()
  try {
    if (workspaceMode === 'workspace') {
      const path = await openWorkspaceDialog()
      if (path) {
        await useWorkspaceStore.getState().loadWorkspaceFile(path)
      }
    } else {
      const path = await openFolderDialog()
      if (path) {
        await useWorkspaceStore.getState().openFolder(path)
      }
    }
  } catch (e) {
    logger.error('keyboard', 'Failed to open:', e)
  }
}

export async function handleSaveFile() {
  // 读取前先 flush 编辑器防抖内容
  await flushAllEditors()
  const { tabs, activeTabId } = useEditorStore.getState()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  if (!activeTab || (!activeTab.isDirty && !activeTab.frontmatterDirty)) return

  try {
    // 标记保存中，防止 file-watcher 关闭 tab
    useEditorStore.setState((state) => {
      const newSet = new Set(state.savingPaths)
      newSet.add(activeTab.path)
      return { savingPaths: newSet }
    })
    const { writeFile } = await import('@/lib/tauri')
    // .md 文件写入前合并 frontmatter 与正文
    const isMarkdown = activeTab.path.toLowerCase().endsWith('.md')
    // 保存前正文基准，用于 CAS 判断避免误标已保存
    const savingContent = activeTab.content
    let writeContent = activeTab.content
    let fm: NoteFrontmatter | undefined
    if (isMarkdown) {
      const { serializeFrontmatter, stripFrontmatter } = await import('@/lib/utils/frontmatter')
      fm = { ...(activeTab.frontmatter || {}), updated: new Date().toISOString() }
      // 防御性剥离 frontmatter（源码模式可能含完整内容）
      const body = stripFrontmatter(activeTab.content ?? '')
      writeContent = serializeFrontmatter(fm, body)
    }
    await writeFile(activeTab.path, writeContent)
    // 同步更新 frontmatter 索引表，供分类面板查询
    if (isMarkdown) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('index_saved_file', { path: activeTab.path })
      } catch (e) {
        // 索引线程会异步补偿，记录日志便于排查
        logger.error('keyboard', 'Failed to index saved file:', activeTab.path, e)
      }
    }
    // CAS 保护：仅期间无新编辑才清脏标记
    const currentTab = useEditorStore.getState().tabs.find((t) => t.id === activeTab.id)
    if (currentTab && currentTab.content === savingContent) {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTab.id ? { ...t, frontmatter: fm, isDirty: false, isEdited: false, frontmatterDirty: false } : t
        ),
      }))
    }
    // 提交后通知插件：笔记已保存
    queueMicrotask(() => emitNoteSaved(activeTab.id, activeTab.path))
    // 失效 frontmatter 缓存以刷新搜索/文件树
    if (isMarkdown) {
      const { invalidateFrontmatterCache } = await import('@/lib/utils/searchQuery')
      invalidateFrontmatterCache(activeTab.path)
    }
    window.dispatchEvent(new CustomEvent('file-saved', { detail: { path: activeTab.path } }))
    const { gitAutoCommit } = await import('@/lib/tauri')
    try {
      await gitAutoCommit(activeTab.path)
    } catch (e) {
      logger.debug('keyboard', 'Git auto-commit skipped:', e)
    }
  } catch (e) {
    logger.error('keyboard', 'Failed to save file:', e)
  } finally {
    // 延迟移除 savingPaths，等 file-watcher 平息
    const savedPath = activeTab.path
    setTimeout(() => {
      useEditorStore.setState((state) => {
        const newSet = new Set(state.savingPaths)
        newSet.delete(savedPath)
        return { savingPaths: newSet }
      })
    }, 1000)
  }
}

async function handleSaveAll() {
  await flushAllEditors()
  await useEditorStore.getState().saveAllDirtyTabs()
}

async function handleSaveWorkspace() {
  await useWorkspaceStore.getState().saveWorkspaceFile()
}

async function handleCloseFile() {
  const { tabs, activeTabId } = useEditorStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab?.isDirty) {
    const names = tab.name
    if (!confirm(i18n.t('dialog.unsavedFiles', { count: 1 }) + '\n' + names)) return
  }
  useEditorStore.getState().removeTab(activeTabId)
}

function handleCloseAll() {
  const { tabs } = useEditorStore.getState()
  const dirtyTabs = tabs.filter((t) => t.isDirty)
  if (dirtyTabs.length > 0) {
    const names = dirtyTabs.map((t) => t.name).join(', ')
    if (!confirm(i18n.t('dialog.unsavedFiles', { count: dirtyTabs.length }) + '\n' + names)) return
  }
  useEditorStore.getState().removeTabs(tabs.map((t) => t.id))
}

function handleToggleTheme() {
  const { theme, setTheme } = useUIStore.getState()
  const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
  const currentIndex = order.indexOf(theme as Theme)
  const nextIndex = (currentIndex + 1) % order.length
  setTheme(order[nextIndex])
}

async function handleOpenExplorer() {
  const { selectedPath } = useFileTreeStore.getState()
  if (!selectedPath) return

  try {
    await invoke('open_in_finder', { path: selectedPath })
  } catch (e) {
    logger.error('keyboard', 'Failed to open in explorer:', e)
  }
}

/**
 * Toggle the search sidebar view.  Mirrors the ActivityBar click
 * behaviour: if already on the search view, switch back to the
 * explorer; otherwise switch to search and ensure the sidebar is
 * visible.
 */
export function handleToggleSearch() {
  const ui = useUIStore.getState()
  if (ui.settingsPanelVisible) {
    ui.setSettingsPanelVisible(false)
  }
  if (ui.sidebarView === 'search' && ui.sidebarVisible) {
    ui.setSidebarView('explorer')
  } else {
    if (!ui.sidebarVisible) {
      ui.setSidebarVisible(true)
    }
    ui.setSidebarView('search')
  }
}

/**
 * Toggle the settings panel.  Mirrors the ActivityBar settings-button
 * behaviour: if already open, close it; otherwise open it in the main
 * area (requires both `settingsPanelVisible=true` and
 * `sidebarView='settings'`).
 */
export function handleToggleSettings() {
  const ui = useUIStore.getState()
  if (ui.settingsPanelVisible && ui.sidebarView === 'settings') {
    ui.setSettingsPanelVisible(false)
    ui.setSidebarView('explorer')
  } else {
    ui.setSettingsPanelVisible(true)
    ui.setSidebarView('settings')
    ui.setRightPanelType(null)
  }
}

/** Refresh the file tree by reloading every expanded directory. */
export async function handleRefreshFileTree() {
  try {
    await useFileTreeStore.getState().refreshExpanded()
  } catch (e) {
    logger.error('keyboard', 'Failed to refresh file tree:', e)
  }
}

export function useKeyboardShortcuts() {
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleLogViewer = useUIStore((s) => s.toggleLogViewer)

  // 用 ref 持有 tabs，避免每次切换重新绑定 listener
  const tabsRef = useRef(useEditorStore.getState().tabs)
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      tabsRef.current = state.tabs
    })
    return unsub
  }, [])

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // 仅处理已注册快捷键，不拦截系统/编辑器原生快捷键

      if (dispatchBuiltin(e, 'newFile', handleNewFile)) return
      if (dispatchBuiltin(e, 'newFolder', handleNewFolder)) return
      if (dispatchBuiltin(e, 'openFile', handleOpenFile)) return
      if (dispatchBuiltin(e, 'saveFile', handleSaveFile)) return
      if (dispatchBuiltin(e, 'saveAll', handleSaveAll)) return
      if (dispatchBuiltin(e, 'saveWorkspace', handleSaveWorkspace)) return
      if (dispatchBuiltin(e, 'closeFile', handleCloseFile)) return
      if (dispatchBuiltin(e, 'closeAll', handleCloseAll)) return
      if (dispatchBuiltin(e, 'toggleTheme', handleToggleTheme)) return
      if (
        dispatchBuiltin(e, 'toggleLanguage', () => {
          const currentLang = i18n.language
          const newLang = currentLang === 'zh-CN' ? 'en' : 'zh-CN'
          i18n.changeLanguage(newLang)
          queueMicrotask(() => emitLocaleChanged(newLang))
        })
      )
        return
      if (dispatchBuiltin(e, 'openExplorer', handleOpenExplorer)) return

      // 用户可在设置中自定义的全局快捷键

      if (dispatchBuiltin(e, 'commandPalette', toggleCommandPalette)) return

      // Ctrl+F → 编辑器查找/替换;Ctrl+Shift+F → 全局搜索侧边栏
      // CodeMirror editor 已获得焦点时由 CodeEditor 内部 keymap 处理,避免双重派发
      const activeElement = document.activeElement
      const isCodeMirrorFocused = activeElement && activeElement.closest('.cm-editor') != null
      if (!isCodeMirrorFocused && dispatchBuiltin(e, 'findReplace', () => {
        window.dispatchEvent(new CustomEvent('editor:toggle-find-replace'))
      })) return

      if (dispatchBuiltin(e, 'searchPanel', handleToggleSearch)) return

      if (dispatchBuiltin(e, 'toggleSidebar', toggleSidebar)) return
      if (dispatchBuiltin(e, 'settings', handleToggleSettings)) return
      if (dispatchBuiltin(e, 'logViewer', toggleLogViewer)) return

      // 派发插件命令快捷键；每次 keypress 查最新绑定
      const bindings = useUIStore.getState().pluginCommandShortcuts
      for (const [bindingKey, value] of Object.entries(bindings)) {
        if (!value) continue
        if (!matchShortcut(e, value)) continue
        // bindingKey 格式 pluginId:commandId
        const firstColon = bindingKey.indexOf(':')
        if (firstColon <= 0) continue
        const pluginId = bindingKey.slice(0, firstColon)
        const commandId = bindingKey.slice(firstColon + 1)
        const registered = listPluginCommands().find(
          (cmd) =>
            cmd.id === commandId &&
            // 校验 __pluginId stamp 匹配
            (cmd as { __pluginId?: string }).__pluginId === pluginId
        )
        if (!registered) continue
        e.preventDefault()
        try {
          void registered.onTrigger()
        } catch (err) {
          // buggy 插件不能破坏全局 listener
          logger.error('keyboard', 'plugin onTrigger threw:', err)
        }
        return
      }

      // ⌘1-9 切换 tab（非单一可重绑快捷键）
      const isMod = e.ctrlKey || e.metaKey
      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabsRef.current[index]) {
          const tab = tabsRef.current[index]
          // 切换前 flush 防抖内容，避免编辑丢失
          await flushAllEditors()
          // 立即切换 tab 提升体验
          useEditorStore.getState().setActiveTab(tab.id)
          // 异步加载内容；用 undefined 判断未加载（空串有效）
          if (tab.content === undefined && !tab.isLoading && tab.type !== 'diff' && tab.type !== 'conflict') {
            setTimeout(() => {
              useEditorStore.getState().loadTabContent(tab.id)
            }, 0)
          }
        }
        return
      }

      // Escape 关闭浮层；编辑器需要时不拦截
      if (e.key === 'Escape') {
        const { commandPaletteVisible } = useUIStore.getState()
        if (commandPaletteVisible) {
          toggleCommandPalette()
          return
        }
        // 无浮层时不 preventDefault，交由编辑器处理
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    toggleCommandPalette,
    toggleSidebar,
    toggleLogViewer,
  ])
}
