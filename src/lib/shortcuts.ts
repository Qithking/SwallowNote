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
  { key: 'deleteFile', defaultKey: 'Delete' },
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

export function formatShortcutForDisplay(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  if (!isMac) return shortcut
  return shortcut
    .replace('Ctrl+', '⌘+')
    .replace('Shift+', '⇧+')
    .replace('Alt+', '⌥+')
}
