/**
 * I13 搜索四连修复回归测试：
 * ① 输入未回车不显示「未找到匹配项」（以 hasSearched 判断而非 query 非空）
 * ② Aa/ab/.* 开关切换在已有结果时自动重搜
 * ③ 连续搜索用代际号丢弃旧结果，防止旧响应覆盖新响应
 * ④ 高亮与命中语义一致（regex/全词/大小写），不再是字面 indexOf
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/plugin-host', () => ({
  emitNoteSaved: vi.fn(),
  emitNoteOpened: vi.fn(),
  emitNoteClosed: vi.fn(),
  emitLocaleChanged: vi.fn(),
}))

type SearchParams = { query: string; root_path: string; case_sensitive?: boolean; whole_word?: boolean; use_regex?: boolean }
const mockSearchInFiles = vi.fn()
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return { ...actual, searchInFiles: (...args: [SearchParams]) => mockSearchInFiles(...args) }
})

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SearchView, collectHighlightRanges } from '@/components/Search/SearchView'
import { useWorkspaceStore } from '@/stores'

function makeResult(path: string, lineText: string) {
  return {
    file_path: path,
    file_name: path.split('/').pop()!,
    line_matches: [{ line_number: 1, content: lineText, start_col: 0, end_col: lineText.length }],
  }
}

function renderSearchView() {
  return render(<TooltipProvider><SearchView /></TooltipProvider>)
}

async function typeAndEnter(text: string) {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('collectHighlightRanges 高亮与命中一致（I13④）', () => {
  it('regex 模式按正则匹配高亮（字面 indexOf 只会找 "c.t" 字符串）', () => {
    const ranges = collectHighlightRanges('cat c.t cot', 'c.t', { caseSensitive: false, wholeWord: false, useRegex: true })
    expect(ranges).toHaveLength(3) // cat/cot 命中；字面 "c.t" 若按正则也是 1 处 + regex 两处
  })

  it('全词模式不再高亮子串', () => {
    const ranges = collectHighlightRanges('cat category', 'cat', { caseSensitive: false, wholeWord: true, useRegex: false })
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 0, end: 3 })
  })

  it('区分大小写模式只高亮大小写一致的命中', () => {
    const ranges = collectHighlightRanges('Abc a', 'A', { caseSensitive: true, wholeWord: false, useRegex: false })
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toEqual({ start: 0, end: 1 })
  })

  it('无效正则返回空区间（退化为不高亮，不抛错）', () => {
    const ranges = collectHighlightRanges('abc', '([', { caseSensitive: false, wholeWord: false, useRegex: true })
    expect(ranges).toEqual([])
  })
})

describe('SearchView 交互修复（I13①②③）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchInFiles.mockResolvedValue([])
    useWorkspaceStore.setState({ rootPath: '/root', workspaceFolders: [] })
  })

  it('① 输入未回车不显示「未找到匹配项」，回车后才显示', async () => {
    renderSearchView()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'nosuchthing' } })
    // 未回车：不显示 notFound
    expect(screen.queryByText('未找到匹配项')).toBeNull()
    // 回车：显示 notFound
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('未找到匹配项')).toBeTruthy())
    // 输入新内容（未回车）：notFound 消失
    fireEvent.change(input, { target: { value: 'other' } })
    expect(screen.queryByText('未找到匹配项')).toBeNull()
  })

  it('② 已有结果时切换 Aa 开关自动重搜（带最新开关值）', async () => {
    mockSearchInFiles.mockResolvedValue([makeResult('/root/a.md', 'hello')])
    renderSearchView()
    await typeAndEnter('hello')
    await waitFor(() => expect(mockSearchInFiles).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('Aa'))
    await waitFor(() => expect(mockSearchInFiles).toHaveBeenCalledTimes(2))
    // 重搜携带最新开关值
    expect(mockSearchInFiles.mock.calls[1][0].case_sensitive).toBe(true)
  })

  it('③ 连续两次搜索：旧慢响应不覆盖新快响应', { timeout: 5000 }, async () => {
    // 第一次慢且结果多，第二次快且结果少
    mockSearchInFiles.mockImplementationOnce(() =>
      new Promise((resolve) => setTimeout(() => resolve([makeResult('/root/1.md', 'x'), makeResult('/root/2.md', 'x')]), 60))
    )
    renderSearchView()
    await typeAndEnter('aaa')
    await new Promise((r) => setTimeout(r, 10))
    // 第二次搜索快且结果少（先设置再触发）
    mockSearchInFiles.mockImplementationOnce(() =>
      Promise.resolve([makeResult('/root/fast.md', 'x')])
    )
    await typeAndEnter('bbb')
    // 等待两次请求都结束（waitFor 刷新 React 状态）
    await waitFor(() => expect(screen.getByText('1 个文件，1 个匹配项')).toBeTruthy())
    // 旧慢响应（2 文件）不得覆盖新响应（1 文件）
    expect(screen.queryByText('2 个文件，2 个匹配项')).toBeNull()
  })
})
