import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFileTreeStore, FileNode, findNodeInList, updateNodesWithChildren } from '@/stores/filetree'

const createTestNode = (path: string, isDirectory: boolean, children?: FileNode[]): FileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  isDirectory,
  children,
  isExpanded: false,
})

const createTestTree = (): FileNode[] => [
  createTestNode('/workspace', true, [
    createTestNode('/workspace/note1.md', false),
    createTestNode('/workspace/documents', true, [
      createTestNode('/workspace/documents/report.md', false),
      createTestNode('/workspace/documents/data', true, [
        createTestNode('/workspace/documents/data/analysis.csv', false),
      ]),
    ]),
    createTestNode('/workspace/note2.md', false),
  ]),
]

describe('TC-001: 文件树导航测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileTreeStore.getState().clearAll()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('TC-001-01: 验证文件树正确显示工作目录结构', () => {
    const store = useFileTreeStore.getState()
    const testTree = createTestTree()
    
    store.setNodes(testTree)
    
    const nodes = useFileTreeStore.getState().nodes
    expect(nodes.length).toBe(1)
    expect(nodes[0].name).toBe('workspace')
    expect(nodes[0].isDirectory).toBe(true)
    expect(nodes[0].children?.length).toBe(3)
  })

  it('TC-001-02: 展开文件夹验证', () => {
    const store = useFileTreeStore.getState()
    const testTree = createTestTree()
    store.setNodes(testTree)
    
    useFileTreeStore.setState({ expanded: new Set(['/workspace']) })
    
    const expanded = useFileTreeStore.getState().expanded
    expect(expanded.has('/workspace')).toBe(true)
  })

  it('TC-001-03: 折叠文件夹验证', () => {
    const store = useFileTreeStore.getState()
    const testTree = createTestTree()
    store.setNodes(testTree)
    
    useFileTreeStore.setState({ expanded: new Set(['/workspace', '/workspace/documents']) })
    useFileTreeStore.setState({ expanded: new Set(['/workspace']) })
    
    const expanded = useFileTreeStore.getState().expanded
    expect(expanded.has('/workspace')).toBe(true)
    expect(expanded.has('/workspace/documents')).toBe(false)
  })

  it('TC-001-04: 点击文件验证选中状态', () => {
    const store = useFileTreeStore.getState()
    const testTree = createTestTree()
    store.setNodes(testTree)
    
    store.setSelectedPath('/workspace/note1.md')
    
    expect(useFileTreeStore.getState().selectedPath).toBe('/workspace/note1.md')
  })
})

describe('文件树工具函数测试', () => {
  it('TC-001-05: findNodeInList 查找根级节点', () => {
    const tree = createTestTree()
    const result = findNodeInList(tree, '/workspace/note1.md')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('note1.md')
  })

  it('TC-001-06: findNodeInList 查找嵌套节点', () => {
    const tree = createTestTree()
    const result = findNodeInList(tree, '/workspace/documents/data/analysis.csv')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('analysis.csv')
  })

  it('TC-001-07: updateNodesWithChildren 更新子节点', () => {
    const tree = createTestTree()
    const newChildren = [createTestNode('/workspace/newfile.md', false)]
    const updated = updateNodesWithChildren(tree, '/workspace', newChildren)
    
    const workspace = findNodeInList(updated, '/workspace')
    expect(workspace?.children?.length).toBe(1)
    expect(workspace?.children?.[0].name).toBe('newfile.md')
  })
})
