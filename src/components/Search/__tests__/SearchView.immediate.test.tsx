/**
 * SearchView 即时搜索测试：
 * 1. 输入停止 300ms 后自动搜索；连续输入只触发最后一次（防抖）
 * 2. 回车立即搜索并取消挂起计时器，300ms 内无重复调用
 * 3. workspace 多根合并为单次 invoke，roots 传全部根
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchView } from '../SearchView'
import { TooltipProvider } from '@/components'
import { useWorkspaceStore, useUIStore } from '@/stores'

vi.mock('react-i18next', async (importOriginal) => {
  // 保留 initReactI18next 等真实导出（i18n 模块加载链依赖），仅替换 hook
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))
// jsdom 无布局，真实 useVirtualizer 尺寸恒为 0 不渲染任何项；
// mock 为展开全部 items，使 DOM 断言可行
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; getItemKey?: (i: number) => string }) => ({
    getTotalSize: () => opts.count * 24,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: opts.getItemKey?.(index) ?? String(index),
        size: 24,
        start: index * 24,
      })),
  }),
}))
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return { ...actual, searchInFiles: vi.fn(async () => []) }
})

import { searchInFiles } from '@/lib/tauri'
const mockSearch = vi.mocked(searchInFiles)

const ROOT = '/tmp/sw-search-view-test'

function setupFolderMode() {
  useWorkspaceStore.setState({ rootPath: ROOT, workspaceFolders: [] })
  useUIStore.setState({ workspaceMode: 'folder' })
}

function getInput() {
  return screen.getByPlaceholderText('search.placeholder') as HTMLInputElement
}

describe('SearchView 即时搜索', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setupFolderMode()
    mockSearch.mockClear()
    mockSearch.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('输入停止 300ms 后自动搜索；连续输入只触发最后一次（防抖）', async () => {
    render(
      <TooltipProvider>
        <SearchView />
      </TooltipProvider>
    )
    act(() => { vi.advanceTimersByTime(0) }) // 首挂载空 query 计时器直接执行完（runSearch 空查询短路）

    const input = getInput()
    act(() => { fireEvent.change(input, { target: { value: 'a' } }) })
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { fireEvent.change(input, { target: { value: 'ab' } }) })
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { fireEvent.change(input, { target: { value: 'abc' } }) })
    act(() => { vi.advanceTimersByTime(299) })
    expect(mockSearch).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    await act(async () => {}) // flush microtasks
    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: 'abc',
      roots: [ROOT],
    }))
  })

  it('回车立即搜索并取消挂起的防抖计时器（300ms 内无重复调用）', async () => {
    render(
      <TooltipProvider>
        <SearchView />
      </TooltipProvider>
    )
    act(() => { vi.advanceTimersByTime(0) })

    const input = getInput()
    act(() => { fireEvent.change(input, { target: { value: 'hello' } }) })
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await act(async () => {})
    expect(mockSearch).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(500) })
    await act(async () => {})
    expect(mockSearch).toHaveBeenCalledTimes(1)
  })

  it('workspace 多根合并单次 invoke，roots 传全部根', async () => {
    useWorkspaceStore.setState({ rootPath: '', workspaceFolders: ['/w1', '/w2'] })
    useUIStore.setState({ workspaceMode: 'workspace' })
    render(
      <TooltipProvider>
        <SearchView />
      </TooltipProvider>
    )
    act(() => { vi.advanceTimersByTime(0) })

    const input = getInput()
    act(() => { fireEvent.change(input, { target: { value: 'multi' } }) })
    act(() => { vi.advanceTimersByTime(300) })
    await act(async () => {})
    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      roots: ['/w1', '/w2'],
    }))
  })

  it('输入变化期间保留旧结果列表渲染（防闪动回归）', async () => {
    // 首次搜索返回 1 个文件结果
    mockSearch.mockResolvedValueOnce([{
      file_path: `${ROOT}/note.md`,
      file_name: 'note.md',
      line_matches: [{ line_number: 1, content: 'hello world', start_col: 0, end_col: 5 }],
    }])
    render(
      <TooltipProvider>
        <SearchView />
      </TooltipProvider>
    )
    act(() => { vi.advanceTimersByTime(0) })

    const input = getInput()
    act(() => { fireEvent.change(input, { target: { value: 'hello' } }) })
    act(() => { vi.advanceTimersByTime(300) })
    await act(async () => {})
    expect(screen.getByText('note.md')).toBeTruthy() // 结果已显示

    // 继续输入：列表不应被 placeholder/spinner 替换（旧结果保留渲染）
    act(() => { fireEvent.change(input, { target: { value: 'hello w' } }) })
    expect(screen.getByText('note.md')).toBeTruthy()

    // 新结果（空）返回后替换为「未找到」
    mockSearch.mockResolvedValueOnce([])
    act(() => { vi.advanceTimersByTime(300) })
    await act(async () => {})
    expect(screen.queryByText('note.md')).toBeNull()
    expect(screen.getByText('search.notFound')).toBeTruthy()
  })
})
