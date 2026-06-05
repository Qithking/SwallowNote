import { useEffect } from 'react'
import { useUIStore, useEditorStore, useFileTreeStore, useWorkspaceStore, type FileNode, type Theme } from '@/stores'
import { ShortcutKey, matchShortcut, getShortcutKey } from '@/lib/shortcuts'
import { openFolderDialog, openWorkspaceDialog, createFile } from '@/lib/tauri'
import { loadDirectory } from '@/lib/api'
import { invoke } from '@tauri-apps/api/core'
import i18n from 'i18next'

function getShortcut(key: ShortcutKey): string {
  return getShortcutKey(key, useUIStore.getState().customShortcuts)
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNodeByPath(n.children, path)
      if (found) return found
    }
  }
  return null
}

function generateUniqueName(baseName: string, siblings: FileNode[]): string {
  let name = baseName
  let counter = 1
  const existingNames = new Set(siblings.map((s) => s.name))
  while (existingNames.has(name)) {
    const dotIndex = baseName.lastIndexOf('.')
    if (dotIndex > 0) {
      name = baseName.slice(0, dotIndex) + ` ${counter}` + baseName.slice(dotIndex)
    } else {
      name = `${baseName} ${counter}`
    }
    counter++
  }
  return name
}

async function handleNewFile() {
  const { selectedPath, nodes } = useFileTreeStore.getState()
  const { rootPath } = useWorkspaceStore.getState()
  if (!rootPath) return

  let targetDir = rootPath
  if (selectedPath) {
    const selected = findNodeByPath(nodes, selectedPath)
    if (selected?.isDirectory) {
      targetDir = selected.path
    } else if (selectedPath.includes('/')) {
      targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
    }
  }

  const children = (findNodeByPath(nodes, targetDir)?.children) || []
  const defaultFileName = i18n.t('fileTree.defaultFileName')
  const name = generateUniqueName(defaultFileName, children)
  const fullPath = targetDir + '/' + name

  try {
    await createFile(fullPath, false)
    const { showAllFiles, markdownOnly } = useUIStore.getState()
    const newChildren = await loadDirectory(targetDir, showAllFiles, markdownOnly)
    useFileTreeStore.getState().setNodes(
      updateNodesWithChildrenInList(nodes, targetDir, newChildren)
    )
    useFileTreeStore.getState().setSelectedPath(fullPath)
  } catch (e) {
    console.error('Failed to create file:', e)
  }
}

async function handleNewFolder() {
  const { selectedPath, nodes } = useFileTreeStore.getState()
  const { rootPath } = useWorkspaceStore.getState()
  if (!rootPath) return

  let targetDir = rootPath
  if (selectedPath) {
    const selected = findNodeByPath(nodes, selectedPath)
    if (selected?.isDirectory) {
      targetDir = selected.path
    } else if (selectedPath.includes('/')) {
      targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
    }
  }

  const children = (findNodeByPath(nodes, targetDir)?.children) || []
  const defaultFolderName = i18n.t('fileTree.defaultFolderName')
  const name = generateUniqueName(defaultFolderName, children)
  const fullPath = targetDir + '/' + name

  try {
    await createFile(fullPath, true)
    const { showAllFiles, markdownOnly } = useUIStore.getState()
    const newChildren = await loadDirectory(targetDir, showAllFiles, markdownOnly)
    useFileTreeStore.getState().setNodes(
      updateNodesWithChildrenInList(nodes, targetDir, newChildren)
    )
  } catch (e) {
    console.error('Failed to create folder:', e)
  }
}

function updateNodesWithChildrenInList(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildrenInList(n.children, path, children) }
    return n
  })
}

async function handleOpenFile() {
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
    console.error('Failed to open:', e)
  }
}

async function handleSaveFile() {
  const { tabs, activeTabId } = useEditorStore.getState()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  if (!activeTab || !activeTab.isDirty) return

  try {
    // Mark path as saving to prevent file-watcher from closing the tab
    useEditorStore.setState((state) => {
      const newSet = new Set(state.savingPaths)
      newSet.add(activeTab.path)
      return { savingPaths: newSet }
    })
    const { writeFile } = await import('@/lib/tauri')
    await writeFile(activeTab.path, activeTab.content)
    useEditorStore.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTab.id ? { ...t, isDirty: false, isEdited: false } : t
      ),
    }))
    const { gitAutoCommit } = await import('@/lib/tauri')
    try {
      await gitAutoCommit(activeTab.path)
    } catch {}
    window.dispatchEvent(new CustomEvent('file-saved', { detail: { path: activeTab.path } }))
  } catch (e) {
    console.error('Failed to save file:', e)
  } finally {
    // Delay removing from savingPaths to allow file-watcher events to settle
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
    console.error('Failed to open in explorer:', e)
  }
}

export function useKeyboardShortcuts() {
  const {
    toggleCommandPalette,
    toggleSearchPanel,
    toggleSidebar,
    setSidebarView,
  } = useUIStore()
  const { tabs, activeTabId, removeTab } = useEditorStore()

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Only handle shortcuts explicitly registered in DEFAULT_SHORTCUTS.
      // Never intercept system-native editing shortcuts (⌘C/⌘V/⌘A/⌘Z/⌘X etc.)
      // or browser/editor built-in shortcuts. This ensures BlockNote, CodeMirror,
      // and the system clipboard all work normally.

      if (matchShortcut(e, getShortcut('newFile'))) {
        e.preventDefault()
        handleNewFile()
        return
      }
      if (matchShortcut(e, getShortcut('newFolder'))) {
        e.preventDefault()
        handleNewFolder()
        return
      }
      if (matchShortcut(e, getShortcut('openFile'))) {
        e.preventDefault()
        handleOpenFile()
        return
      }
      if (matchShortcut(e, getShortcut('saveFile'))) {
        e.preventDefault()
        handleSaveFile()
        return
      }
      if (matchShortcut(e, getShortcut('saveAll'))) {
        e.preventDefault()
        handleSaveAll()
        return
      }
      if (matchShortcut(e, getShortcut('saveWorkspace'))) {
        e.preventDefault()
        handleSaveWorkspace()
        return
      }
      if (matchShortcut(e, getShortcut('closeFile'))) {
        e.preventDefault()
        handleCloseFile()
        return
      }
      if (matchShortcut(e, getShortcut('closeAll'))) {
        e.preventDefault()
        handleCloseAll()
        return
      }
      if (matchShortcut(e, getShortcut('toggleTheme'))) {
        e.preventDefault()
        handleToggleTheme()
        return
      }
      if (matchShortcut(e, getShortcut('toggleLanguage'))) {
        e.preventDefault()
        const currentLang = i18n.language
        const newLang = currentLang === 'zh-CN' ? 'en' : 'zh-CN'
        i18n.changeLanguage(newLang)
        return
      }
      if (matchShortcut(e, getShortcut('openExplorer'))) {
        e.preventDefault()
        handleOpenExplorer()
        return
      }

      // Customizable global shortcuts (user can rebind in Settings)

      if (matchShortcut(e, getShortcut('commandPalette'))) {
        e.preventDefault()
        toggleCommandPalette()
        return
      }

      if (matchShortcut(e, getShortcut('searchPanel'))) {
        e.preventDefault()
        toggleSearchPanel()
        return
      }

      if (matchShortcut(e, getShortcut('toggleSidebar'))) {
        e.preventDefault()
        toggleSidebar()
        return
      }

      if (matchShortcut(e, getShortcut('settings'))) {
        e.preventDefault()
        setSidebarView('settings')
        return
      }

      // ⌘1-9 — Tab switching (not in ShortcutKey because it's 9 separate keys,
      // not a single rebindable shortcut. No standard editing shortcut uses mod+digit.)
      const isMod = e.ctrlKey || e.metaKey
      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabs[index]) {
          const tab = tabs[index]
          if (!tab.content && !tab.isLoading && tab.type !== 'diff' && tab.type !== 'conflict') {
            await useEditorStore.getState().loadTabContent(tab.id)
          }
          useEditorStore.getState().setActiveTab(tab.id)
        }
        return
      }

      // Escape — dismiss open overlays (command palette, search panel, etc.)
      // Only act when there's actually something to dismiss; never swallow Escape
      // that the editor might need (e.g., exiting a special mode)
      if (e.key === 'Escape') {
        const { commandPaletteVisible, searchPanelVisible } = useUIStore.getState()
        if (commandPaletteVisible) {
          toggleCommandPalette()
          return
        }
        if (searchPanelVisible) {
          toggleSearchPanel()
          return
        }
        // No overlay open — don't preventDefault, let editor/system handle it
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    toggleCommandPalette,
    toggleSearchPanel,
    toggleSidebar,
    setSidebarView,
    tabs,
    activeTabId,
    removeTab,
  ])
}
