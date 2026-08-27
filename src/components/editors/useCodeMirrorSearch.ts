/**
 * useCodeMirrorSearch — CodeMirror 6 查找/替换 hook
 * 封装 @codemirror/search 底层 API,供 FindReplacePanel 调用
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import {
  setSearchQuery,
  findNext as cmFindNext,
  findPrevious as cmFindPrevious,
  replaceNext as cmReplaceNext,
  replaceAll as cmReplaceAll,
  SearchQuery,
  SearchCursor,
  RegExpCursor,
} from '@codemirror/search'

/** 查询参数(与 BlockNote 共用语义) */
export interface CMSearchQuery {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

interface UseCodeMirrorSearchArgs {
  viewRef: React.MutableRefObject<EditorView | null>
}

/** 匹配计数 */
export interface MatchCount {
  current: number
  total: number
}

/**
 * 扫描 CodeMirror doc,返回匹配总数
 * 支持 plain / caseSensitive / wholeWord / regexp
 */
function countMatches(
  doc: Text,
  q: CMSearchQuery,
): number {
  if (!q.text) return 0
  try {
    if (q.regexp) {
      let count = 0
      const cursor = new RegExpCursor(doc, q.text, { ignoreCase: !q.caseSensitive })
      while (!cursor.next().done) {
        count++
      }
      return count
    }
    let count = 0
    // 5th arg = normalize; case-insensitive → toLowerCase
    const normalize = q.caseSensitive ? undefined : (s: string) => s.toLowerCase()
    const cursor = new SearchCursor(doc, q.text, 0, doc.length, normalize)
    while (!cursor.next().done) {
      if (q.wholeWord) {
        // 全词匹配:检查前后字符是否为单词边界
        const from = cursor.value.from
        const to = cursor.value.to
        const before = from > 0 ? doc.sliceString(from - 1, from) : ' '
        const after = to < doc.length ? doc.sliceString(to, to + 1) : ' '
        if (/\w/.test(before) || /\w/.test(after)) continue
      }
      count++
    }
    return count
  } catch {
    return 0
  }
}

/**
 * 根据当前选区位置,计算它是第几个匹配(1-based)
 * 支持 plain / caseSensitive / wholeWord / regexp
 */
function computeCurrentMatchIndex(
  doc: Text,
  q: CMSearchQuery,
  selectionFrom: number,
): number {
  if (!q.text) return 0
  try {
    if (q.regexp) {
      let index = 0
      const cursor = new RegExpCursor(doc, q.text, { ignoreCase: !q.caseSensitive })
      while (!cursor.next().done) {
        index++
        const { from, to } = cursor.value
        if (selectionFrom >= from && selectionFrom <= to) return index
      }
      return index
    }
    let index = 0
    const normalize = q.caseSensitive ? undefined : (s: string) => s.toLowerCase()
    const cursor = new SearchCursor(doc, q.text, 0, doc.length, normalize)
    while (!cursor.next().done) {
      const from = cursor.value.from
      const to = cursor.value.to
      if (q.wholeWord) {
        const before = from > 0 ? doc.sliceString(from - 1, from) : ' '
        const after = to < doc.length ? doc.sliceString(to, to + 1) : ' '
        if (/\w/.test(before) || /\w/.test(after)) continue
      }
      index++
      if (selectionFrom >= from && selectionFrom <= to) return index
    }
    return index
  } catch {
    return 0
  }
}

function dispatchFindReplaceError(message: string | null) {
  window.dispatchEvent(new CustomEvent('editor:find-replace:error', {
    detail: { message },
  }))
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/**
 * CodeMirror search API hook
 * - setQuery: dispatch setSearchQuery effect(含 replace 文本)并更新 matchCount
 * - findNext/findPrev/replaceNext/replaceAll: 直接调用 CM 函数
 */
export function useCodeMirrorSearch({ viewRef }: UseCodeMirrorSearchArgs) {
  const { t } = useTranslation()
  const [matchCount, setMatchCount] = useState<MatchCount>({ current: 0, total: 0 })
  // 保存最新 query,用于 replaceNext/replaceAll 时设置 replace 文本
  const queryRef = useRef<CMSearchQuery>({ text: '', caseSensitive: false, wholeWord: false, regexp: false })
  const replaceTextRef = useRef<string>('')
  // 记录 query 是否已经应用到当前 view,避免重复 dispatch(BN->CM 切换后 view 初始化时恢复)
  const appliedViewRef = useRef<EditorView | null>(null)

  const setQuery = useCallback((q: CMSearchQuery) => {
    queryRef.current = q
    const view = viewRef.current
    if (!view) {
      setMatchCount({ current: 0, total: 0 })
      dispatchFindReplaceError(null)
      return
    }
    if (q.regexp && q.text && !isValidRegex(q.text)) {
      const message = t('editorToolbar.findReplace.invalidRegex')
      setMatchCount({ current: 0, total: 0 })
      dispatchFindReplaceError(message)
      return
    }
    try {
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: replaceTextRef.current,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      dispatchFindReplaceError(null)
      // 计算匹配数,并选中第一个匹配(使 replaceNext 有目标可替换)
      if (!q.text) {
        setMatchCount({ current: 0, total: 0 })
        return
      }
      const total = countMatches(view.state.doc, q)
      setMatchCount({ current: total > 0 ? 1 : 0, total })
      if (total > 0) {
        cmFindNext(view)
      }
    } catch (e) {
      const message = q.regexp ? t('editorToolbar.findReplace.invalidRegex') : String(e)
      console.warn('[useCodeMirrorSearch] setQuery failed', e)
      setMatchCount({ current: 0, total: 0 })
      dispatchFindReplaceError(message)
    }
  }, [viewRef, t])

  // viewRef 从 null 变为可用时,自动重新应用已保存的 query(修复 BN->CM 切换后计数为 0)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const applyIfReady = () => {
      const view = viewRef.current
      const q = queryRef.current
      if (view && view !== appliedViewRef.current) {
        appliedViewRef.current = view
        if (q.text) {
          setQuery(q)
        }
      }
    }
    applyIfReady()
    timer = setInterval(applyIfReady, 50)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [viewRef, setQuery])

  const setReplaceText = useCallback((text: string) => {
    replaceTextRef.current = text
    // 同步到 search query 的 replace 字段
    const view = viewRef.current
    if (!view) return
    try {
      const q = queryRef.current
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: text,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
    } catch (e) {
      console.warn('[useCodeMirrorSearch] setReplaceText failed', e)
    }
  }, [viewRef])

  const findNextCb = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    // 空查询时 CM 的 findNext 会打开原生搜索面板;统一使用自定义 UI,故直接 no-op
    if (!queryRef.current.text) return
    try {
      // 确保 view 的 search query 与当前保存一致(BN->CM 切换后 setQuery 可能 view 还未初始化)
      const q = queryRef.current
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: replaceTextRef.current,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      cmFindNext(view)
      // 更新当前匹配索引
      const current = computeCurrentMatchIndex(view.state.doc, q, view.state.selection.main.from)
      setMatchCount((prev) => ({ current, total: prev.total }))
    } catch (e) {
      console.warn('[useCodeMirrorSearch] findNext failed', e)
    }
  }, [viewRef])

  const findPrevCb = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    if (!queryRef.current.text) return
    try {
      const q = queryRef.current
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: replaceTextRef.current,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      cmFindPrevious(view)
      const current = computeCurrentMatchIndex(view.state.doc, q, view.state.selection.main.from)
      setMatchCount((prev) => ({ current, total: prev.total }))
    } catch (e) {
      console.warn('[useCodeMirrorSearch] findPrev failed', e)
    }
  }, [viewRef])

  const replaceNextCb = useCallback((replaceText: string) => {
    const view = viewRef.current
    if (!view) return
    if (!queryRef.current.text) return
    try {
      // 先更新 query 的 replace 文本,再执行替换
      const q = queryRef.current
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: replaceText,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      cmReplaceNext(view)
      // 替换后总匹配数 -1
      setMatchCount((prev) => ({ current: prev.current, total: Math.max(0, prev.total - 1) }))
    } catch (e) {
      console.warn('[useCodeMirrorSearch] replaceNext failed', e)
    }
  }, [viewRef])

  const replaceAllCb = useCallback((replaceText: string) => {
    const view = viewRef.current
    if (!view) return
    if (!queryRef.current.text) return
    try {
      const q = queryRef.current
      const sq = new SearchQuery({
        search: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
        replace: replaceText,
      })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      cmReplaceAll(view)
      setMatchCount({ current: 0, total: 0 })
    } catch (e) {
      console.warn('[useCodeMirrorSearch] replaceAll failed', e)
    }
  }, [viewRef])

  const getMatchCount = useCallback((): MatchCount => {
    return matchCount
  }, [matchCount])

  return {
    setQuery,
    setReplaceText,
    findNext: findNextCb,
    findPrev: findPrevCb,
    replaceNext: replaceNextCb,
    replaceAll: replaceAllCb,
    getMatchCount,
    matchCount,
  }
}
