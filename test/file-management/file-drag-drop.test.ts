import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeDragDrop } from '@/hooks/useFileTreeDragDrop'
import { useFileTreeStore, FileNode } from '@/stores/filetree'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUIStore } from '@/stores/ui'

vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

const createTestNode = (path: string, isDirectory: boolean, children?: FileNode[]): FileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  isDirectory,
  children,
  isExpanded: false,
})

describe('TC-005: 文件拖拽测试', () => {
  const mockNodes: FileNode[] = [
    createTestNode('/test-workspace', true, [
      createTestNode('/test-workspace/file1.md', false),
      createTestNode('/test-workspace/folder', true),
    ]),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.getState().clearAll()
    useWorkspaceStore.getState().setRootPath('/test-workspace')
    useUIStore.getState().setShowAllFiles(false)
    useUIStore.getState().setMarkdownOnly(true)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const createMockDragEvent = (): React.DragEvent => ({
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    dataTransfer: {
      setData: vi.fn(),
      effectAllowed: 'move',
      dropEffect: 'move',
    },
    currentTarget: document.createElement('div'),
    clientX: 100,
    clientY: 100,
  } as unknown as React.DragEvent)

  it('TC-005-01: 拖拽状态初始化', () => {
    const { result } = renderHook(() => useFileTreeDragDrop(mockNodes))
    
    expect(result.current.dragOverPath).toBeNull()
    expect(result.current.dragSourcePaths).toEqual([])
  })

  it('TC-005-02: 开始拖拽单个文件', () => {
    const { result } = renderHook(() => useFileTreeDragDrop(mockNodes))
    const mockEvent = createMockDragEvent()
    const testNode = mockNodes[0].children?.[0]

    expect(testNode).toBeDefined()
    act(() => {
      result.current.handleDragStart(mockEvent, testNode!)
    })

    expect(mockEvent.stopPropagation).toHaveBeenCalled()
    expect(result.current.dragSourcePaths).toEqual(['/test-workspace/file1.md'])
  })

  it('TC-005-03: 拖拽经过目录', () => {
    const { result } = renderHook(() => useFileTreeDragDrop(mockNodes))
    const mockEvent = createMockDragEvent()
    const fileNode = mockNodes[0].children?.[0]
    const folderNode = mockNodes[0].children?.[1]

    expect(fileNode).toBeDefined()
    expect(folderNode).toBeDefined()
    act(() => {
      result.current.handleDragStart(mockEvent, fileNode!)
      result.current.handleDragOver(mockEvent, folderNode!)
    })

    expect(result.current.dragOverPath).toBe('/test-workspace/folder')
  })

  it('TC-005-04: 拖拽离开目录', () => {
    const { result } = renderHook(() => useFileTreeDragDrop(mockNodes))
    const mockEvent = createMockDragEvent()
    const fileNode = mockNodes[0].children?.[0]
    const folderNode = mockNodes[0].children?.[1]

    expect(fileNode).toBeDefined()
    expect(folderNode).toBeDefined()
    act(() => {
      result.current.handleDragStart(mockEvent, fileNode!)
      result.current.handleDragOver(mockEvent, folderNode!)
    })

    expect(result.current.dragOverPath).toBe('/test-workspace/folder')

    const leaveEvent = {
      ...createMockDragEvent(),
      clientX: 0,
      clientY: 0,
      currentTarget: { getBoundingClientRect: () => ({ left: 50, right: 150, top: 50, bottom: 150 }) },
    } as unknown as React.DragEvent

    act(() => {
      result.current.handleDragLeave(leaveEvent)
    })

    expect(result.current.dragOverPath).toBeNull()
  })

  it('TC-005-05: 结束拖拽', () => {
    const { result } = renderHook(() => useFileTreeDragDrop(mockNodes))
    const mockEvent = createMockDragEvent()
    const fileNode = mockNodes[0].children?.[0]

    expect(fileNode).toBeDefined()
    act(() => {
      result.current.handleDragStart(mockEvent, fileNode!)
      result.current.handleDragEnd()
    })

    expect(result.current.dragSourcePaths).toEqual([])
    expect(result.current.dragOverPath).toBeNull()
  })
})
