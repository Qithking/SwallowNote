/**
 * BlockNote 查找 helper:经 _tiptapEditor.view 拿到 ProseMirror EditorView
 * 所有内部 API 访问集中在此,BlockNote 升级时只改这一处
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/** ProseMirror 位置解析结果的最小类型 */
interface PMResolvedPosLike {
  pos: number
  marks: () => any[]
}

/** ProseMirror EditorView 的最小类型(避免直接依赖 prosemirror-view 的完整类型) */
export interface PMViewLike {
  state: {
    doc: {
      textBetween: (from: number, to: number, blockSeparator?: string) => string
      nodesBetween: (from: number, to: number, onText: (node: any, pos: number) => void) => void
      nodeSize: number
      content: { size: number }
      resolve: (pos: number) => PMResolvedPosLike
      schema: { text: (text: string, marks?: any[]) => any }
    }
    schema: { text: (text: string, marks?: any[]) => any }
    tr: {
      setSelection: (selection: any) => any
      scrollIntoView: () => any
      setMeta: (key: any, value: any) => any
      replaceWith: (from: number, to: number, node: any) => any
      doc: PMViewLike['state']['doc']
      docChanged: boolean
    }
    selection: {
      from: number
      to: number
      anchor: number
      head: number
    }
  }
  dispatch: (tr: any) => void
  /** ProseMirror EditorView 实际具有的 DOM 方法,用于滚动定位 */
  dom?: HTMLElement
  coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number; right: number } | null
}

/**
 * 从 BlockNote editor 安全取出 ProseMirror EditorView
 * 失败时返回 null(不抛错),AC-15 要求
 */
export function getBNProseMirrorView(editor: unknown): PMViewLike | null {
  try {
    if (!editor) return null
    const tiptapEditor = (editor as any)?._tiptapEditor
    if (!tiptapEditor) return null
    const view = tiptapEditor.view
    return view ?? null
  } catch {
    return null
  }
}

/**
 * 将指定 doc 位置滚动到 Radix ScrollArea viewport 可视区域中心。
 * BlockNoteView 被 ScrollArea 包裹,ProseMirror 原生 scrollIntoView 会失效,
 * 因此需手动计算 viewport 内偏移并 scrollTo。
 */
export function scrollMatchIntoView(view: PMViewLike, from: number): void {
  const pmView = view as any
  if (typeof pmView.coordsAtPos !== 'function') {
    // 无 coordsAtPos 时回退到原生 scrollIntoView
    try {
      pmView.dispatch?.(pmView.state.tr.scrollIntoView())
    } catch {
      // ignore
    }
    return
  }
  const coords = pmView.coordsAtPos(from)
  if (!coords) return
  const viewport = pmView.dom?.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
  if (!viewport) {
    try {
      pmView.dispatch?.(pmView.state.tr.scrollIntoView())
    } catch {
      // ignore
    }
    return
  }
  const viewportRect = viewport.getBoundingClientRect()
  const offset = coords.top - viewportRect.top + viewport.scrollTop - viewportRect.height / 2
  viewport.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
}

/** 查找查询参数 */
export interface FindQuery {
  caseSensitive: boolean
}

/** 匹配位置 */
export interface MatchRange {
  from: number
  to: number
}

/**
 * 扫描 ProseMirror doc,返回所有匹配位置(非重叠)
 * 通过 doc.nodesBetween 遍历每个文本节点,在节点文本内做字符串匹配,
 * 并将匹配位置映射回 doc 偏移量(供 Decoration.inline 使用)
 */
export function findAllMatches(
  doc: PMViewLike['state']['doc'],
  queryText: string,
  query: FindQuery,
): MatchRange[] {
  if (!queryText) return []
  const flags = query.caseSensitive ? 'g' : 'gi'
  // 转义正则特殊字符,做字面量匹配
  const escaped = queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, flags)
  const matches: MatchRange[] = []
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return matches
}

/**
 * 从指定位置查找下一个匹配,支持循环回绕
 * @param matches 已计算的所有匹配位置
 * @param fromPos 当前光标位置
 * @returns 下一个匹配,或 null(无匹配)
 */
export function findNextMatch(
  matches: MatchRange[],
  fromPos: number,
): MatchRange | null {
  if (matches.length === 0) return null
  // 找第一个 from >= fromPos 的匹配
  for (const m of matches) {
    if (m.from >= fromPos) return m
  }
  // 未找到,循环回绕到第一个
  return matches[0]
}

/**
 * 从指定位置查找上一个匹配,支持循环回绕
 * @param matches 已计算的所有匹配位置
 * @param fromPos 当前光标位置
 * @returns 上一个匹配(to <= fromPos),或 null(无匹配)
 */
export function findPrevMatch(
  matches: MatchRange[],
  fromPos: number,
): MatchRange | null {
  if (matches.length === 0) return null
  // 逆序找第一个 to <= fromPos 的匹配
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].to <= fromPos) return matches[i]
  }
  // 未找到,循环回绕到最后一个
  return matches[matches.length - 1]
}

/**
 * 在 ProseMirror view 中替换当前选中的匹配
 * @param view ProseMirror EditorView
 * @param matches 当前所有匹配
 * @param replaceText 替换文本
 * @returns 是否成功替换
 */
export function replaceCurrentMatch(view: PMViewLike, matches: MatchRange[], replaceText: string): boolean {
  if (matches.length === 0) return false
  const currentPos = view.state.selection.from
  const match = findNextMatch(matches, currentPos) ?? matches[0]
  try {
    const marks = view.state.doc.resolve(match.from).marks()
    const textNode = view.state.schema.text(replaceText, marks)
    const tr = view.state.tr.replaceWith(match.from, match.to, textNode)
    tr.setSelection(TextSelection.create(tr.doc, match.from))
    view.dispatch(tr)
    return true
  } catch (e) {
    console.warn('[blocknoteSearch] replaceCurrentMatch failed', (e as Error).message, e)
    return false
  }
}

/**
 * 替换 view 中所有匹配
 * @param view ProseMirror EditorView
 * @param matches 当前所有匹配
 * @param replaceText 替换文本
 * @returns 替换次数
 */
export function replaceAllMatches(view: PMViewLike, matches: MatchRange[], replaceText: string): number {
  if (matches.length === 0) return 0
  try {
    let tr = view.state.tr
    // 从后往前替换,避免位置偏移
    const sorted = [...matches].sort((a, b) => b.from - a.from)
    for (const m of sorted) {
      // 每次替换前基于当前 transaction 的 doc 读取匹配起点 marks
      const marks = tr.doc.resolve(m.from).marks()
      const textNode = view.state.schema.text(replaceText, marks)
      tr = tr.replaceWith(m.from, m.to, textNode)
    }
    if (tr.docChanged) {
      view.dispatch(tr)
    }
    return sorted.length
  } catch (e) {
    console.warn('[blocknoteSearch] replaceAllMatches failed', (e as Error).message, e)
    return 0
  }
}

/** 查找替换 ProseMirror Plugin 状态 */
export interface FindReplacePluginState {
  decorations: DecorationSet
  currentIdx: number
  matches: MatchRange[]
}

/** PluginKey,用于注册/更新/卸载高亮插件 */
export const findReplacePluginKey = new PluginKey<FindReplacePluginState>('findReplace')

/**
 * 创建 BlockNote/Tiptap 查找高亮 ProseMirror Plugin
 * - state 保存当前匹配装饰与 currentIdx
 * - apply 时通过 setMeta(findReplacePluginKey, { matches, currentIdx }) 更新高亮
 * - doc 变化时自动映射 decoration 位置
 */
export function createFindReplacePlugin(): Plugin<FindReplacePluginState> {
  return new Plugin<FindReplacePluginState>({
    key: findReplacePluginKey,
    state: {
      init() {
        return { decorations: DecorationSet.empty, currentIdx: -1, matches: [] }
      },
      apply(tr, value) {
        let { decorations, currentIdx, matches } = value
        const meta = tr.getMeta(findReplacePluginKey)
        if (meta) {
          matches = meta.matches ?? matches
          currentIdx = meta.currentIdx ?? currentIdx
          if (matches.length > 0 && currentIdx >= 0) {
            const deco = matches.map((m: MatchRange, i: number) => {
              const className = i === currentIdx ? 'find-match-current' : 'find-match'
              return Decoration.inline(m.from, m.to, { class: className })
            })
            decorations = DecorationSet.create(tr.doc, deco)
          } else {
            decorations = DecorationSet.empty
          }
        } else if (decorations !== DecorationSet.empty && tr.docChanged) {
          // doc 变化时自动映射装饰位置,避免编辑后高亮错位
          decorations = decorations.map(tr.mapping, tr.doc)
        }
        return { decorations, currentIdx, matches }
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations
      },
    },
  })
}
