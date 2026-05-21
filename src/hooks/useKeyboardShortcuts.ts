import { useEffect } from 'react'
import { useUIStore, useEditorStore, useFileTreeStore, useWorkspaceStore } from '@/stores'
import { ShortcutKey, matchShortcut, getShortcutKey } from '@/lib/shortcuts'
import { openFolderDialog, openWorkspaceDialog, createFile } from '@/lib/tauri'
import { loadDirectory } from '@/lib/api'
import { invoke } from '@tauri-apps/api/core'
import i18n from 'i18next'

function getShortcut(key: ShortcutKey): string {
  return getShortcutKey(key, useUIStore.getState().customShortcuts)
}

function findNodeByPath(nodes: any[], path: string): any {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNodeByPath(n.children, path)
      if (found) return found
    }
  }
  return null
}

function generateUniqueName(baseName: string, siblings: any[]): string {
  let name = baseName
  let counter = 1
  const existingNames = new Set(siblings.map((s: any) => s.name))
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

function updateNodesWithChildrenInList(list: any[], path: string, children: any[]): any[] {
  return list.map((n: any) => {
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
    const { writeFile } = await import('@/lib/tauri')
    await writeFile(activeTab.path, activeTab.content)
    useEditorStore.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTab.id ? { ...t, isDirty: false, isEdited: false } : t
      ),
    }))
    const { gitAutoCommit } = await import('@/lib/tauri')
    gitAutoCommit(activeTab.path).catch(() => {})
  } catch (e) {
    console.error('Failed to save file:', e)
  }
}

async function handleSaveAll() {
  await useEditorStore.getState().saveAllDirtyTabs()
}

async function handleSaveWorkspace() {
  await useWorkspaceStore.getState().saveWorkspaceFile()
}

async function handleCloseFile() {
  const { activeTabId } = useEditorStore.getState()
  if (activeTabId) {
    useEditorStore.getState().removeTab(activeTabId)
  }
}

function handleCloseAll() {
  const { tabs } = useEditorStore.getState()
  for (const tab of tabs) {
    useEditorStore.getState().removeTab(tab.id)
  }
}

function handleToggleTheme() {
  const { theme, setTheme } = useUIStore.getState()
  const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
  const currentIndex = order.indexOf(theme as any)
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
      const isMod = e.ctrlKey || e.metaKey

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

      // Fixed shortcuts (not customizable)
      if (isMod && e.key === 'p' && !e.shiftKey) {
        e.preventDefault()
        toggleCommandPalette()
      }

      if (isMod && e.key === 'F') {
        e.preventDefault()
        toggleSearchPanel()
      }

      if (isMod && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabs[index]) {
          const tab = tabs[index]
          if (!tab.content && !tab.isLoading && tab.type !== 'diff') {
            await useEditorStore.getState().loadTabContent(tab.id)
          }
          useEditorStore.getState().setActiveTab(tab.id)
        }
      }

      if (e.key === 'Escape') {
        const { commandPaletteVisible, searchPanelVisible } = useUIStore.getState()
        if (commandPaletteVisible) {
          toggleCommandPalette()
        } else if (searchPanelVisible) {
          toggleSearchPanel()
        }
      }

      if (isMod && e.key === ',') {
        e.preventDefault()
        setSidebarView('settings')
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
