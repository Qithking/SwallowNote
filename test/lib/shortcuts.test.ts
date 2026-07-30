/**
 * matchShortcut 与 parseKeyEvent 单元测试
 *
 * 覆盖快捷键匹配和解析的核心逻辑：
 * - 基本修饰键+字母组合
 * - Shift 组合
 * - 功能键 (F2)
 * - Ctrl+Delete 匹配
 * - macOS Delete/Backspace 兼容（仅 macOS）
 * - 修饰键排他性（不需要的修饰键不能存在）
 * - parseKeyEvent 的各种输入
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { matchShortcut, parseKeyEvent } from '@/lib/shortcuts'

function fakeKeyEvent(shortcut: string, keyOverrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const parts = shortcut.split('+')
  const mainKey = parts[parts.length - 1]
  const ctrl = parts.includes('Ctrl') || parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  return {
    key: mainKey,
    code: `Key${mainKey.toUpperCase()}`,
    ctrlKey: ctrl,
    metaKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: null,
    ...keyOverrides,
  } as unknown as KeyboardEvent
}

describe('matchShortcut', () => {
  it('匹配 Ctrl+S', () => {
    const e = fakeKeyEvent('Ctrl+S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(true)
  })

  it('匹配 Ctrl+Shift+S', () => {
    const e = fakeKeyEvent('Ctrl+Shift+S')
    expect(matchShortcut(e, 'Ctrl+Shift+S')).toBe(true)
  })

  it('匹配 Ctrl+Alt+S', () => {
    const e = fakeKeyEvent('Ctrl+Alt+S')
    expect(matchShortcut(e, 'Ctrl+Alt+S')).toBe(true)
  })

  it('匹配 F2 (无修饰键)', () => {
    const e = fakeKeyEvent('F2', { code: 'F2' })
    expect(matchShortcut(e, 'F2')).toBe(true)
  })

  it('匹配 Ctrl+Delete', () => {
    const e = fakeKeyEvent('Ctrl+Delete', { key: 'Delete', code: 'Delete' })
    expect(matchShortcut(e, 'Ctrl+Delete')).toBe(true)
  })

  it('匹配 Ctrl+, (逗号)', () => {
    const e = fakeKeyEvent('Ctrl+,', { key: ',', code: 'Comma' })
    expect(matchShortcut(e, 'Ctrl+,')).toBe(true)
  })

  it('Ctrl+S 不匹配 Ctrl+Shift+S', () => {
    const e = fakeKeyEvent('Ctrl+S')
    expect(matchShortcut(e, 'Ctrl+Shift+S')).toBe(false)
  })

  it('Ctrl+Shift+S 不匹配 Ctrl+S', () => {
    const e = fakeKeyEvent('Ctrl+Shift+S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('不带修饰键的 S 不匹配 Ctrl+S', () => {
    const e = fakeKeyEvent('S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('Ctrl+P 不匹配 Ctrl+S', () => {
    const e = fakeKeyEvent('Ctrl+P')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('需要 Ctrl 但没有修饰键时不匹配', () => {
    const e = fakeKeyEvent('S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('不需要 Ctrl 但有 Ctrl 时不匹配', () => {
    const e = fakeKeyEvent('Ctrl+S')
    expect(matchShortcut(e, 'S')).toBe(false)
  })

  it('不需要 Shift 但有 Shift 时不匹配', () => {
    const e = fakeKeyEvent('Ctrl+Shift+S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('不需要 Alt 但有 Alt 时不匹配', () => {
    const e = fakeKeyEvent('Ctrl+Alt+S')
    expect(matchShortcut(e, 'Ctrl+S')).toBe(false)
  })

  it('macOS 上 Ctrl 匹配 metaKey', () => {
    const e = fakeKeyEvent('Ctrl+S', { ctrlKey: false, metaKey: true })
    expect(matchShortcut(e, 'Ctrl+S')).toBe(true)
  })

  it('Ctrl+Backspace 不匹配 Ctrl+Delete（非 macOS）', () => {
    const e = fakeKeyEvent('Ctrl+Backspace', { key: 'Backspace', code: 'Backspace' })
    // 在非 macOS 环境（测试环境），Ctrl+Backspace 不应匹配 Ctrl+Delete
    expect(matchShortcut(e, 'Ctrl+Delete')).toBe(false)
  })

  it('Delete 不匹配 Backspace（非 macOS）', () => {
    const e = fakeKeyEvent('Backspace', { key: 'Backspace', code: 'Backspace' })
    expect(matchShortcut(e, 'Backspace')).toBe(true)
    // 不应误匹配到 Delete
    const e2 = fakeKeyEvent('Delete', { key: 'Delete', code: 'Delete' })
    expect(matchShortcut(e2, 'Backspace')).toBe(false)
  })

  it('通过 e.code 匹配 Alt+字母键', () => {
    // Alt 修饰下 e.key 可能因键盘布局变化，但 e.code 稳定
    const e = fakeKeyEvent('Alt+A', { key: 'å', code: 'KeyA' })
    expect(matchShortcut(e, 'Alt+A')).toBe(true)
  })
})

describe('parseKeyEvent', () => {
  it('纯修饰键返回 null', () => {
    expect(parseKeyEvent(fakeKeyEvent('Ctrl', { key: 'Control' }))).toBeNull()
    expect(parseKeyEvent(fakeKeyEvent('Shift', { key: 'Shift' }))).toBeNull()
    expect(parseKeyEvent(fakeKeyEvent('Alt', { key: 'Alt' }))).toBeNull()
    expect(parseKeyEvent(fakeKeyEvent('Meta', { key: 'Meta' }))).toBeNull()
  })

  it('Escape 返回 null', () => {
    expect(parseKeyEvent(fakeKeyEvent('Escape', { key: 'Escape' }))).toBeNull()
  })

  it('Ctrl+字母键生成 "Ctrl+X" 格式', () => {
    const result = parseKeyEvent(fakeKeyEvent('Ctrl+S'))
    expect(result).toBe('Ctrl+S')
  })

  it('Ctrl+Shift+字母键生成 "Ctrl+Shift+X" 格式', () => {
    const result = parseKeyEvent(fakeKeyEvent('Ctrl+Shift+S'))
    expect(result).toBe('Ctrl+Shift+S')
  })

  it('单字母键生成大写字母', () => {
    const result = parseKeyEvent(fakeKeyEvent('a', { ctrlKey: false, metaKey: false }))
    expect(result).toBe('A')
  })

  it('Alt+字母键通过 e.code 归一化', () => {
    const e = fakeKeyEvent('Alt+A', { key: 'å', code: 'KeyA' })
    const result = parseKeyEvent(e)
    expect(result).toBe('Alt+A')
  })

  it('空格键映射为 "Space"', () => {
    const e = fakeKeyEvent('Ctrl+Space', { key: ' ', code: 'Space' })
    const result = parseKeyEvent(e)
    expect(result).toBe('Ctrl+Space')
  })

  it('F2 功能键保留原名', () => {
    const e = fakeKeyEvent('F2', { code: 'F2' })
    const result = parseKeyEvent(e)
    expect(result).toBe('F2')
  })
})
