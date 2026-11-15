/**
 * close-flow — 窗口关闭流程辅助（审计 I1 回归锚点）
 *
 * saveAllDirtyTabs 吞掉写盘错误（仅派发 save-error 事件，不抛出），
 * 「保存并关闭」保存后必须校验剩余脏 tab：仍有脏 tab 即保存失败，
 * 调用方应中止关闭并重新弹出保存对话框，避免未保存内容随窗口销毁丢失。
 */
import { useEditorStore } from '@/stores/editor'

export interface DirtyCloseGuard {
  /** true 表示仍有脏 tab（isDirty 或 frontmatterDirty），应中止关闭流程 */
  abort: boolean
  /** 脏 tab 名称摘要（最多 5 个，超出以 ... 结尾），供确认对话框展示 */
  dirtyNames: string[]
}

/**
 * 汇总当前脏 tab 状态：供 close-requested 处理器构建对话框文案，
 * 及「保存并关闭」保存结果校验复用。
 */
export function getDirtyCloseGuard(): DirtyCloseGuard {
  const dirtyTabs = useEditorStore.getState().tabs.filter((t) => t.isDirty || t.frontmatterDirty)
  const names = dirtyTabs.slice(0, 5).map((t) => t.name)
  if (dirtyTabs.length > 5) names.push('...')
  return { abort: dirtyTabs.length > 0, dirtyNames: names }
}
