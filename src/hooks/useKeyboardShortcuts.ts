import { useEffect, useRef } from 'react'
import { useUIStore, useEditorStore, useFileTreeStore, useWorkspaceStore, type FileNode, type Theme } from '@/stores'
import { ShortcutKey, matchShortcut, getShortcutKey } from '@/lib/shortcuts'
import { openFolderDialog, openWorkspaceDialog, createFile } from '@/lib/tauri'
import { loadDirectory } from '@/lib/api'
import { invoke } from '@tauri-apps/api/core'
import { emitLocaleChanged } from '@/lib/plugin-host'
import { listPluginCommands } from '@/lib/plugin-commands'
import { toast } from 'sonner'
import i18n from 'i18next'

function getShortcut(key: ShortcutKey): string {
  return getShortcutKey(key, useUIStore.getState().customShortcuts)
}

/**
 * Return the first `<pluginId>:<commandId>` key whose stored
 * shortcut string matches `e`, or `null` if no plugin command
 * is bound to this key combination. Used by the
 * `useKeyboardShortcuts` built-in matcher to surface a
 * "shadows a plugin command" warning toast — the user
 * rebound a built-in shortcut but a plugin command was
 * already sitting on the same key, and the host silently
 * favoured the built-in (the previous behaviour). The
 * toast gives the user a chance to fix the conflict
 * instead of wondering why their plugin command stopped
 * firing.
 *
 * We return only the binding key (not the full command
 * object) so the caller doesn't have to know how to look
 * up the registered command — the toast is generic and
 * only needs to know "something is here".
 *
 * Exported (not just module-level) so the matching logic
 * can be unit-tested without standing up a React tree.
 * The function reads from the live `useUIStore` snapshot,
 * which is fine for tests because the test setup already
 * calls `setState` on the store before invoking the
 * function.
 */
export function findConflictingPluginCommandKey(e: KeyboardEvent): string | null {
  const bindings = useUIStore.getState().pluginCommandShortcuts
  for (const [bindingKey, value] of Object.entries(bindings)) {
    if (!value) continue
    if (matchShortcut(e, value)) return bindingKey
  }
  return null
}

/**
 * Match a built-in shortcut key against the current event and
 * dispatch its handler. When a plugin command is bound to the
 * same key combination we surface a sonner toast warning
 * (fourth-round review / M16) so the user knows their plugin
 * command is being shadowed. The built-in action still runs —
 * changing the precedence here would silently break every
 * existing user's muscle memory. The toast is short
 * (1.5s) and de-duplicated per keypress; we don't pre-check
 * whether the user already saw it because a fresh toast on
 * every press gives the user a chance to fix the conflict
 * the moment they start wondering why their plugin command
 * isn't firing.
 *
 * `e.preventDefault()` is called only after we know the
 * match is real so we never consume a keypress that the
 * editor / CodeMirror / BlockNote would have wanted.
 *
 * Exported for the same reason as
 * `findConflictingPluginCommandKey`: the dispatch helper
 * is a pure function of `(event, key, action, useUIStore
 * state, sonner)`, and standing up a React tree to test
 * the "toast appears on conflict" contract would be both
 * fragile and slow.
 *
 * Wave B / M1: the toast now carries an explicit
 * description that names the built-in action that
 * "won" the keystroke (e.g. "已执行 commandPalette,请在
 * 设置中解绑"). Without it the user sees "插件 X 的
 * 快捷键被占用" in the toast body *and* the action's
 * side effect (palette opening, file saving, …) and has
 * to guess why both happened.
 *
 * Wave B / M2: in addition to the stable sonner `id`
 * (Wave A / C1) we throttle re-shows of the same
 * conflict within a 200ms window. A user who holds
 * Ctrl+S to spam-save would otherwise still queue a
 * fresh toast (with the same id) on every keydown —
 * sonner does *not* dedupe on the message string, only
 * on the explicit `id`; and the `id` collapse still
 * costs a render. The throttle keeps the toast corner
 * quiet when the user is consciously rapid-pressing.
 */
const PLUGIN_CONFLICT_THROTTLE_MS = 200
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
    // Strip the trailing `:<commandId>` so the toast reads
    // "<pluginId> 命令 与内置快捷键冲突" instead of
    // dumping the raw "<pluginId>:<commandId>" key. The
    // plugin id may itself contain colons (reverse-DNS
    // style "com.foo.bar:baz"), so we split on the *last*
    // colon only — same convention the settings panel uses
    // to render the row (see
    // `useUIStore.prunePluginCommandShortcuts`).
    const lastColon = pluginBinding.lastIndexOf(':')
    const pluginId =
      lastColon > 0 ? pluginBinding.slice(0, lastColon) : pluginBinding
    // Wave B / M2: same-key rapid presses would otherwise
    // re-render the toast on every keydown even though the
    // sonner `id` collapses the queue. We additionally
    // short-circuit when the last toast for this binding
    // key was shown within `PLUGIN_CONFLICT_THROTTLE_MS`,
    // so a user holding Ctrl+S for 1s doesn't get a visible
    // toast refresh. The flag is per binding key (not
    // global) so a Ctrl+S conflict and a Ctrl+P conflict
    // can each still surface independently.
    const now = Date.now()
    const lastShown = lastPluginConflictShownAt.get(pluginBinding) ?? 0
    if (now - lastShown >= PLUGIN_CONFLICT_THROTTLE_MS) {
      lastPluginConflictShownAt.set(pluginBinding, now)
      // Wave B / M1: surface the built-in action that just
      // ran in the toast description. Without it the toast
      // reads as a contradiction: "plugin X's shortcut is
      // shadowed" *and* the palette opens / file saves —
      // the user has to guess which side won. The
      // description text is sourced from i18n (zh-CN / en)
      // so translators can adjust the wording.
      toast(i18n.t('settings.pluginCommandShadowed', { id: pluginId }), {
        // Wave A / C1: stable id so the same conflict
        // doesn't stack a new toast on every keypress.
        id: `plugin-conflict-${key}`,
        description: i18n.t('settings.pluginCommandShadowedDesc', {
          action: key,
        }),
        // Wave B / M1: 1.5s is too short to read both the
        // title and the new description. Bump to 3s.
        duration: 3000,
      })
    }
  }
  void action()
  return true
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
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)
  const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setSidebarView = useUIStore((s) => s.setSidebarView)

  // Use refs for tabs to avoid re-binding the keydown listener on every tab change.
  // This prevents excessive listener teardown/setup which causes GC pressure.
  const tabsRef = useRef(useEditorStore.getState().tabs)
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      tabsRef.current = state.tabs
    })
    return unsub
  }, [])

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Only handle shortcuts explicitly registered in DEFAULT_SHORTCUTS.
      // Never intercept system-native editing shortcuts (⌘C/⌘V/⌘A/⌘Z/⌘X etc.)
      // or browser/editor built-in shortcuts. This ensures BlockNote, CodeMirror,
      // and the system clipboard all work normally.

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

      // Customizable global shortcuts (user can rebind in Settings)

      if (dispatchBuiltin(e, 'commandPalette', toggleCommandPalette)) return
      if (dispatchBuiltin(e, 'searchPanel', toggleSearchPanel)) return
      if (dispatchBuiltin(e, 'toggleSidebar', toggleSidebar)) return
      if (
        dispatchBuiltin(e, 'settings', () => setSidebarView('settings'))
      )
        return

      // Plugin commands (Task 9 / G9): after the built-in
      // shortcuts we let plugin-registered commands claim any
      // remaining key combination the user has bound. We look up
      // the binding in `useUIStore().pluginCommandShortcuts` on
      // every keypress so a freshly bound / unbound shortcut is
      // picked up without rebuilding the listener. The `when()`
      // predicate is intentionally not re-checked here — a
      // command that's currently hidden via `when()` should still
      // be triggerable by a direct shortcut if the user
      // explicitly bound one. Plugins that want state-aware
      // gating are expected to do it inside `onTrigger`.
      const bindings = useUIStore.getState().pluginCommandShortcuts
      for (const [bindingKey, value] of Object.entries(bindings)) {
        if (!value) continue
        if (!matchShortcut(e, value)) continue
        const lastColon = bindingKey.lastIndexOf(':')
        if (lastColon <= 0) continue
        const commandId = bindingKey.slice(lastColon + 1)
        const registered = listPluginCommands().find(
          (cmd) =>
            cmd.id === commandId &&
            // Stamp carried on the registry entry; see
            // `RegisteredPluginCommand` in
            // `src/lib/plugin-commands.ts`.
            (cmd as { __pluginId?: string }).__pluginId ===
              bindingKey.slice(0, lastColon)
        )
        if (!registered) continue
        e.preventDefault()
        try {
          void registered.onTrigger()
        } catch (err) {
          // A buggy plugin must not break the global keydown
          // listener. Log and let the next keystroke through.
          // eslint-disable-next-line no-console
          console.error('[useKeyboardShortcuts] plugin onTrigger threw:', err)
        }
        return
      }

      // ⌘1-9 — Tab switching (not in ShortcutKey because it's 9 separate keys,
      // not a single rebindable shortcut. No standard editing shortcut uses mod+digit.)
      const isMod = e.ctrlKey || e.metaKey
      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (tabsRef.current[index]) {
          const tab = tabsRef.current[index]
          // Switch tab immediately for better UX
          useEditorStore.getState().setActiveTab(tab.id)
          // Load content asynchronously after switching tab
          // Check content === undefined to detect unloaded tabs (empty string is valid content)
          if (tab.content === undefined && !tab.isLoading && tab.type !== 'diff' && tab.type !== 'conflict') {
            setTimeout(() => {
              useEditorStore.getState().loadTabContent(tab.id)
            }, 0)
          }
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
  ])
}
