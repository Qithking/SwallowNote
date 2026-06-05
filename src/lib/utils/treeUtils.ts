/**
 * File Tree Utilities
 * Pure functions shared between filetree store and FileTreeView component
 */
import type { FileNode } from '@/stores/filetree'

/** Recursively update children of a matching node in the tree */
export function updateNodesWithChildren(list: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return list.map((n) => {
    if (n.path === path) return { ...n, children }
    if (n.children) return { ...n, children: updateNodesWithChildren(n.children, path, children) }
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

/** Collect all visible node paths in depth-first order (matching render order) */
export function collectAllPaths(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const n of nodes) {
    paths.push(n.path)
    if (n.children) {
      paths.push(...collectAllPaths(n.children))
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
