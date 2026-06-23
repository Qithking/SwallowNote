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
  refreshTree: () => void
}

// 模块级防抖计时器
let _refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useCategoryStore = create<CategoryState>((set, get) => ({
  tree: [],
  loading: false,

  loadTree: async () => {
    set({ loading: true })
    try {
      const result = await invoke<CategoryNode[]>('get_category_tree')
      set({ tree: result, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  // 防抖 300ms 的刷新，避免短时间内多次触发
  refreshTree: () => {
    if (_refreshTimer) clearTimeout(_refreshTimer)
    _refreshTimer = setTimeout(() => {
      get().loadTree()
      _refreshTimer = null
    }, 300)
  },
}))

// 应用启动时自动加载分类树
useCategoryStore.getState().loadTree()
