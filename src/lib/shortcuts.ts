export type ShortcutKey =
  | 'newFile'
  | 'newFolder'
  | 'openFile'
  | 'saveFile'
  | 'saveAll'
  | 'saveWorkspace'
  | 'closeFile'
  | 'closeAll'
  | 'toggleTheme'
  | 'toggleLanguage'
  | 'openExplorer'
  | 'commandPalette'
  | 'searchPanel'
  | 'toggleSidebar'
  | 'settings'
  | 'renameFile'
  | 'deleteFile'

export interface ShortcutDefinition {
  key: ShortcutKey
  defaultKey: string
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { key: 'newFile', defaultKey: 'Ctrl+N' },
  { key: 'newFolder', defaultKey: 'Ctrl+Shift+N' },
  { key: 'openFile', defaultKey: 'Ctrl+O' },
  { key: 'saveFile', defaultKey: 'Ctrl+S' },
  { key: 'saveAll', defaultKey: 'Ctrl+Shift+S' },
  { key: 'saveWorkspace', defaultKey: 'Ctrl+Alt+S' },
  { key: 'closeFile', defaultKey: 'Ctrl+W' },
  { key: 'closeAll', defaultKey: 'Ctrl+Shift+W' },
  { key: 'toggleTheme', defaultKey: 'Ctrl+Shift+T' },
  { key: 'toggleLanguage', defaultKey: 'Ctrl+Shift+L' },
  { key: 'openExplorer', defaultKey: 'Ctrl+Shift+R' },
  { key: 'commandPalette', defaultKey: 'Ctrl+P' },
  { key: 'searchPanel', defaultKey: 'Ctrl+F' },
  { key: 'toggleSidebar', defaultKey: 'Ctrl+B' },
  { key: 'settings', defaultKey: 'Ctrl+,' },
  { key: 'renameFile', defaultKey: 'F2' },
  { key: 'deleteFile', defaultKey: 'Ctrl+Delete' },
]

export const DEFAULT_SHORTCUTS_MAP: Record<ShortcutKey, string> = Object.fromEntries(
  DEFAULT_SHORTCUTS.map((s) => [s.key, s.defaultKey])
) as Record<ShortcutKey, string>

export function getShortcutKey(
  key: ShortcutKey,
  customShortcuts: Record<string, string>
): string {
  return customShortcuts[key] ?? DEFAULT_SHORTCUTS_MAP[key]
}

export function matchShortcut(
  e: KeyboardEvent,
  shortcutString: string
): boolean {
  const parts = shortcutString.split('+')
  const mainKey = parts[parts.length - 1].toLowerCase()

  const needCtrl = parts.includes('Ctrl')
  const needShift = parts.includes('Shift')
  const needAlt = parts.includes('Alt')

  const isMod = e.ctrlKey || e.metaKey
  const ctrlMatch = needCtrl ? isMod : !isMod
  const shiftMatch = needShift ? e.shiftKey : !e.shiftKey
  const altMatch = needAlt ? e.altKey : !e.altKey

  return ctrlMatch && shiftMatch && altMatch && e.key.toLowerCase() === mainKey
}

export function parseKeyEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  if (e.key === 'Escape') return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  let keyName = e.key
  if (keyName === ' ') keyName = 'Space'
  else if (keyName.length === 1) keyName = keyName.toUpperCase()
  else keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1)

  parts.push(keyName)
  return parts.join('+')
}

export function findShortcutConflict(
  key: ShortcutKey,
  value: string,
  customShortcuts: Record<string, string>
): ShortcutKey | null {
  for (const def of DEFAULT_SHORTCUTS) {
    if (def.key === key) continue
    const currentKey = customShortcuts[def.key] ?? def.defaultKey
    if (currentKey === value) return def.key
  }
  return null
}

/**
 * Sources we can collide against when a shortcut is being bound.
 * Used by the plugin-command recorder (and potentially by future
 * rebind flows) to give the user a clear "this clashes with X"
 * message instead of silently letting two commands claim the
 * same key.
 */
export type ShortcutConflictSource =
  | { kind: 'builtin'; key: ShortcutKey; label: string }
  | { kind: 'plugin-command'; bindingKey: string; label: string }
  | { kind: 'custom-builtin'; key: ShortcutKey; label: string }

export interface ShortcutConflict {
  source: ShortcutConflictSource
  /** Localised description of the conflict, suitable for direct
   *  display in the UI. */
  message: string
}

export function findShortcutConflictDetailed(
  /**
   * Optional identity of the binding being recorded. Pass the
   * same value here that you'll pass to `setPluginCommandShortcut`
   * so we can exclude the current command from its own conflict
   * scan (re-binding to the same key is a no-op, not a conflict).
   * For built-in shortcut recording, pass the `ShortcutKey` value.
   */
  selfId: string | null,
  value: string,
  customShortcuts: Record<string, string>,
  pluginCommandShortcuts: Record<string, string>,
  pluginCommandLabels: Record<string, string>
): ShortcutConflict | null {
  // 1. Built-in shortcuts (customised or default).
  for (const def of DEFAULT_SHORTCUTS) {
    if (selfId === def.key) continue
    const currentKey = customShortcuts[def.key] ?? def.defaultKey
    if (currentKey === value) {
      return {
        source: { kind: 'builtin', key: def.key, label: def.key },
        message: `与「${def.key}」冲突`,
      }
    }
  }
  // 2. Custom-bound built-in shortcuts that are *only* in the
  //    `customShortcuts` map (a user rebound to the same value as
  //    a different default key). This branch is mostly defensive:
  //    the previous loop already catches the "current value
  //    equals the candidate" case for any customShortcuts[key]
  //    that's also a default. Kept for clarity.
  for (const [key, currentKey] of Object.entries(customShortcuts)) {
    if (selfId === key) continue
    if (currentKey !== value) continue
    // Skip if the value is also the default of some other built-in
    // – that case is already covered by branch 1.
    const def = DEFAULT_SHORTCUTS.find((d) => d.key === key)
    if (def && def.defaultKey === value) continue
    return {
      source: { kind: 'custom-builtin', key: key as ShortcutKey, label: key },
      message: `与「${key}」冲突`,
    }
  }
  // 3. Plugin-command shortcuts.
  for (const [bindingKey, currentKey] of Object.entries(pluginCommandShortcuts)) {
    if (selfId !== null && selfId === bindingKey) continue
    if (currentKey !== value) continue
    return {
      source: { kind: 'plugin-command', bindingKey, label: pluginCommandLabels[bindingKey] ?? bindingKey },
      message: `与插件命令「${pluginCommandLabels[bindingKey] ?? bindingKey}」冲突`,
    }
  }
  return null
}

export function formatShortcutForDisplay(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  if (!isMac) return shortcut
  return shortcut
    .replace('Ctrl+', '⌘+')
    .replace('Shift+', '⇧+')
    .replace('Alt+', '⌥+')
}
