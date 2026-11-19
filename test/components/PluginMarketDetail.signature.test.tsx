/**
 * BUG: 安装插件报 "ed25519 pubkey must be 32 bytes (got 0)"
 *
 * 行为契约: 市场安装（installEntry → installPluginFromBytes）必须把索引中的
 * 签名与公钥传给宿主 —— Rust 侧 verify_ed25519 对空 pubkey 直接拒绝。
 * 当前实现漏传 pubkeyB64/signatureB64（installPluginFromBytes 默认 ''），
 * 空公钥解码 0 字节 → 安装必然失败。
 *
 * 数据源优先级: entry.pubkeyB64 优先，缺省回退 repo 级 index.pubkeyB64
 * （effectivePubkey 的既有语义）；签名取 entry.signatureB64。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { PluginMarketDetail } from '@/components/Plugin/PluginMarketDetail'
import type { PluginIndex, PluginIndexEntry } from '@/types/plugin'
import zhCN from '@/i18n/locales/zh-CN.json'

const { installMock, mockMarketState, mockPluginState } = vi.hoisted(() => ({
  installMock: vi.fn(),
  mockMarketState: {
    repoUrl: 'https://example.com/repo.json',
    refreshUpdates: vi.fn().mockResolvedValue(undefined),
  },
  mockPluginState: {
    plugins: [] as Array<{ id: string; version: string; dependencies: string[] }>,
    setPlugins: vi.fn(),
    setLoadFailures: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// 与 dependencies 测试同款 locale-backed translator
vi.mock('react-i18next', () => {
  const resolve = (obj: Record<string, unknown>, path: string): unknown => {
    const parts = path.split('.')
    let cur: unknown = obj
    for (const p of parts) {
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = (cur as Record<string, unknown>)[p]
      } else {
        return undefined
      }
    }
    return cur
  }
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        let s =
          (resolve(zhCN as unknown as Record<string, unknown>, key) as string) ??
          (opts?.defaultValue as string) ??
          key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return s
      },
    }),
  }
})

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? children : null),
  DialogContent: ({ children }: any) => children,
}))

vi.mock('@/components/ui/button', () => ({
  Button: function MockButton({ children, onClick, disabled, ...rest }: any) {
    return (
      <button onClick={onClick} disabled={disabled} data-testid={rest['data-testid']}>
        {children}
      </button>
    )
  },
}))

// installMock 记录完整入参 —— 契约断言的数据来源
vi.mock('@/lib/plugin-market', () => ({
  downloadPluginZip: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  installPluginFromBytes: installMock,
  effectivePubkey: vi.fn((index: PluginIndex, entry: PluginIndexEntry) =>
    entry.pubkeyB64 || index.pubkeyB64),
  isPlatformCompatible: vi.fn(() => true),
}))

vi.mock('@/lib/plugin-loader', () => ({
  loadAllPlugins: vi.fn().mockResolvedValue({ plugins: [], failures: [] }),
}))

vi.mock('@/lib/tauri', () => ({
  scanPlugins: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/stores', () => ({
  usePluginMarketStore: Object.assign(
    (selector: (s: typeof mockMarketState) => unknown) => selector(mockMarketState),
    { getState: () => mockMarketState },
  ),
  usePluginStore: Object.assign(
    (selector: (s: typeof mockPluginState) => unknown) => selector(mockPluginState),
    { getState: () => mockPluginState },
  ),
}))

function makeEntry(overrides: Partial<PluginIndexEntry>): PluginIndexEntry {
  return {
    id: 'x',
    name: 'x',
    version: '1.0.0',
    description: '',
    author: '',
    tags: [],
    downloadUrl: 'https://example.com/x.zip',
    sha256: 'sha',
    signatureB64: 'sig-entry',
    pubkeyB64: '',
    dependencies: [],
    ...overrides,
  }
}

function makeFixture() {
  const entry = makeEntry({ id: 'com.test.app', name: 'App' })
  const index: PluginIndex = {
    schemaVersion: 1,
    updatedAt: '',
    pubkeyB64: 'pk-index-level',
    plugins: [entry],
  }
  return { entry, index }
}

describe('BUG: 市场安装必须携带签名与公钥（ed25519 pubkey got 0）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMock.mockResolvedValue({ id: 'x', version: '1.0.0' })
  })

  it('点击安装时 installPluginFromBytes 必须收到非空 pubkey（entry 缺省回退 repo 级）与非空 signature', async () => {
    const { entry, index } = makeFixture()
    const { getByTestId } = render(
      <PluginMarketDetail entry={entry} index={index} localVersion={null} onClose={() => {}} />,
    )

    fireEvent.click(getByTestId('plugin-install'))

    await waitFor(() => {
      expect(installMock).toHaveBeenCalled()
    })

    const args = installMock.mock.calls[0][0]
    // 当前实现漏传这两个字段 → installPluginFromBytes 默认 '' → Rust 报 pubkey got 0
    expect(args.pubkeyB64).toBe('pk-index-level')
    expect(args.signatureB64).toBe('sig-entry')
  })

  it('entry 自带 pubkey 时优先使用 entry 级公钥', async () => {
    const { index } = makeFixture()
    const entry = makeEntry({ id: 'com.test.app', name: 'App', pubkeyB64: 'pk-entry-level' })
    const { getByTestId } = render(
      <PluginMarketDetail entry={entry} index={index} localVersion={null} onClose={() => {}} />,
    )

    fireEvent.click(getByTestId('plugin-install'))

    await waitFor(() => {
      expect(installMock).toHaveBeenCalled()
    })
    expect(installMock.mock.calls[0][0].pubkeyB64).toBe('pk-entry-level')
  })
})
