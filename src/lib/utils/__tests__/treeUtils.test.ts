/**
 * treeUtils.updateNodesWithChildren 回归测试（dev-fix：文件树 reveal 链路断裂）。
 *
 * 根因：重写父目录 children 时整体替换，合并时只保留旧子节点的 isExpanded、
 * 丢弃其已加载的孙辈子树（新对象 children === undefined）。此时 expanded
 * 标记仍在（Set 中），于是箭头呈展开态但渲染 0 个子行（flattenNodes 要求
 * node.children 存在才递归）——即用户看到的「目录展开但没有任何子节点」。
 *
 * 期望语义：
 * 1. 后端 loadDirectory 恒不返回 children（undefined）；合并时若旧子节点
 *    已有 children（磁盘重扫未变化的子目录），必须保留旧子树；
 * 2. 磁盘上已删除的子节点仍要消失（保留子树≠复活旧条目，回归保护）；
 * 3. 新增的子节点要正常出现（回归保护）。
 */
import { describe, it, expect } from 'vitest'
import { updateNodesWithChildren, findNodeByPath } from '../treeUtils'
import type { FileNode } from '@/stores/filetree'

function dir(path: string, children?: FileNode[]): FileNode {
  return {
    id: path,
    name: path.split('/').pop() || path,
    path,
    isDirectory: true,
    ...(children ? { children } : {}),
  } as FileNode
}

function file(path: string): FileNode {
  return { id: path, name: path.split('/').pop() || path, path, isDirectory: false } as FileNode
}

describe('updateNodesWithChildren：重写父目录时保留已加载子树', () => {
  it('后端新 children 无孙辈时，已加载的孙辈子树不得被丢弃（RED：reveal 链路断裂根因）', () => {
    // 已加载状态：a/b/f1.md 均已在树中（b 已展开、children 已加载）
    const tree = [dir('/root', [dir('/root/a', [dir('/root/a/b', [file('/root/a/b/f1.md')])])])]
    // 模拟后端返回：b 的 children 为 undefined（loadDirectory 恒不返回孙辈）
    const freshChildren = [dir('/root/a/b'), file('/root/a/f2.md')]

    const updated = updateNodesWithChildren(tree, '/root/a', freshChildren)

    const b = findNodeByPath('/root/a/b', updated)
    expect(b?.children).toBeDefined()
    expect(b?.children?.map((c) => c.path)).toContain('/root/a/b/f1.md')
  })

  it('磁盘上已删除的子节点仍应消失（回归保护：不得因保留子树而复活旧条目）', () => {
    const tree = [
      dir('/root', [dir('/root/a', [dir('/root/a/b', [file('/root/a/b/f1.md')]), file('/root/a/gone.md')])]),
    ]
    const freshChildren = [dir('/root/a/b')]

    const updated = updateNodesWithChildren(tree, '/root/a', freshChildren)

    const a = findNodeByPath('/root/a', updated)
    expect(a?.children?.map((c) => c.path)).not.toContain('/root/a/gone.md')
  })

  it('新增的子节点应正常出现（回归保护）', () => {
    const tree = [dir('/root', [dir('/root/a', [dir('/root/a/b', [file('/root/a/b/f1.md')])])])]
    const freshChildren = [dir('/root/a/b'), file('/root/a/new.md')]

    const updated = updateNodesWithChildren(tree, '/root/a', freshChildren)

    const a = findNodeByPath('/root/a', updated)
    expect(a?.children?.map((c) => c.path)).toContain('/root/a/new.md')
  })
})
