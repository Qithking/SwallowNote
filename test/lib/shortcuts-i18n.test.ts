/**
 * 快捷键 i18n 完整性测试
 *
 * 验证 DEFAULT_SHORTCUTS 中每个快捷键都有对应的 i18n 翻译，
 * 以及 findShortcutConflictDetailed 使用的冲突提示键也存在。
 *
 * 这是数据层面的静态测试，不需要 React 渲染。
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_SHORTCUTS } from '@/lib/shortcuts'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

// 收集所有嵌套键（展平）
function collectKeys(obj: any, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      collectKeys(obj[k], fullKey).forEach(v => keys.add(v))
    } else {
      keys.add(fullKey)
    }
  }
  return keys
}

const enKeys = collectKeys(en, '')
const zhCNKeys = collectKeys(zhCN, '')

describe('快捷键 i18n 完整性', () => {
  describe('DEFAULT_SHORTCUTS 每个键都有 i18n 翻译', () => {
    for (const def of DEFAULT_SHORTCUTS) {
      it(`shortcuts.${def.key} 在 en.json 中存在`, () => {
        expect(enKeys.has(`shortcuts.${def.key}`)).toBe(true)
      })

      it(`shortcuts.${def.key}.desc 在 en.json 中存在`, () => {
        expect(enKeys.has(`shortcuts.${def.key}.desc`)).toBe(true)
      })

      it(`shortcuts.${def.key} 在 zh-CN.json 中存在`, () => {
        expect(zhCNKeys.has(`shortcuts.${def.key}`)).toBe(true)
      })

      it(`shortcuts.${def.key}.desc 在 zh-CN.json 中存在`, () => {
        expect(zhCNKeys.has(`shortcuts.${def.key}.desc`)).toBe(true)
      })
    }
  })

  describe('冲突检测 i18n 键存在', () => {
    it('shortcuts.conflict.builtin 在 en.json 中存在', () => {
      expect(enKeys.has('shortcuts.conflict.builtin')).toBe(true)
    })

    it('shortcuts.conflict.builtin 在 zh-CN.json 中存在', () => {
      expect(zhCNKeys.has('shortcuts.conflict.builtin')).toBe(true)
    })

    it('shortcuts.conflict.plugin 在 en.json 中存在', () => {
      expect(enKeys.has('shortcuts.conflict.plugin')).toBe(true)
    })

    it('shortcuts.conflict.plugin 在 zh-CN.json 中存在', () => {
      expect(zhCNKeys.has('shortcuts.conflict.plugin')).toBe(true)
    })
  })

  describe('新添加的快捷键 i18n 键', () => {
    it('shortcuts.logViewer 在 en.json 中存在', () => {
      expect(enKeys.has('shortcuts.logViewer')).toBe(true)
    })

    it('shortcuts.logViewer.desc 在 en.json 中存在', () => {
      expect(enKeys.has('shortcuts.logViewer.desc')).toBe(true)
    })

    it('shortcuts.logViewer 在 zh-CN.json 中存在', () => {
      expect(zhCNKeys.has('shortcuts.logViewer')).toBe(true)
    })

    it('shortcuts.logViewer.desc 在 zh-CN.json 中存在', () => {
      expect(zhCNKeys.has('shortcuts.logViewer.desc')).toBe(true)
    })
  })
})
