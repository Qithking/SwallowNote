/**
 * dev-fix: plugin-update-badge-mismatch
 * 管理页「更新」按钮判定（pluginHasUpdateAvailable）——与角标 updateIdSet 同源。
 *
 * 复刻实测 bug 场景：picgo / secret-disk 为 upload 安装（manifest 版本落后于
 * 市场索引版本），Rust check_plugin_updates 跳过 upload 安装的插件 →
 * marketUpdates 为空 → 旧逻辑误报「暂无可用更新」。
 */
import { describe, it, expect } from 'vitest'
import {
  pluginHasUpdateAvailable,
  isHostVersionCompatible,
  filterHostCompatibleEntries,
  isPlatformCompatible,
  normaliseIndex,
} from '../plugin-market'
import type { PluginIndex, PluginUpdateInfo } from '@/types/plugin'

/** 构造最小市场索引（测试只依赖 plugins[].id / version 字段） */
function makeIndex(entries: Array<{ id: string; version: string }>): PluginIndex {
  return {
    schemaVersion: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    pubkeyB64: '',
    plugins: entries.map((e) => ({
      id: e.id,
      name: e.id,
      version: e.version,
      description: '',
      author: '',
      tags: [],
      downloadUrl: '',
      sha256: '',
      signatureB64: '',
      pubkeyB64: '',
      publishedAt: undefined,
      dependencies: [],
      versions: [],
    })),
  } as unknown as PluginIndex
}

describe('pluginHasUpdateAvailable：管理页「更新」按钮判定（与角标同源）', () => {
  it('bug 复现：upload 安装（marketUpdates 为空）→ 回退市场索引比较，有更新', () => {
    // picgo：upload 安装，manifest 0.1.0，市场索引 0.1.2；
    // Rust 端跳过 upload 安装 → marketUpdates 为空。
    const result = pluginHasUpdateAvailable({
      pluginId: 'picgo',
      localVersion: '0.1.0',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([{ id: 'picgo', version: '0.1.2' }]),
    })
    expect(result).toBe(true)
  })

  it('bug 复现（第二实例）：secret-disk upload 安装 0.1.6 → 0.1.7，有更新', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'secret-disk',
      localVersion: '0.1.6',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([{ id: 'secret-disk', version: '0.1.7' }]),
    })
    expect(result).toBe(true)
  })

  it('marketUpdates 有条目（市场安装的插件）→ 有更新', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'mindmap',
      localVersion: '0.2.1',
      marketUpdates: [{ id: 'mindmap', localVersion: '0.2.1', remoteVersion: '0.2.2', sha256: '' }],
      marketIndex: makeIndex([{ id: 'mindmap', version: '0.2.2' }]),
    })
    expect(result).toBe(true)
  })

  it('版本一致且 marketUpdates 为空 → 无更新', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'wenyan',
      localVersion: '0.1.6',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([{ id: 'wenyan', version: '0.1.6' }]),
    })
    expect(result).toBe(false)
  })

  it('不在市场索引且 marketUpdates 为空 → 无更新（不误报）', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'custom-local',
      localVersion: '1.0.0',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([]),
    })
    expect(result).toBe(false)
  })

  it('marketIndex 为 null 且 marketUpdates 为空 → 无更新', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'picgo',
      localVersion: '0.1.0',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: null,
    })
    expect(result).toBe(false)
  })

  // I17：回退路径曾用字符串 !== 比较——本地版本比市场索引新（如手动升级过）
  // 时会被误报「有更新」。须走 isNewerVersion 严格 semver 比较。
  it('I17：本地版本比市场索引新（手动升级过）→ 不误报有更新', () => {
    const result = pluginHasUpdateAvailable({
      pluginId: 'picgo',
      localVersion: '0.2.0',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([{ id: 'picgo', version: '0.1.2' }]),
    })
    expect(result).toBe(false)
  })

  it('I17：市场索引版本严格更新于本地（semver）→ 有更新', () => {
    // 0.10.0 > 0.9.0 仅 semver 成立（字典序 '0.10.0' < '0.9.0'）
    const result = pluginHasUpdateAvailable({
      pluginId: 'mindmap',
      localVersion: '0.9.0',
      marketUpdates: [] as PluginUpdateInfo[],
      marketIndex: makeIndex([{ id: 'mindmap', version: '0.10.0' }]),
    })
    expect(result).toBe(true)
  })
})

describe('isHostVersionCompatible：宿主版本与 minHostVersion 比较', () => {
  it('无要求（缺失/空/空白）→ 恒兼容', () => {
    expect(isHostVersionCompatible('0.1.0', undefined)).toBe(true)
    expect(isHostVersionCompatible('0.1.0', '')).toBe(true)
    expect(isHostVersionCompatible('0.1.0', '   ')).toBe(true)
  })

  it('宿主版本未知 → 保守放行（避免取版本失败误隐藏全部条目）', () => {
    expect(isHostVersionCompatible(null, '9.9.9')).toBe(true)
    expect(isHostVersionCompatible(undefined, '0.1.0')).toBe(true)
  })

  it('host >= min → 兼容（含相等）；host < min → 不兼容', () => {
    expect(isHostVersionCompatible('0.1.0', '0.1.0')).toBe(true)
    expect(isHostVersionCompatible('0.2.0', '0.1.0')).toBe(true)
    expect(isHostVersionCompatible('0.0.9', '0.1.0')).toBe(false)
    expect(isHostVersionCompatible('1.0.0', '2.0.0')).toBe(false)
  })

  it('semver 比较而非字典序（0.10.0 > 0.9.0）', () => {
    expect(isHostVersionCompatible('0.10.0', '0.9.0')).toBe(true)
    expect(isHostVersionCompatible('0.9.0', '0.10.0')).toBe(false)
  })
})

describe('filterHostCompatibleEntries：索引过滤', () => {
  it('宿主不满足 minHostVersion 的条目被过滤，其余保留', () => {
    const index = makeIndex([
      { id: 'ok', version: '0.1.0' },
      { id: 'too-new', version: '0.2.0' },
    ])
    // too-new 要求宿主 >= 9.9.9
    ;(index.plugins[1] as { minHostVersion?: string }).minHostVersion = '9.9.9'
    const filtered = filterHostCompatibleEntries(index, '0.1.0')
    expect(filtered.plugins.map((p) => p.id)).toEqual(['ok'])
  })

  it('无 minHostVersion 的索引 → 全部保留（原索引不受影响）', () => {
    const index = makeIndex([{ id: 'a', version: '0.1.0' }])
    const filtered = filterHostCompatibleEntries(index, '0.1.0')
    expect(filtered.plugins).toHaveLength(1)
    expect(filtered.plugins).not.toBe(index.plugins)
  })

  it('宿主版本未知 → 全部保留', () => {
    const index = makeIndex([{ id: 'a', version: '0.1.0' }])
    ;(index.plugins[0] as { minHostVersion?: string }).minHostVersion = '9.9.9'
    expect(filterHostCompatibleEntries(index, null).plugins).toHaveLength(1)
  })
})

describe('normaliseIndex：min_host_version 字段转换', () => {
  it('snake_case min_host_version 转 camelCase；缺失为 undefined', () => {
    const raw = {
      schema_version: 1,
      updated_at: '2026-11-10T00:00:00Z',
      pubkey_b64: '',
      plugins: [
        {
          id: 'com.swallownote.ai',
          name: 'AI 助手',
          version: '0.1.0',
          download_url: './ai/com.swallownote.ai.zip',
          sha256: 'aa',
          min_host_version: '0.1.0',
        },
        {
          id: 'com.swallownote.mindmap',
          name: '思维导图',
          version: '0.2.2',
          download_url: './mindmap/com.swallownote.mindmap.zip',
          sha256: 'bb',
        },
      ],
    }
    const index = normaliseIndex(raw)
    expect(index.plugins[0]?.minHostVersion).toBe('0.1.0')
    expect(index.plugins[1]?.minHostVersion).toBeUndefined()
  })

  it('snake_case platforms 转 camelCase：非空字符串项保留，缺失/非数组为 undefined', () => {
    const raw = {
      schema_version: 1,
      updated_at: '',
      pubkey_b64: '',
      plugins: [
        {
          id: 'a',
          name: 'A',
          version: '0.1.0',
          download_url: './a.zip',
          sha256: 'aa',
          platforms: ['darwin-aarch64', '', 'windows-x86_64'],
        },
        { id: 'b', name: 'B', version: '0.1.0', download_url: './b.zip', sha256: 'bb' },
        { id: 'c', name: 'C', version: '0.1.0', download_url: './c.zip', sha256: 'cc', platforms: 'not-array' },
      ],
    }
    const index = normaliseIndex(raw)
    expect(index.plugins[0]?.platforms).toEqual(['darwin-aarch64', 'windows-x86_64'])
    expect(index.plugins[1]?.platforms).toBeUndefined()
    expect(index.plugins[2]?.platforms).toBeUndefined()
  })
})

describe('isPlatformCompatible：条目平台兼容判定（显示层门禁）', () => {
  it('platforms 缺失/空/全空白 → 兼容（纯前端插件与旧格式索引）', () => {
    expect(isPlatformCompatible('darwin-aarch64', undefined)).toBe(true)
    expect(isPlatformCompatible('darwin-aarch64', [])).toBe(true)
    expect(isPlatformCompatible('darwin-aarch64', ['', '   '])).toBe(true)
  })

  it('宿主平台未知 → 保守放行（取平台失败不误禁全部条目）', () => {
    expect(isPlatformCompatible(null, ['windows-x86_64'])).toBe(true)
    expect(isPlatformCompatible(undefined, ['windows-x86_64'])).toBe(true)
  })

  it('列表含宿主平台 → 兼容；仅其它平台 → 不兼容', () => {
    expect(isPlatformCompatible('darwin-aarch64', ['darwin-aarch64'])).toBe(true)
    expect(isPlatformCompatible('darwin-aarch64', ['windows-x86_64', 'darwin-aarch64'])).toBe(true)
    expect(isPlatformCompatible('darwin-aarch64', ['windows-x86_64'])).toBe(false)
  })

  it('条目项空白 trim 后参与比较；大小写敏感（平台目录名约定全小写）', () => {
    expect(isPlatformCompatible('darwin-aarch64', [' darwin-aarch64 '])).toBe(true)
    expect(isPlatformCompatible('darwin-aarch64', ['Darwin-AARCH64'])).toBe(false)
  })
})
