/**
 * 插件授权弹窗队列（全局单例）。
 *
 * 两个消费场景共用一个队列：
 *  1. 启动扫描（App.tsx）：发现"已启用但完全没有授权记录"的插件时入队，
 *     由 PluginPermissionPromptHost 逐个弹出授权对话框。
 *  2. 面板权限门控（PluginPanelHost → PluginPermissionGateCard）：用户点击
 *     "去授权"按钮时入队，避免每个挂载点各自维护一份对话框状态。
 *
 * 按 pluginId 去重：同一插件已在队列中时不重复入队，防止启动扫描与
 * 门控点击叠加出两个一样的对话框。
 */
import { create } from 'zustand'
import type { PluginPermission } from '@/types/plugin'

/** 一条待授权提示 */
export interface PluginPermissionPrompt {
  pluginId: string
  pluginName: string
  /** 插件声明的全部权限（对话框按此渲染勾选列表） */
  requested: PluginPermission[]
}

interface PluginPermissionPromptState {
  /** 待弹出队列，队首为当前展示项 */
  queue: PluginPermissionPrompt[]
  /** 入队（按 pluginId 去重） */
  enqueuePrompt: (prompt: PluginPermissionPrompt) => void
  /** 出队（关闭对话框时调用，自动展示下一条） */
  dismissPrompt: (pluginId: string) => void
}

export const usePluginPermissionPromptStore = create<PluginPermissionPromptState>((set) => ({
  queue: [],
  enqueuePrompt: (prompt) =>
    set((state) => {
      if (state.queue.some((p) => p.pluginId === prompt.pluginId)) return state
      return { queue: [...state.queue, prompt] }
    }),
  dismissPrompt: (pluginId) =>
    set((state) => ({
      queue: state.queue.filter((p) => p.pluginId !== pluginId),
    })),
}))
