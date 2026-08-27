/**
 * bindingKey 解析一致性测试
 *
 * 验证 pluginId:commandId 的解析策略在所有使用处一致：
 * - dispatchBuiltin (useKeyboardShortcuts.ts) — lastIndexOf(':')
 * - prunePluginCommandShortcuts (stores/ui.ts) — lastIndexOf(':')
 * - 派发循环 (useKeyboardShortcuts.ts) — lastIndexOf(':') [已修复]
 *
 * 核心场景：reverse-DNS 风格的 pluginId 包含冒号，
 * 如 "com.foo.bar:baz:cmd" 应解析为 pluginId="com.foo.bar:baz", commandId="cmd"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: () => null,
}))

import { findConflictingPluginCommandKey, dispatchBuiltin } from '@/hooks/useKeyboardShortcuts'
import { useUIStore } from '@/stores/ui'
import { toast } from 'sonner'

function fakeKeyEvent(shortcut: string, keyOverrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const parts = shortcut.split('+')
  const mainKey = parts[parts.length - 1]
  const ctrl = parts.includes('Ctrl') || parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  return {
    key: mainKey,
    ctrlKey: ctrl,
    metaKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    preventDefault: vi.fn(),
    target: null,
    ...keyOverrides,
  } as unknown as KeyboardEvent
}

describe('bindingKey 解析一致性', () => {
  beforeEach(() => {
    useUIStore.setState({ pluginCommandShortcuts: {}, customShortcuts: {} })
    vi.mocked(toast).mockClear()
  })

  describe('findConflictingPluginCommandKey — 简单 pluginId', () => {
    it('com.foo:bar 格式正确返回 bindingKey', () => {
      useUIStore.setState({
        pluginCommandShortcuts: { 'com.foo:bar': 'Ctrl+P' },
      })
      const e = fakeKeyEvent('Ctrl+P')
      expect(findConflictingPluginCommandKey(e)).toBe('com.foo:bar')
    })
  })

  describe('findConflictingPluginCommandKey — reverse-DNS pluginId', () => {
    it('com.foo.bar:baz:cmd 格式正确返回 bindingKey', () => {
      useUIStore.setState({
        pluginCommandShortcuts: { 'com.foo.bar:baz:cmd': 'Ctrl+P' },
      })
      const e = fakeKeyEvent('Ctrl+P')
      expect(findConflictingPluginCommandKey(e)).toBe('com.foo.bar:baz:cmd')
    })
  })

  describe('dispatchBuiltin — reverse-DNS pluginId 冲突 toast', () => {
    it('com.foo.bar:baz:cmd 的 toast 显示 pluginId 为 "com.foo.bar:baz"', () => {
      useUIStore.setState({
        pluginCommandShortcuts: { 'com.foo.bar:baz:cmd': 'Ctrl+P' },
      })
      const e = fakeKeyEvent('Ctrl+P')
      const action = vi.fn()
      dispatchBuiltin(e, 'commandPalette', action)

      expect(toast).toHaveBeenCalledTimes(1)
      const [message] = vi.mocked(toast).mock.calls[0] as [string]
      // toast 应显示 pluginId（最后一个冒号之前的部分）
      expect(message).toContain('com.foo.bar:baz')
      // commandId "cmd" 不应出现在 pluginId 部分
      expect(message).not.toMatch(/com\.foo\.bar:baz:cmd/)
    })
  })

  describe('纯函数 — lastIndexOf 解析逻辑', () => {
    it('简单 bindingKey "a:b" → pluginId="a", commandId="b"', () => {
      const key = 'a:b'
      const lastColon = key.lastIndexOf(':')
      expect(key.slice(0, lastColon)).toBe('a')
      expect(key.slice(lastColon + 1)).toBe('b')
    })

    it('reverse-DNS "com.foo.bar:baz:cmd" → pluginId="com.foo.bar:baz", commandId="cmd"', () => {
      const key = 'com.foo.bar:baz:cmd'
      const lastColon = key.lastIndexOf(':')
      expect(key.slice(0, lastColon)).toBe('com.foo.bar:baz')
      expect(key.slice(lastColon + 1)).toBe('cmd')
    })

    it('三级冒号 "a:b:c:d" → pluginId="a:b:c", commandId="d"', () => {
      const key = 'a:b:c:d'
      const lastColon = key.lastIndexOf(':')
      expect(key.slice(0, lastColon)).toBe('a:b:c')
      expect(key.slice(lastColon + 1)).toBe('d')
    })
  })
})
