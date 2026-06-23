/**
 * Category Store - 管理分类树状态
 */
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

/// 分类树节点类型（与 Rust 侧 CategoryNode 对应）
export interface CategoryNode {
  name: string
  path: string
  count: number
  children: CategoryNode[]
  files?: { file_path: string; title: string | null }[]
}

interface CategoryState {
  tree: CategoryNode[]
  loading: boolean
  loadTree: () => Promise<void>
}

export const useCategoryStore = create<CategoryState>((set) => ({
  tree: [],
  loading: false,

  loadTree: async () => {
    set({ loading: true })
    try {
      const result = await invoke<CategoryNode[]>('get_category_tree')
      set({ tree: result, loading: false })
    } catch (e) {
      console.error('Failed to load category tree:', e)
      set({ loading: false })
    }
  },
}))

// 应用启动时自动加载分类树
useCategoryStore.getState().loadTree()
