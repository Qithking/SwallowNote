/**
 * I9 同款修复回归测试：打开文件时 addTab 不得用 `new Date().toLocaleString()`
 * 冒充修改时间。三处调用点（审计 2026-11-15 同款问题）：
 *   1. SearchView.handleResultClick —— 搜索结果点击打开
 *   2. FileTreeContextMenu.handleOpen —— 右键菜单打开（普通文件 + 图片）
 *   3. useEditorLinkHandling.openFileInApp —— 笔记内链接打开
 * 修复后统一走 resolveNodeModifiedTime 取真实 mtime，获取失败返回
 * undefined（保持缺省）而不是「打开时刻」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetFileMetadata = vi.fn()
const mockReadFile = vi.fn()
const mockPathExists = vi.fn()
const mockSearchInFiles = vi.fn()
const mockLoadFileContent = vi.fn()

vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    searchInFiles: (...args: unknown[]) => mockSearchInFiles(...args),
  }
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, loadFileContent: (...args: unknown[]) => mockLoadFileContent(...args) }
})

// useEditorLinkHandling 的类型引用需要这些命名导出存在（hook 内部不在本测试中渲染工具栏）；
// 其余导出（如 createReactBlockSpec）保留真实实现，供 editorBlockTransforms 模块加载用
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useComponentsContext: vi.fn(() => ({})),
    useDictionary: vi.fn(() => ({ link_toolbar: { open: { tooltip: 'open' } } })),
    EditLinkButton: () => null,
    DeleteLinkButton: () => null,
  }
})

// setup.ts 的全局 mock 未导出 open，这里补充该命名导出
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
  Command: vi.fn(),
}))

// jsdom 中容器高度为 0，虚拟化 getVirtualItems 返回空导致结果行不渲染；
// 改为直接渲染全部行（覆盖组件用到的 index/key/size/start 与 getTotalSize）
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (i: number) => number; getItemKey: (i: number) => string }) => ({
    getVirtualItems: () => Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: opts.getItemKey(i),
      size: opts.estimateSize(i),
      start: 0,
    })),
    getTotalSize: () => opts.count * 24,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SearchView } from '@/components/Search/SearchView'
import { TreeNodeContextMenu } from '@/components/FileTree/FileTreeContextMenu'
import { useEditorLinkHandling } from '@/components/editors/useEditorLinkHandling'
import { useEditorStore, useWorkspaceStore } from '@/stores'
import type { FileNode } from '@/stores/filetree'

const REAL_MTIME = '2020-01-02 03:04:05'

function makeResult(path: string, lineText: string) {
  return {
    file_path: path,
    file_name: path.split('/').pop()!,
    line_matches: [{ line_number: 1, content: lineText, start_col: 0, end_col: lineText.length }],
  }
}

const addTabSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useEditorStore.setState({ addTab: addTabSpy } as never)
  useWorkspaceStore.setState({ rootPath: '/root', workspaceFolders: [] })
  mockPathExists.mockResolvedValue(true)
})

describe('SearchView 搜索结果打开文件（I9 同款）', () => {
  it('点击匹配项打开文件：modifiedTime 来自 getFileMetadata 而非当前时间', async () => {
    mockSearchInFiles.mockResolvedValue([makeResult('/root/a.md', 'hello')])
    mockReadFile.mockResolvedValue('hello')
    mockGetFileMetadata.mockResolvedValue({ modified_time: REAL_MTIME, file_size: 5 })

    render(<TooltipProvider><SearchView /></TooltipProvider>)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByText('hello'))

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    expect(mockGetFileMetadata).toHaveBeenCalledWith('/root/a.md')
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBe(REAL_MTIME)
  })

  it('元数据获取失败：modifiedTime 为 undefined（不回退当前时间）', async () => {
    mockSearchInFiles.mockResolvedValue([makeResult('/root/b.md', 'world')])
    mockReadFile.mockResolvedValue('world')
    mockGetFileMetadata.mockRejectedValue(new Error('stat failed'))

    render(<TooltipProvider><SearchView /></TooltipProvider>)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'world' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('world')).toBeTruthy())
    fireEvent.click(screen.getByText('world'))

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBeUndefined()
    expect(addTabSpy.mock.calls[0][0].modifiedTime).not.toBe(new Date().toLocaleString())
  })
})

describe('FileTreeContextMenu 右键打开文件（I9 同款）', () => {
  function renderMenu(node: Partial<FileNode>) {
    render(
      <TreeNodeContextMenu node={node as FileNode}>
        <div data-testid="trigger">{node.name}</div>
      </TreeNodeContextMenu>
    )
    fireEvent.contextMenu(screen.getByTestId('trigger'))
    return waitFor(() => expect(screen.getByText('打开')).toBeTruthy())
  }

  it('普通文件：modifiedTime 来自 getFileMetadata 而非当前时间', async () => {
    mockLoadFileContent.mockResolvedValue('# a')
    mockGetFileMetadata.mockResolvedValue({ modified_time: REAL_MTIME, file_size: 4 })

    await renderMenu({ id: 'a', name: 'a.md', path: '/root/a.md', isDirectory: false })
    fireEvent.click(screen.getByText('打开'))

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    expect(mockGetFileMetadata).toHaveBeenCalledWith('/root/a.md')
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBe(REAL_MTIME)
  })

  it('图片文件：modifiedTime 来自 getFileMetadata 而非当前时间', async () => {
    mockGetFileMetadata.mockResolvedValue({ modified_time: REAL_MTIME, file_size: 1024 })

    await renderMenu({ id: 'p', name: 'p.png', path: '/root/p.png', isDirectory: false })
    fireEvent.click(screen.getByText('打开'))

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    // 图片分支不读取文本内容
    expect(mockLoadFileContent).not.toHaveBeenCalled()
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBe(REAL_MTIME)
  })
})

describe('useEditorLinkHandling 链接打开文件（I9 同款）', () => {
  function renderHarness() {
    let api: ReturnType<typeof useEditorLinkHandling>
    function Harness() {
      api = useEditorLinkHandling(
        { current: null } as React.RefObject<never>,
        { current: null } as React.RefObject<never>
      )
      return null
    }
    render(<Harness />)
    return () => api
  }

  it('打开链接文件：modifiedTime 来自 getFileMetadata 而非当前时间', async () => {
    mockReadFile.mockResolvedValue('body')
    mockGetFileMetadata.mockResolvedValue({ modified_time: REAL_MTIME, file_size: 4 })
    const getApi = renderHarness()

    await getApi().openFileInApp('/root/link.md')

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBe(REAL_MTIME)
  })

  it('元数据获取失败：modifiedTime 为 undefined（不回退当前时间）', async () => {
    mockReadFile.mockResolvedValue('body')
    mockGetFileMetadata.mockRejectedValue(new Error('stat failed'))
    const getApi = renderHarness()

    await getApi().openFileInApp('/root/link.md')

    await waitFor(() => expect(addTabSpy).toHaveBeenCalled())
    expect(addTabSpy.mock.calls[0][0].modifiedTime).toBeUndefined()
    expect(addTabSpy.mock.calls[0][0].modifiedTime).not.toBe(new Date().toLocaleString())
  })
})
