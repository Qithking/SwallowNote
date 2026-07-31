/**
 * findShortcutConflictDetailed 冲突消息本地化测试
 *
 * Bug: findShortcutConflictDetailed 在构造冲突消息时，
 * 将原始枚举值（如 'saveFile'）传给 i18n 的 {{key}} 参数，
 * 而非本地化名称（如 '保存文件'）。
 *
 * 这影响 PluginCommandRecorder，它直接使用 found.message 显示冲突提示。
 * ShortcutRecorder 不受影响，因为它为内置冲突构造自己的消息。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: vi.fn(),
  Toaster: () => null,
}))

import { findShortcutConflictDetailed } from '@/lib/shortcuts'
import { useUIStore } from '@/stores/ui'
import i18n from 'i18next'

describe('findShortcutConflictDetailed 冲突消息本地化', () => {
  beforeEach(() => {
    useUIStore.setState({
      pluginCommandShortcuts: {},
      customShortcuts: {},
    })
  })

  it('内置冲突消息应包含本地化名称而非原始枚举值', () => {
    // 模拟一个插件命令绑定到 Ctrl+S，与内置 saveFile 冲突
    const found = findShortcutConflictDetailed(
      'com.test:cmd',
      'Ctrl+S',
      {}, // customShortcuts
      {}, // pluginCommandShortcuts
      {}, // pluginCommandLabels
    )

    expect(found).not.toBeNull()
    expect(found!.source.kind).toBe('builtin')
    expect(found!.source.key).toBe('saveFile')

    // 消息不应包含原始枚举值 'saveFile'
    expect(found!.message).not.toBe('saveFile')

    // 消息应包含本地化名称（zh-CN 默认语言下为 '保存文件'）
    const saveFileLabel = i18n.t('shortcuts.saveFile')
    expect(found!.message).toContain(saveFileLabel)
  })

  it('插件命令冲突消息应包含标签', () => {
    // 使用一个不与任何内置默认快捷键冲突的组合
    const found = findShortcutConflictDetailed(
      'com.self:cmd',
      'Ctrl+Shift+X',
      {},
      { 'com.other:cmd': 'Ctrl+Shift+X' },
      { 'com.other:cmd': 'Export Notes' },
    )

    expect(found).not.toBeNull()
    expect(found!.source.kind).toBe('plugin-command')
    expect(found!.message).toContain('Export Notes')
  })
})
