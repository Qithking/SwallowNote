/**
 * 语言包 JSON 完整性测试
 * Source: plan/i18n-audit step 1 (Phase 1, P0)
 *
 * AC-1: zh-CN.json 和 en.json 中不存在重复的顶级键
 * AC-6: 语言包键集一致(嵌套键全覆盖)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function findDuplicateTopLevelKeys(rawJson: string): string[] {
  // 顶级键:行首恰好 2 空格 + "key":
  const keyPattern = /^ {2}"(\w+)":/gm
  const keys: string[] = []
  let match: RegExpExecArray | null
  while ((match = keyPattern.exec(rawJson)) !== null) {
    keys.push(match[1])
  }
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const k of keys) {
    if (seen.has(k)) dupes.add(k)
    else seen.add(k)
  }
  return [...dupes]
}

function readLocale(filename: string): string {
  return readFileSync(resolve(__dirname, '../../src/i18n/locales', filename), 'utf-8')
}

// 将嵌套对象展平为点分键路径集合
function flattenKeys(obj: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        flattenKeys(v, key, out)
      } else {
        out.add(key)
      }
    }
  }
  return out
}

function loadLocale(filename: string): Record<string, unknown> {
  return JSON.parse(readLocale(filename))
}

describe('i18n 语言包 JSON 完整性', () => {
  it('zh-CN.json 不存在重复的顶级键', () => {
    const raw = readLocale('zh-CN.json')
    const dupes = findDuplicateTopLevelKeys(raw)
    expect(dupes).toEqual([])
  })

  it('en.json 不存在重复的顶级键', () => {
    const raw = readLocale('en.json')
    const dupes = findDuplicateTopLevelKeys(raw)
    expect(dupes).toEqual([])
  })

  it('zh-CN.json 和 en.json 顶级键集一致', () => {
    const zhRaw = readLocale('zh-CN.json')
    const enRaw = readLocale('en.json')
    const zhAll = new Set([...zhRaw.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]))
    const enAll = new Set([...enRaw.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]))
    const onlyInZh = [...zhAll].filter((k) => !enAll.has(k))
    const onlyInEn = [...enAll].filter((k) => !zhAll.has(k))
    expect({ onlyInZh, onlyInEn }).toEqual({ onlyInZh: [], onlyInEn: [] })
  })

  it('zh-CN.json 和 en.json 完整嵌套键集一致', () => {
    const zhKeys = flattenKeys(loadLocale('zh-CN.json'))
    const enKeys = flattenKeys(loadLocale('en.json'))
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort()
    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k)).sort()
    expect({ onlyInZh, onlyInEn }).toEqual({ onlyInZh: [], onlyInEn: [] })
  })

  it('ai.emptyFormula 孤儿键不存在于语言包中', () => {
    // ai.emptyFormula 是错误遗留的未使用键，editor.katex.emptyFormula 才是正确的键路径
    const zhKeys = flattenKeys(loadLocale('zh-CN.json'))
    const enKeys = flattenKeys(loadLocale('en.json'))
    expect(zhKeys.has('ai.emptyFormula')).toBe(false)
    expect(enKeys.has('ai.emptyFormula')).toBe(false)
  })
})
