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
  | 'findReplace'
  | 'toggleSidebar'
  | 'settings'
  | 'renameFile'
  | 'deleteFile'
  | 'logViewer'

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
  { key: 'searchPanel', defaultKey: 'Ctrl+Shift+F' },
  { key: 'findReplace', defaultKey: 'Ctrl+F' },
  { key: 'toggleSidebar', defaultKey: 'Ctrl+B' },
  { key: 'settings', defaultKey: 'Ctrl+,' },
  { key: 'renameFile', defaultKey: 'F2' },
  { key: 'deleteFile', defaultKey: 'Ctrl+Delete' },
  { key: 'logViewer', defaultKey: 'Ctrl+Shift+Y' },
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

/** 映射 e.code 到规范化键名；macOS Alt 键通过 e.code 归一化 */
const CODE_TO_KEY: Record<string, string> = {
  // Letters
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) =>
      [`Key${String.fromCharCode(65 + i)}`, String.fromCharCode(65 + i)])
  ),
  // Digits
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`Digit${i}`, String(i)])
  ),
  // Punctuation
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  // Whitespace / special
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
}

function codeToKeyName(code: string): string | null {
  // F1-F12 不在表中，但符合简单模式直接返回
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return CODE_TO_KEY[code] ?? null
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

  const keyLower = e.key.toLowerCase()

  // 主匹配：直接比较 e.key
  let keyMatch = keyLower === mainKey

  // macOS Delete 与 Backspace 互相兼容
  if (!keyMatch) {
    if (mainKey === 'delete' && keyLower === 'backspace') keyMatch = true
    else if (mainKey === 'backspace' && keyLower === 'delete') keyMatch = true
  }

  if (!keyMatch) {
    const codeKey = codeToKeyName(e.code)
    if (codeKey !== null) {
      keyMatch = codeKey.toLowerCase() === mainKey
    }
  }

  return ctrlMatch && shiftMatch && altMatch && keyMatch
}

export function parseKeyEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  if (e.key === 'Escape') return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  let keyName = e.key

  if (e.altKey) {
    const codeKey = codeToKeyName(e.code)
    if (codeKey !== null) {
      keyName = codeKey
    }
  }

  if (keyName === ' ') keyName = 'Space'
  else if (keyName.length === 1) keyName = keyName.toUpperCase()
  else keyName = keyName.charAt(0).toUpperCase() + keyName.slice(1)

  parts.push(keyName)
  return parts.join('+')
}

/** 冲突检测的对照来源 */
export type ShortcutConflictSource =
  | { kind: 'builtin'; key: ShortcutKey; label: string }
  | { kind: 'plugin-command'; bindingKey: string; label: string }
  | { kind: 'custom-builtin'; key: ShortcutKey; label: string }

export interface ShortcutConflict {
  source: ShortcutConflictSource
  /** 供 UI 直接展示的本地化冲突描述 */
  message: string
}

export function findShortcutConflictDetailed(
  /** 用于排除自身的 binding identity */
  selfId: string | null,
  value: string,
  customShortcuts: Record<string, string>,
  pluginCommandShortcuts: Record<string, string>,
  pluginCommandLabels: Record<string, string>
): ShortcutConflict | null {
  // 1. 内置快捷键（含自定义或默认）
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
  // 2. 防御性分支：仅出现在 customShortcuts 的自定义绑定
  for (const [key, currentKey] of Object.entries(customShortcuts)) {
    if (selfId === key) continue
    if (currentKey !== value) continue
    // 与某内置默认相同则跳过（分支 1 已覆盖）
    const def = DEFAULT_SHORTCUTS.find((d) => d.key === key)
    if (def && def.defaultKey === value) continue
    return {
      source: { kind: 'custom-builtin', key: key as ShortcutKey, label: key },
      message: `与「${key}」冲突`,
    }
  }
  // 3. 插件命令快捷键
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
