/**
 * 光标锚点：预览模式（BlockNote）光标位置的保存与恢复
 *
 * 锚点结构 = ProseMirror 光标位置 + 光标前后各 20 字符的上下文纯文本。
 * 恢复时用上下文校验文档是否一致（外部修改/解析差异会导致位置失配），
 * 校验失败则跳过恢复，避免把光标放到错误位置。
 *
 * 缓存策略：编辑器 selectionUpdate 时写入模块级缓存（不触发 React 重渲染），
 * tab 离开前由 editor store 的 saveActiveTabScrollTopIfNeeded 统一同步进 tab，
 * 随会话持久化。
 */

/** 光标上下文窗口长度（字符） */
const CONTEXT_CHARS = 20

export interface CursorAnchor {
  /** ProseMirror 光标位置（doc 内绝对偏移） */
  pos: number
  /** 光标前上下文纯文本（≤20 字符，恢复时校验用） */
  before: string
  /** 光标后上下文纯文本（≤20 字符，恢复时校验用） */
  after: string
}

/** PM selection 最小结构（避免直接依赖 prosemirror-state 类型） */
interface SelectionLike {
  from: number
  to: number
}

/** PM doc 最小结构（避免直接依赖 prosemirror-model 类型） */
interface DocLike {
  content: { size: number }
  textBetween(from: number, to: number, blockSeparator?: string, leafText?: string | null): string
}

/**
 * 从 PM selection 捕获光标锚点。
 * leaf 节点（图片等）以 PM 官方占位符 U+FFFC 参与 textBetween，保证上下文稳定。
 */
export function captureCursorAnchor(selection: SelectionLike, doc: DocLike): CursorAnchor {
  const pos = Math.min(Math.max(0, selection.from), doc.content.size)
  const before = doc.textBetween(
    Math.max(0, pos - CONTEXT_CHARS),
    pos,
    '\n',
    '\ufffc',
  )
  const after = doc.textBetween(
    pos,
    Math.min(doc.content.size, pos + CONTEXT_CHARS),
    '\n',
    '\ufffc',
  )
  return { pos, before, after }
}

/**
 * 校验锚点在新文档中是否仍然有效：位置合法且前后上下文文本一致。
 * 文档被外部修改或解析差异导致内容变化时返回 false（调用方应跳过恢复）。
 */
export function validateCursorAnchor(doc: DocLike, anchor: CursorAnchor | null | undefined): boolean {
  if (!anchor) return false
  if (!Number.isInteger(anchor.pos) || anchor.pos < 0 || anchor.pos > doc.content.size) return false
  const before = doc.textBetween(
    Math.max(0, anchor.pos - CONTEXT_CHARS),
    anchor.pos,
    '\n',
    '\ufffc',
  )
  const after = doc.textBetween(
    anchor.pos,
    Math.min(doc.content.size, anchor.pos + CONTEXT_CHARS),
    '\n',
    '\ufffc',
  )
  return before === anchor.before && after === anchor.after
}

/** tabId → 最近光标锚点（仅内存，进程级） */
const anchorCache = new Map<string, CursorAnchor>()

export function setCursorAnchorCache(tabId: string, anchor: CursorAnchor): void {
  anchorCache.set(tabId, anchor)
}

export function getCursorAnchorCache(tabId: string): CursorAnchor | undefined {
  return anchorCache.get(tabId)
}

export function clearCursorAnchorCache(tabId: string): void {
  anchorCache.delete(tabId)
}
