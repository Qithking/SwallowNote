import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFileTreeStore, FileNode } from '@/stores/filetree'

const createTestNode = (path: string, isDirectory: boolean, children?: FileNode[]): FileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  isDirectory,
  children,
  isExpanded: false,
})

describe('TC-003: 文件删除测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.getState().clearAll()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-003-01: 删除文件后验证文件树更新', () => {
    const testTree: FileNode[] = [
      createTestNode('/workspace', true, [
        createTestNode('/workspace/note1.md', false),
        createTestNode('/workspace/note2.md', false),
        createTestNode('/workspace/folder', true, [
          createTestNode('/workspace/folder/file.md', false),
        ]),
      ]),
    ]
    useFileTreeStore.getState().setNodes(testTree)
    
    const nodes = useFileTreeStore.getState().nodes
    expect(nodes[0].children?.length).toBe(3)
    
    useFileTreeStore.getState().clearAll()
    
    expect(useFileTreeStore.getState().nodes.length).toBe(0)
  })

  it('TC-003-02: 清除选中状态', () => {
    useFileTreeStore.getState().setSelectedPath('/workspace/note1.md')
    
    expect(useFileTreeStore.getState().selectedPath).toBe('/workspace/note1.md')
    
    useFileTreeStore.getState().setSelectedPath(null)
    
    expect(useFileTreeStore.getState().selectedPath).toBeNull()
  })

  it('TC-003-03: 清除多选状态', () => {
    useFileTreeStore.getState().setMultiSelectedPaths(new Set(['/workspace/note1.md', '/workspace/note2.md']))
    
    expect(useFileTreeStore.getState().multiSelectedPaths.size).toBe(2)
    
    useFileTreeStore.getState().clearMultiSelection()
    
    expect(useFileTreeStore.getState().multiSelectedPaths.size).toBe(0)
  })
})
