/**
 * BUG-B: 市场详情「权限」tab 在安装前看不到具体权限，安装后才能看到。
 *
 * 行为契约: 市场索引条目声明了 permissions（wire format 新增可选字段）时，
 * 未安装状态下权限 tab 必须直接渲染权限列表（作者声明的"将请求"权限），
 * 而不是显示"市场清单未声明该插件的权限项"空状态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PluginMarketDetail } from '@/components/Plugin/PluginMarketDetail'
import type { PluginIndex, PluginIndexEntry } from '@/types/plugin'
import zhCN from '@/i18n/locales/zh-CN.json'

// ─── Hoisted mocks (referenced inside vi.mock factories) ────────────────────
const { mockMarketState, mockPluginState } = vi.hoisted(() => ({
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// 用真实 zh-CN 语言包做 t()，保证断言落在用户可见文案上。
vi.mock('react-i18next', () => {
  const resolve = (obj: Record<string, unknown>, path: string): unknown => {
    const parts = path.split('.')
    let cur: unknown = obj
    for (let i = 0; i < parts.length; i++) {
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, parts[i])) {
        cur = (cur as Record<string, unknown>)[parts[i]]
      } else {
        return undefined
      }
    }
    return cur
  }
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        let s = (resolve(zhCN as unknown as Record<string, unknown>, key) as string)
          ?? (opts?.defaultValue as string)
          ?? key
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

vi.mock('@/lib/plugin-market', () => ({
  downloadPluginZip: vi.fn(),
  installPluginFromBytes: vi.fn(),
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
    signatureB64: '',
    pubkeyB64: '',
    dependencies: [],
    ...overrides,
  }
}

describe('BUG-B: 权限 tab 安装前展示索引声明的权限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未安装且 entry.permissions 非空时，权限 tab 渲染权限列表而非空状态', () => {
    const entry = makeEntry({
      id: 'com.test.permed',
      name: 'Permed Plugin',
      permissions: ['storage', 'events'],
    })
    const index: PluginIndex = {
      schemaVersion: 1,
      updatedAt: '',
      pubkeyB64: '',
      plugins: [entry],
    }

    const { getByTestId } = render(
      <PluginMarketDetail
        entry={entry}
        index={index}
        localVersion={null}
        onClose={() => {}}
      />,
    )

    // 切到权限 tab
    fireEvent.click(getByTestId('pmd-tab-permissions'))

    // 必须渲染两条权限行（当前实现安装前只显示空状态 → RED）
    expect(getByTestId('pmd-permissions-list')).toBeTruthy()
    const rows = document.querySelectorAll('[data-testid="pmd-permission-row"]')
    expect(rows.length).toBe(2)
  })

  it('未安装且索引未声明权限时，仍显示空状态提示', () => {
    const entry = makeEntry({ id: 'com.test.noperm' })
    const index: PluginIndex = {
      schemaVersion: 1,
      updatedAt: '',
      pubkeyB64: '',
      plugins: [entry],
    }

    const { getByTestId } = render(
      <PluginMarketDetail
        entry={entry}
        index={index}
        localVersion={null}
        onClose={() => {}}
      />,
    )

    fireEvent.click(getByTestId('pmd-tab-permissions'))
    // 空状态文案（索引确实没声明 → 引导安装后查看）
    expect(document.body.textContent).toContain('市场清单未声明该插件的权限项。')
  })
})
