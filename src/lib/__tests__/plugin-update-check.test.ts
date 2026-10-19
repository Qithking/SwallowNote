/**
 * dev-fix: plugin-update-badge-mismatch
 * 管理页「更新」按钮判定（pluginHasUpdateAvailable）——与角标 updateIdSet 同源。
 *
 * 复刻实测 bug 场景：picgo / secret-disk 为 upload 安装（manifest 版本落后于
 * 市场索引版本），Rust check_plugin_updates 跳过 upload 安装的插件 →
 * marketUpdates 为空 → 旧逻辑误报「暂无可用更新」。
 */
import { describe, it, expect } from 'vitest'
import { pluginHasUpdateAvailable } from '../plugin-market'
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
})
