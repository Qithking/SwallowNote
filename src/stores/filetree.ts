/**
 * File Tree Store - Manages file tree state
 */
import { create } from 'zustand'

export interface FileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isExpanded?: boolean
}

export interface FileTreeState {
  rootNode: FileNode | null
  selectedPath: string | null
  expandedPaths: Set<string>
  setRootNode: (node: FileNode | null) => void
  setSelectedPath: (path: string | null) => void
  toggleExpanded: (path: string) => void
  setExpanded: (path: string, expanded: boolean) => void
}

export const useFileTreeStore = create<FileTreeState>((set) => ({
  rootNode: null,
  selectedPath: null,
  expandedPaths: new Set(),
  setRootNode: (node) => set({ rootNode: node }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  toggleExpanded: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedPaths)
      if (newExpanded.has(path)) {
        newExpanded.delete(path)
      } else {
        newExpanded.add(path)
      }
      return { expandedPaths: newExpanded }
    }),
  setExpanded: (path, expanded) =>
    set((state) => {
      const newExpanded = new Set(state.expandedPaths)
      if (expanded) {
        newExpanded.add(path)
      } else {
        newExpanded.delete(path)
      }
      return { expandedPaths: newExpanded }
    }),
}))
