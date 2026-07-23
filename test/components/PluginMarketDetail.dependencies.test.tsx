/**
 * E-H7: PluginMarketDetail.tsx 插件依赖安装失败时 toast.error 必须包含失败依赖信息
 *
 * 行为契约: onAutoResolve 中 installEntry 失败时，catch 块必须保留
 * 失败依赖的 id 和错误消息，循环结束后 toast.error 展示具体哪个依赖失败，
 * 而不是只报一个 "{{count}} 个依赖安装失败" 的笼统数字。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { PluginMarketDetail } from '@/components/Plugin/PluginMarketDetail'
import type { PluginIndex, PluginIndexEntry } from '@/types/plugin'

// ─── Hoisted mocks (referenced inside vi.mock factories) ────────────────────
const { toastMock, mockMarketState, mockPluginState } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
  toast: toastMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string) ?? key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
        }
      }
      return s
    },
  }),
}))

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

vi.mock('@/lib/plugin-market', () => ({
  downloadPluginZip: vi.fn().mockRejectedValue(new Error('network down')),
  installPluginFromBytes: vi.fn(),
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

// ─── Test data ──────────────────────────────────────────────────────────────
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
    signatureB64: '',
    pubkeyB64: '',
    dependencies: [],
    ...overrides,
  }
}

describe('E-H7: dependency install failure preserves error info in toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toast.error includes failed dependency id when installEntry throws', async () => {
    const depEntry = makeEntry({
      id: 'com.test.dep',
      name: 'Dep Plugin',
      version: '1.0.0',
      downloadUrl: 'https://example.com/dep.zip',
      sha256: 'dep-sha',
    })
    const rootEntry = makeEntry({
      id: 'com.test.root',
      name: 'Root Plugin',
      version: '1.0.0',
      dependencies: ['com.test.dep@^1.0.0'],
    })
    const index: PluginIndex = {
      schemaVersion: 1,
      updatedAt: '',
      pubkeyB64: '',
      plugins: [rootEntry, depEntry],
    }

    const { getByTestId } = render(
      <PluginMarketDetail
        entry={rootEntry}
        index={index}
        localVersion={null}
        onClose={() => {}}
      />,
    )

    // 点击"自动解决依赖"按钮
    const btn = getByTestId('plugin-auto-resolve')
    fireEvent.click(btn)

    // 等待 toast.error 被调用（installEntry 失败后）
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled()
    })

    // toast.error 的消息必须包含失败的依赖 id（当前代码只报数字 → RED）
    const firstCallArg = toastMock.error.mock.calls[0][0]
    expect(firstCallArg).toContain('com.test.dep')
  })
})
