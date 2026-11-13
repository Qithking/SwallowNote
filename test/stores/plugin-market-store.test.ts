/**
 * C4 回归：插件市场索引刷新的取消语义。
 *
 * 行为契约：
 * 1. refreshIndex（普通）与 refreshIndexWithProgress（进度）共享同一 AbortController——
 *    任意一方发起新请求时，旧请求（无论哪种类型）必须被 abort，
 *    防止慢响应回来覆盖新状态（旧实现两个独立 controller，跨类型互不取消）。
 * 2. 旧请求被取代后不得回写任何状态（isFetchingIndex / index / fetchProgress）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePluginMarketStore } from '@/stores/plugin-market'

const { fetchPluginIndexCached, fetchWithProgress, checkPluginUpdates } = vi.hoisted(() => ({
  fetchPluginIndexCached: vi.fn(),
  fetchWithProgress: vi.fn(),
  checkPluginUpdates: vi.fn(),
}))

vi.mock('@/lib/plugin-market', () => ({
  fetchPluginIndexCached,
  fetchWithProgress,
  checkPluginUpdates,
  invalidateIndexCache: vi.fn(),
  normaliseIndex: vi.fn((raw: unknown) => raw),
  filterHostCompatibleEntries: vi.fn(async (index: { plugins: unknown[] }) => index),
}))

vi.mock('@/lib/tauri', () => ({
  listMarketSources: vi.fn().mockResolvedValue([]),
  addMarketSource: vi.fn().mockResolvedValue(undefined),
  removeMarketSource: vi.fn().mockResolvedValue(undefined),
  setActiveMarketSource: vi.fn().mockResolvedValue(undefined),
  getActiveMarketSource: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('0.2.0'),
}))

vi.mock('@/stores/plugin', () => ({
  usePluginStore: { getState: () => ({ plugins: [] }) },
}))

function resetStore() {
  usePluginMarketStore.setState({
    repoUrl: 'https://example.com/repo.json',
    index: null,
    isFetchingIndex: false,
    fetchError: null,
    fetchProgress: 0,
    updates: [],
    isCheckingUpdates: false,
  })
}

describe('C4 回归: 插件市场刷新共享 AbortController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('进度刷新发起时取消进行中的普通刷新（跨类型取消）', async () => {
    const signals: AbortSignal[] = []
    fetchPluginIndexCached.mockImplementation(async (_url: string, signal?: AbortSignal) => {
      signals.push(signal!)
      return new Promise<never>(() => {}) // 旧请求永不返回
    })
    fetchWithProgress.mockImplementation(async (_url: string, _cb: unknown, signal?: AbortSignal) => {
      signals.push(signal!)
      return JSON.stringify({ plugins: [] })
    })

    // 启动普通刷新（同步段已创建 controller，之后挂起）
    void usePluginMarketStore.getState().refreshIndex()
    // 发起进度刷新 → 必须取消第一个请求
    await usePluginMarketStore.getState().refreshIndexWithProgress()

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('普通刷新发起时取消进行中的进度刷新（跨类型取消，反向）', async () => {
    const signals: AbortSignal[] = []
    fetchWithProgress.mockImplementation(async (_url: string, _cb: unknown, signal?: AbortSignal) => {
      signals.push(signal!)
      return new Promise<never>(() => {})
    })
    fetchPluginIndexCached.mockImplementation(async (_url: string, signal?: AbortSignal) => {
      signals.push(signal!)
      return { plugins: [] }
    })

    void usePluginMarketStore.getState().refreshIndexWithProgress()
    await usePluginMarketStore.getState().refreshIndex()

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('被取代的旧请求完成后不得覆盖新状态', async () => {
    let resolveOldFetch!: (v: { plugins: string[] }) => void
    fetchPluginIndexCached.mockImplementation(async () => {
      return new Promise((resolve) => {
        resolveOldFetch = () => resolve({ plugins: ['old'] })
      })
    })
    fetchWithProgress.mockImplementation(async () => JSON.stringify({ plugins: ['new'] }))

    void usePluginMarketStore.getState().refreshIndex()
    await usePluginMarketStore.getState().refreshIndexWithProgress()

    // 新请求已完成
    expect(usePluginMarketStore.getState().index).toEqual({ plugins: ['new'] })
    expect(usePluginMarketStore.getState().isFetchingIndex).toBe(false)

    // 旧请求此刻才完成：必须因 aborted 直接返回，不覆盖
    resolveOldFetch({ plugins: ['old'] })
    await new Promise((r) => setTimeout(r, 0))
    expect(usePluginMarketStore.getState().index).toEqual({ plugins: ['new'] })
    expect(usePluginMarketStore.getState().fetchProgress).toBe(100)
  })
})
