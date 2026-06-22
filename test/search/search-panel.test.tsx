/**
 * SearchPanel 真实搜索闭环测试（Task 5.3）。
 *
 * 覆盖：
 *  1. flattenSearchResults：Tauri 层级结构 → 扁平 SearchResult 映射
 *  2. handleSearch：空 query / 空 rootPath / 成功 / 错误四条路径
 *
 * 通过 vi.mock('@/lib/tauri', …) 拦截 searchInFiles，避免拉起 Tauri runtime。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  SearchPanel,
  flattenSearchResults,
} from '@/components/SearchPanel'
import { useUIStore, useWorkspaceStore } from '@/stores'
import type { SearchResult as TSearchResult } from '@/lib/tauri'
// 复用项目真实的 en 资源，避免 i18n key 结构漂移
import enResources from '@/i18n/locales/en.json'

// ─── Tauri command 拦截 ──────────────────────────────────────────────────────
const searchInFilesMock = vi.fn<
  Parameters<unknown[] extends [] ? never : never>,
  Promise<TSearchResult[]>
>()

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri')
  return {
    ...actual,
    searchInFiles: (...args: unknown[]) => searchInFilesMock(...args) as Promise<TSearchResult[]>,
  }
})

// ─── i18n stub ───────────────────────────────────────────────────────────────
// 与 src/i18n/index.ts 保持一致：默认 namespace = 'translation'
// 直接复用真实 en.json，避免翻译 key 漂移
let i18nReady: Promise<void> | null = null
function ensureI18n() {
  if (!i18nReady) {
    i18nReady = i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: enResources } },
      interpolation: { escapeValue: false },
    })
  }
  return i18nReady
}

async function renderPanel() {
  await ensureI18n()
  return render(
    <I18nextProvider i18n={i18next}>
      <SearchPanel />
    </I18nextProvider>,
  )
}

beforeEach(() => {
  searchInFilesMock.mockReset()
  // Reset both stores to a known state before every test
  useUIStore.setState({ searchPanelVisible: true, workspaceMode: 'folder' })
  useWorkspaceStore.setState({ rootPath: '/workspace', workspaceFolders: [] })
})

/**
 * 触发一个会真正更新 React 受控 input 的 'input' 事件。
 * 直接设置 `input.value` 不会让 React 看到变更（React 用
 * `Object.defineProperty` 重写了 setter 跟踪值），必须用原生 setter
 * 走一遍 React 期望的更新路径。
 */
function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

// ─── flattenSearchResults ────────────────────────────────────────────────────
describe('flattenSearchResults', () => {
  it('TC-SP-01: 单文件单匹配 → 1 个扁平行', () => {
    const flat = flattenSearchResults([
      {
        file_path: '/workspace/note.md',
        file_name: 'note.md',
        line_matches: [
          { line_number: 3, content: 'hello world', start_col: 0, end_col: 5 },
        ],
      },
    ])
    expect(flat).toEqual([
      {
        path: '/workspace/note.md',
        line: 3,
        column: 0,
        content: 'hello world',
        preview: 'hello world',
      },
    ])
  })

  it('TC-SP-02: 多文件多匹配 → 全部拍平，顺序保留', () => {
    const flat = flattenSearchResults([
      {
        file_path: '/workspace/a.md',
        file_name: 'a.md',
        line_matches: [
          { line_number: 1, content: 'aaa', start_col: 0, end_col: 3 },
          { line_number: 5, content: 'bbb', start_col: 2, end_col: 5 },
        ],
      },
      {
        file_path: '/workspace/b.md',
        file_name: 'b.md',
        line_matches: [
          { line_number: 9, content: 'ccc', start_col: 4, end_col: 7 },
        ],
      },
    ])
    expect(flat).toHaveLength(3)
    expect(flat.map((r) => r.path)).toEqual(['/workspace/a.md', '/workspace/a.md', '/workspace/b.md'])
    expect(flat.map((r) => r.line)).toEqual([1, 5, 9])
    expect(flat.map((r) => r.column)).toEqual([0, 2, 4])
  })

  it('TC-SP-03: 超长 content 截断 preview 保留 200 字符', () => {
    const long = 'x'.repeat(500)
    const flat = flattenSearchResults([
      {
        file_path: '/workspace/big.md',
        file_name: 'big.md',
        line_matches: [{ line_number: 1, content: long, start_col: 0, end_col: 1 }],
      },
    ])
    expect(flat[0].content).toHaveLength(500)
    expect(flat[0].preview).toHaveLength(201) // 200 + 省略号
    expect(flat[0].preview.endsWith('…')).toBe(true)
  })

  it('TC-SP-04: 空输入 → 空数组', () => {
    expect(flattenSearchResults([])).toEqual([])
  })

  it('TC-SP-05: 文件无匹配 → 不产生行', () => {
    const flat = flattenSearchResults([
      { file_path: '/workspace/empty.md', file_name: 'empty.md', line_matches: [] },
    ])
    expect(flat).toEqual([])
  })
})

// ─── handleSearch 行为 ───────────────────────────────────────────────────────
describe('SearchPanel handleSearch', () => {
  // i18next 在 en.json 中有两个 `search` 块；i18next 走深度优先，命中
  // SearchView 用的那个（`placeholder: "Search"`）。我们以应用真实渲染为准。
  const PLACEHOLDER = 'Search'

  it('TC-SP-10: 空 query 不调用 Tauri，直接清空结果', async () => {
    const { getByPlaceholderText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await act(async () => {
      // 用户按 Enter 但没有输入内容
      input.focus()
      // 不触发 onChange 写入值，直接派发 Enter
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    // Tauri command 一次都不该被调用
    expect(searchInFilesMock).not.toHaveBeenCalled()
  })

  it('TC-SP-11: 有 query 但无 rootPath → 不调用 Tauri', async () => {
    useWorkspaceStore.setState({ rootPath: null, workspaceFolders: [] })
    const { getByPlaceholderText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await act(async () => {
      setReactInputValue(input, 'react')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await waitFor(() => {
      expect(searchInFilesMock).not.toHaveBeenCalled()
    })
  })

  it('TC-SP-12: folder 模式 + 有 rootPath → 调用 searchInFiles 一次', async () => {
    searchInFilesMock.mockResolvedValueOnce([
      {
        file_path: '/workspace/note.md',
        file_name: 'note.md',
        line_matches: [
          { line_number: 7, content: 'react hook', start_col: 0, end_col: 5 },
        ],
      },
    ])
    const { getByPlaceholderText, getByText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await act(async () => {
      setReactInputValue(input, 'react')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await waitFor(() => {
      expect(searchInFilesMock).toHaveBeenCalledTimes(1)
    })
    // 调用参数：root_path 用 rootPath，query 用 trimmed
    const call = searchInFilesMock.mock.calls[0][0] as { query: string; root_path: string }
    expect(call.query).toBe('react')
    expect(call.root_path).toBe('/workspace')
    // 渲染出结果行
    await waitFor(() => {
      expect(getByText('/workspace/note.md')).toBeInTheDocument()
      expect(getByText('react hook')).toBeInTheDocument()
    })
  })

  it('TC-SP-13: workspace 模式 + 多文件夹 → 多次调用 searchInFiles 并合并', async () => {
    useUIStore.setState({ workspaceMode: 'workspace' })
    useWorkspaceStore.setState({
      rootPath: null,
      workspaceFolders: ['/ws/a', '/ws/b'],
    })
    searchInFilesMock
      .mockResolvedValueOnce([
        {
          file_path: '/ws/a/note.md',
          file_name: 'note.md',
          line_matches: [{ line_number: 1, content: 'aaa', start_col: 0, end_col: 3 }],
        },
      ])
      .mockResolvedValueOnce([
        {
          file_path: '/ws/b/note.md',
          file_name: 'note.md',
          line_matches: [{ line_number: 2, content: 'bbb', start_col: 0, end_col: 3 }],
        },
      ])

    const { getByPlaceholderText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await act(async () => {
      setReactInputValue(input, 'a')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await waitFor(() => {
      expect(searchInFilesMock).toHaveBeenCalledTimes(2)
    })
    const roots = searchInFilesMock.mock.calls.map(
      (c) => (c[0] as { root_path: string }).root_path,
    )
    expect(roots).toEqual(['/ws/a', '/ws/b'])
  })

  it('TC-SP-14: Tauri command 抛错 → 不崩溃、isSearching 最终回到 false、results 清空', async () => {
    useWorkspaceStore.setState({ rootPath: '/workspace', workspaceFolders: [] })
    searchInFilesMock.mockRejectedValueOnce(new Error('boom'))
    const { getByPlaceholderText, queryByText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await act(async () => {
      setReactInputValue(input, 'react')
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    // isSearching 应当最终为 false（loading 文案不再出现）
    await waitFor(() => {
      expect(queryByText('Loading...')).not.toBeInTheDocument()
    })
    // 不应该出现崩溃文案
    expect(queryByText(/Error/)).not.toBeInTheDocument()
  })

  it('TC-SP-15: Esc 触发 toggleSearchPanel', async () => {
    const toggleSpy = vi.fn()
    const originalToggle = useUIStore.getState().toggleSearchPanel
    useUIStore.setState({ toggleSearchPanel: toggleSpy })
    try {
      const { getByPlaceholderText } = await renderPanel()
      const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(toggleSpy).toHaveBeenCalled()
    } finally {
      useUIStore.setState({ toggleSearchPanel: originalToggle })
    }
  })

  it('TC-SP-16: 组件挂载时 input 自动获得焦点', async () => {
    const { getByPlaceholderText } = await renderPanel()
    const input = getByPlaceholderText(PLACEHOLDER) as HTMLInputElement
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })
})
