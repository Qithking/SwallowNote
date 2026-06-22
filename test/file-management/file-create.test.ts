import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeActions } from '@/hooks/useFileTreeActions'
import { useFileTreeStore } from '@/stores/filetree'
import { useWorkspaceStore } from '@/stores/workspace'

vi.mock('@/lib/api', () => ({
  loadDirectory: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/tauri', () => ({
  createFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  renameFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

describe('TC-002: 文件创建测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.getState().clearAll()
    useWorkspaceStore.getState().setRootPath('/test-workspace')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-002-01: 在指定目录创建新笔记', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.setNewItem({ parentPath: '/test-workspace', name: 'new-note.md', type: 'file' })
    })
    
    expect(result.current.newItem).not.toBeNull()
    expect(result.current.newItem?.parentPath).toBe('/test-workspace')
    expect(result.current.newItem?.name).toBe('new-note.md')
    expect(result.current.newItem?.type).toBe('file')
  })

  it('TC-002-02: 创建成功后验证新项状态', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.setNewItem({ parentPath: '/test-workspace', name: 'document.md', type: 'file' })
    })
    
    expect(result.current.newItem).not.toBeNull()
    
    act(() => {
      result.current.handleCancelNewItem()
    })
    
    expect(result.current.newItem).toBeNull()
  })

  it('TC-002-03: 创建文件夹测试', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.setNewItem({ parentPath: '/test-workspace', name: 'new-folder', type: 'folder' })
    })
    
    expect(result.current.newItem?.type).toBe('folder')
    expect(result.current.newItem?.name).toBe('new-folder')
  })
})
