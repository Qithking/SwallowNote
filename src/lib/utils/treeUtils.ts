/**
 * File Tree Utilities
 * Pure functions shared between filetree store and FileTreeView component
 */
import type { FileNode } from '@/stores/filetree'

/** Recursively update children of a matching node in the tree.
 *  Clears isLoading and skips creating new objects when nothing changed
 *  (reference equality optimization for React re-render avoidance). */
export function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) {
      // Skip creating a new object if children reference is already the same
      if (n.children === children && !n.isLoading) return n
      return { ...n, children, isLoading: false }
    }
    if (n.children) {
      const updatedChildren = updateNodesWithChildren(n.children, path, children)
      // Skip creating a new object if no child was actually updated
      if (updatedChildren === n.children) return n
      return { ...n, children: updatedChildren }
    }
    return n
  })
}

/** Find a node by exact path in the tree */
export function findNodeByPath(path: string, list: FileNode[]): FileNode | null {
  for (const n of list) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNodeByPath(path, n.children)
      if (found) return found
    }
  }
  return null
}

/** Find the direct parent node of a given node */
export function findParentNode(node: FileNode, list: FileNode[]): FileNode | null {
  for (const n of list) {
    if (n.children) {
      if (n.children.some(c => c.path === node.path)) return n
      const found = findParentNode(node, n.children)
      if (found) return found
    }
  }
  return null
}

/** Collect all visible node paths in depth-first order (matching render order).
 *  仅遍历已展开的目录，跳过折叠目录内不可见的子节点，避免 shift-click 多选时
 *  选中用户看不到的路径。*/
export function collectAllPaths(nodes: FileNode[], expanded: Set<string>): string[] {
  const paths: string[] = []
  for (const n of nodes) {
    paths.push(n.path)
    // 仅当目录已展开时才递归其子节点
    if (n.children && expanded.has(n.path)) {
      paths.push(...collectAllPaths(n.children, expanded))
    }
  }
  return paths
}

/** Generate a unique name that does not conflict with existing siblings */
export function generateUniqueName(baseName: string, siblings: FileNode[]): string {
  const ext = baseName.includes('.') ? '.' + baseName.split('.').pop() : ''
  const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName
  let counter = 1
  let newName = baseName
  while (siblings.some(s => s.name === newName)) {
    newName = `${nameWithoutExt}${counter}${ext}`
    counter++
  }
  return newName
}
