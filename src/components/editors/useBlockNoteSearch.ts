/**
 * useBlockNoteSearch — BlockNote 查找/替换 hook(简化版)
 * 经 ProseMirror EditorView 管理 decoration 高亮
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { TextSelection } from 'prosemirror-state'
import {
  getBNProseMirrorView,
  findAllMatches,
  findNextMatch,
  findPrevMatch,
  replaceCurrentMatch,
  replaceAllMatches,
  createFindReplacePlugin,
  findReplacePluginKey,
  scrollMatchIntoView,
  type MatchRange,
  type PMViewLike,
} from './blocknoteSearch'

interface UseBlockNoteSearchArgs {
  editor: unknown
}

/** 匹配计数 */
export interface BNMatchCount {
  current: number
  total: number
}

export function useBlockNoteSearch({ editor }: UseBlockNoteSearchArgs) {
  const [matchCount, setMatchCount] = useState<BNMatchCount>({ current: 0, total: 0 })
  const [query, setQueryState] = useState('')
  const [options, setOptionsState] = useState<{ caseSensitive: boolean }>({ caseSensitive: false })
  const [replaceText, setReplaceTextState] = useState('')
  const matchesRef = useRef<MatchRange[]>([])
  const currentIdxRef = useRef<number>(-1)
  const viewRef = useRef<PMViewLike | null>(null)
  const pluginRef = useRef<ReturnType<typeof createFindReplacePlugin> | null>(null)

  // 在 BlockNote/Tiptap 上注册查找高亮 plugin;卸载时清理
  // StrictMode double-mount 时 unregisterPlugin 可能因 isDestroyed 失效,
  // 需在注册前主动移除同 key 旧 plugin,避免 RangeError。
  // Tiptap editor 创建时可能尚未 mount(view 为 null),因此等 mount 后再注册。
  useEffect(() => {
    const bnEditor = editor as any
    const tiptap = bnEditor?._tiptapEditor
    if (!tiptap) return

    const registerPluginOnce = () => {
      // 移除可能残留的同 key plugin(StrictMode / editor 重建场景)
      try {
        const keyName = (findReplacePluginKey as any).key as string
        const filtered = tiptap.state.plugins.filter((p: any) => !p.key.startsWith(keyName))
        if (filtered.length !== tiptap.state.plugins.length) {
          tiptap.view.updateState(tiptap.state.reconfigure({ plugins: filtered }))
        }
      } catch {
        // ignore
      }
      const plugin = createFindReplacePlugin()
      pluginRef.current = plugin
      try {
        tiptap.registerPlugin(plugin)
      } catch (e) {
        console.warn('[useBlockNoteSearch] registerPlugin failed', e)
      }
    }

    // editor 已经 mount 则立即注册,否则监听 mount 事件
    if (tiptap.view) {
      registerPluginOnce()
    } else {
      tiptap.on('mount', registerPluginOnce)
    }

    return () => {
      tiptap.off('mount', registerPluginOnce)
      pluginRef.current = null
      try {
        tiptap.unregisterPlugin(findReplacePluginKey)
      } catch (e) {
        console.warn('[useBlockNoteSearch] unregisterPlugin failed', e)
      }
    }
  }, [editor])

  // 刷新 view 引用(每次调用都更新,处理 editor 重建)
  const refreshView = useCallback(() => {
    viewRef.current = getBNProseMirrorView(editor)
    return viewRef.current
  }, [editor])

  // 通过 plugin meta 更新高亮装饰
  const updateDecorations = useCallback((matches: MatchRange[], currentIdx: number) => {
    const view = viewRef.current
    if (!view || !pluginRef.current) return
    try {
      const tr = view.state.tr.setMeta(findReplacePluginKey, { matches, currentIdx })
      view.dispatch(tr)
    } catch (e) {
      console.warn('[useBlockNoteSearch] updateDecorations failed', e)
    }
  }, [])

  const setQuery = useCallback((queryText: string, opts: { caseSensitive: boolean }) => {
    setQueryState(queryText)
    setOptionsState(opts)
    const view = refreshView()
    if (!view) return
    if (!queryText) {
      matchesRef.current = []
      currentIdxRef.current = -1
      setMatchCount({ current: 0, total: 0 })
      updateDecorations([], -1)
      return
    }
    const matches = findAllMatches(view.state.doc, queryText, { caseSensitive: opts.caseSensitive })
    matchesRef.current = matches
    currentIdxRef.current = matches.length > 0 ? 0 : -1
    setMatchCount({ current: currentIdxRef.current + 1, total: matches.length })
    updateDecorations(matches, currentIdxRef.current)
    // 初始查询后滚动并选中第一个匹配
    if (matches.length > 0 && currentIdxRef.current >= 0) {
      const first = matches[currentIdxRef.current]
      try {
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc as any, first.from, first.to),
        )
        view.dispatch(tr)
        scrollMatchIntoView(view, first.from)
      } catch (e) {
        console.warn('[useBlockNoteSearch] setQuery scroll failed', e)
      }
    }
  }, [refreshView, updateDecorations])

  const findNext = useCallback(() => {
    const view = refreshView()
    if (!view || matchesRef.current.length === 0) return
    // 从选区结束位置开始找,避免当前匹配被重复选中
    const currentPos = view.state.selection.to
    const next = findNextMatch(matchesRef.current, currentPos)
    if (!next) return
    // 找到在 matches 数组中的索引
    const idx = matchesRef.current.findIndex(m => m.from === next.from && m.to === next.to)
    currentIdxRef.current = idx
    setMatchCount({ current: idx + 1, total: matchesRef.current.length })
    updateDecorations(matchesRef.current, idx)
    // 派发 transaction 设置选区并滚动到视图
    try {
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc as any, next.from, next.to),
      )
      view.dispatch(tr)
      scrollMatchIntoView(view, next.from)
    } catch (e) {
      console.warn('[useBlockNoteSearch] findNext dispatch failed', e)
    }
  }, [refreshView, updateDecorations])

  const findPrev = useCallback(() => {
    const view = refreshView()
    if (!view || matchesRef.current.length === 0) return
    const currentPos = view.state.selection.from
    const prev = findPrevMatch(matchesRef.current, currentPos)
    if (!prev) return
    const idx = matchesRef.current.findIndex(m => m.from === prev.from && m.to === prev.to)
    currentIdxRef.current = idx
    setMatchCount({ current: idx + 1, total: matchesRef.current.length })
    updateDecorations(matchesRef.current, idx)
    try {
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc as any, prev.from, prev.to),
      )
      view.dispatch(tr)
      scrollMatchIntoView(view, prev.from)
    } catch (e) {
      console.warn('[useBlockNoteSearch] findPrev dispatch failed', e)
    }
  }, [refreshView, updateDecorations])

  const clear = useCallback(() => {
    matchesRef.current = []
    currentIdxRef.current = -1
    setMatchCount({ current: 0, total: 0 })
    updateDecorations([], -1)
  }, [updateDecorations])

  const replaceNext = useCallback((replaceText: string) => {
    const view = refreshView()
    if (!view || matchesRef.current.length === 0) return
    replaceCurrentMatch(view, matchesRef.current, replaceText)
    if (!query) {
      matchesRef.current = []
      currentIdxRef.current = -1
      setMatchCount({ current: 0, total: 0 })
      updateDecorations([], -1)
      return
    }
    // 重新扫描新 doc,从替换插入文本之后开始找下一匹配,避免 replaceText 含查询词时回到原位置
    const newMatches = findAllMatches(view.state.doc, query, { caseSensitive: options.caseSensitive })
    matchesRef.current = newMatches
    if (newMatches.length === 0) {
      currentIdxRef.current = -1
      setMatchCount({ current: 0, total: 0 })
      updateDecorations([], -1)
      return
    }
    const nextStartPos = view.state.selection.from + replaceText.length
    const nextMatch = findNextMatch(newMatches, nextStartPos)
    const idx = nextMatch
      ? newMatches.findIndex(m => m.from === nextMatch.from && m.to === nextMatch.to)
      : 0
    currentIdxRef.current = idx
    setMatchCount({ current: idx + 1, total: newMatches.length })
    updateDecorations(newMatches, idx)
    try {
      const match = newMatches[idx]
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc as any, match.from, match.to),
      )
      view.dispatch(tr)
      scrollMatchIntoView(view, match.from)
    } catch (e) {
      console.warn('[useBlockNoteSearch] replaceNext scroll failed', e)
    }
  }, [refreshView, updateDecorations, query, options])

  const replaceAll = useCallback((replaceText: string) => {
    const view = refreshView()
    if (!view || matchesRef.current.length === 0) return
    replaceAllMatches(view, matchesRef.current, replaceText)
    matchesRef.current = []
    currentIdxRef.current = -1
    setMatchCount({ current: 0, total: 0 })
    updateDecorations([], -1)
  }, [refreshView, updateDecorations])

  const setReplaceText = useCallback((text: string) => {
    setReplaceTextState(text)
  }, [])

  const getMatchCount = useCallback((): BNMatchCount => {
    return matchCount
  }, [matchCount])

  return {
    setQuery,
    setReplaceText,
    findNext,
    findPrev,
    replaceNext,
    replaceAll,
    clear,
    getMatchCount,
    matchCount,
    replaceText,
  }
}
