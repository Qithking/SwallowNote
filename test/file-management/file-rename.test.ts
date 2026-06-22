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

describe('TC-004: 文件重命名测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.getState().clearAll()
    useWorkspaceStore.getState().setRootPath('/test-workspace')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-004-01: 对文件进行重命名操作', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.handleStartEdit('/test-workspace/old-name.md', 'old-name.md', false)
    })
    
    expect(result.current.editingPath).toBe('/test-workspace/old-name.md')
    expect(result.current.editingName).toBe('old-name.md')
  })

  it('TC-004-02: 编辑状态更新', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.handleStartEdit('/test-workspace/file.md', 'file.md', false)
    })
    
    act(() => {
      result.current.setEditingName('renamed-file.md')
    })
    
    expect(result.current.editingName).toBe('renamed-file.md')
  })

  it('TC-004-03: 取消重命名操作', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.handleStartEdit('/test-workspace/file.md', 'file.md', false)
    })
    
    expect(result.current.editingPath).toBe('/test-workspace/file.md')
    
    act(() => {
      result.current.handleCancelEdit()
    })
    
    expect(result.current.editingPath).toBeNull()
    expect(result.current.editingName).toBe('')
  })

  it('TC-004-04: 目录重命名测试', () => {
    const { result } = renderHook(() => useFileTreeActions())
    
    act(() => {
      result.current.handleStartEdit('/test-workspace/folder', 'folder', true)
    })
    
    expect(result.current.editingPath).toBe('/test-workspace/folder')
    expect(result.current.editingName).toBe('folder')
  })
})
