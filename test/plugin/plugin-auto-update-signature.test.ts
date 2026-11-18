/**
 * BUG: 安装插件报 "ed25519 pubkey must be 32 bytes (got 0)" —— 自动更新路径同款契约。
 *
 * 行为契约: runAutoUpdateOnStartup → installOnePlugin → installPluginFromBytes
 * 必须携带 entry.signatureB64 与 effectivePubkey(index, entry)（entry 缺省回退
 * repo 级公钥）。当前实现漏传 → Rust verify_ed25519 对空 pubkey 直接拒绝。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginDefinition, PluginIndex, PluginIndexEntry } from '@/types/plugin'

const { installMock } = vi.hoisted(() => ({ installMock: vi.fn() }))

vi.mock('@/lib/plugin-market', () => ({
  downloadPluginZip: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  installPluginFromBytes: installMock,
  effectivePubkey: vi.fn((index: PluginIndex, entry: PluginIndexEntry) =>
    entry.pubkeyB64 || index.pubkeyB64),
  rollbackPlugin: vi.fn(),
  listPluginVersions: vi
    .fn()
    .mockResolvedValue([{ version: '1.0.0', isActive: true, sizeBytes: 0, installedAt: '' }]),
  isNewerVersion: vi.fn(() => true),
}))

const marketState = {
  repoUrl: 'https://example.com/repo.json',
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  index: null as PluginIndex | null,
}
const pluginState = {
  plugins: [] as PluginDefinition[],
  getPluginAutoUpdate: vi.fn(() => true),
  setPlugins: vi.fn(),
  setLoadFailures: vi.fn(),
}

vi.mock('@/stores/plugin', () => ({
  usePluginStore: Object.assign((sel: any) => sel(pluginState), {
    getState: () => pluginState,
  }),
}))

vi.mock('@/stores/plugin-market', () => ({
  usePluginMarketStore: Object.assign((sel: any) => sel(marketState), {
    getState: () => marketState,
  }),
}))

vi.mock('@/lib/plugin-loader', () => ({
  loadAllPlugins: vi.fn().mockResolvedValue({ plugins: [], failures: [] }),
}))

vi.mock('@/lib/tauri', () => ({
  scanPlugins: vi.fn().mockResolvedValue([]),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key,
    use: vi.fn(function (this: unknown) { return this }),
    init: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {},
}))

import { runAutoUpdateOnStartup } from '@/lib/plugin-auto-update'

function makeEntry(): PluginIndexEntry {
  return {
    id: 'com.test.app',
    name: 'App',
    version: '2.0.0',
    description: '',
    author: '',
    tags: [],
    downloadUrl: 'https://example.com/app.zip',
    sha256: 'sha2',
    signatureB64: 'sig-v2',
    pubkeyB64: '',
    dependencies: [],
  }
}

describe('BUG: 自动更新安装必须携带签名与公钥', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const entry = makeEntry()
    marketState.index = {
      schemaVersion: 1,
      updatedAt: '',
      pubkeyB64: 'pk-index-level',
      plugins: [entry],
    }
    pluginState.plugins = [
      { id: 'com.test.app', name: 'App', version: '1.0.0', dependencies: [] } as PluginDefinition,
    ]
    installMock.mockResolvedValue({ id: 'com.test.app', version: '2.0.0' })
  })

  it('installPluginFromBytes 必须收到 entry 签名与 repo 级回退公钥', async () => {
    const report = await runAutoUpdateOnStartup((key) => key)

    expect(report.installed).toHaveLength(1)
    expect(installMock).toHaveBeenCalled()
    const args = installMock.mock.calls[0][0]
    expect(args.pubkeyB64).toBe('pk-index-level')
    expect(args.signatureB64).toBe('sig-v2')
  })

  it('entry 自带 pubkey 时优先使用 entry 级公钥', async () => {
    const entry = makeEntry()
    entry.pubkeyB64 = 'pk-entry-level'
    marketState.index = {
      schemaVersion: 1,
      updatedAt: '',
      pubkeyB64: 'pk-index-level',
      plugins: [entry],
    }

    await runAutoUpdateOnStartup((key) => key)

    expect(installMock.mock.calls[0][0].pubkeyB64).toBe('pk-entry-level')
  })
})
