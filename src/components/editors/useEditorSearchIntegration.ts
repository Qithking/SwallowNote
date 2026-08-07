/**
 * useEditorSearchIntegration — 编辑器查找/替换事件桥接 hook
 *
 * 接收统一的 EditorSearchAdapter,监听 window 的 editor:find-replace:* 事件
 * 并转发到 adapter。各编辑器用 adaptBlockNoteSearch / adaptCodeMirrorSearch
 * 把自己的 search hook 输出适配为 EditorSearchAdapter,消除编辑器类型分支。
 */
import { useEffect, useRef } from 'react'
import type { FindReplaceOptions } from '@/components/FindReplacePanel'
import type { useBlockNoteSearch } from './useBlockNoteSearch'
import type { useCodeMirrorSearch } from './useCodeMirrorSearch'

/** 统一的搜索适配器契约 */
export interface EditorSearchAdapter {
  setQuery: (text: string, options: FindReplaceOptions) => void
  setReplaceText: (text: string) => void
  findNext: () => void
  findPrev: () => void
  replaceNext: (text: string) => void
  replaceAll: (text: string) => void
  clear: () => void
  matchCount: { current: number; total: number }
}

/** 跨编辑器实例共享当前查询,CM/BN 切换后新编辑器可自动恢复搜索 */
let sharedQuery: { text: string } & FindReplaceOptions = {
  text: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
}
let sharedReplaceText = ''

export function setSharedFindReplaceQuery(text: string, options: FindReplaceOptions) {
  sharedQuery = { text, ...options }
}

export function getSharedFindReplaceQuery(): { text: string } & FindReplaceOptions {
  return sharedQuery
}

export function setSharedFindReplaceText(text: string) {
  sharedReplaceText = text
}

export function getSharedFindReplaceText(): string {
  return sharedReplaceText
}

/** BlockNote search hook → EditorSearchAdapter */
export function adaptBlockNoteSearch(
  bn: ReturnType<typeof useBlockNoteSearch>,
): EditorSearchAdapter {
  return {
    setQuery: (text, options) => bn.setQuery(text, { caseSensitive: options.caseSensitive }),
    setReplaceText: (text) => bn.setReplaceText(text),
    findNext: () => bn.findNext(),
    findPrev: () => bn.findPrev(),
    replaceNext: (text) => bn.replaceNext(text),
    replaceAll: (text) => bn.replaceAll(text),
    clear: () => bn.clear(),
    matchCount: bn.matchCount,
  }
}

/** CodeMirror search hook → EditorSearchAdapter */
export function adaptCodeMirrorSearch(
  cm: ReturnType<typeof useCodeMirrorSearch>,
): EditorSearchAdapter {
  return {
    setQuery: (text, options) =>
      cm.setQuery({
        text,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        regexp: options.regexp,
      }),
    setReplaceText: (text) => cm.setReplaceText(text),
    findNext: () => cm.findNext(),
    findPrev: () => cm.findPrev(),
    replaceNext: (text) => cm.replaceNext(text),
    replaceAll: (text) => cm.replaceAll(text),
    clear: () =>
      cm.setQuery({ text: '', caseSensitive: false, wholeWord: false, regexp: false }),
    matchCount: cm.matchCount,
  }
}

export function useEditorSearchIntegration(adapter: EditorSearchAdapter) {
  // 用 ref 持有最新 adapter,避免事件监听 effect 依赖频繁变化
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const matchCount = adapter.matchCount

  // mount 时同步已存在的 shared query(CM/BN 切换后恢复搜索)
  useEffect(() => {
    const q = getSharedFindReplaceQuery()
    if (!q.text) return
    adapterRef.current.setQuery(q.text, {
      caseSensitive: q.caseSensitive,
      wholeWord: q.wholeWord,
      regexp: q.regexp,
    })
    adapterRef.current.setReplaceText(getSharedFindReplaceText())
  }, [])

  // matchCount 变化时派发事件
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('editor:find-replace:match-count', {
        detail: { current: matchCount.current, total: matchCount.total },
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCount.current, matchCount.total])

  // 监听 find-replace 事件,转发到 adapter
  useEffect(() => {
    const onQuery = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const text = detail.text ?? ''
      const options: FindReplaceOptions = {
        caseSensitive: !!detail.caseSensitive,
        wholeWord: !!detail.wholeWord,
        regexp: !!detail.regexp,
      }
      setSharedFindReplaceQuery(text, options)
      adapterRef.current.setQuery(text, options)
    }
    const onReplaceText = (e: Event) => {
      const text = (e as CustomEvent).detail?.text ?? ''
      setSharedFindReplaceText(text)
      adapterRef.current.setReplaceText(text)
    }
    const onFindNext = () => adapterRef.current.findNext()
    const onFindPrev = () => adapterRef.current.findPrev()
    const onReplaceNext = (e: Event) => {
      const text = (e as CustomEvent).detail?.text ?? ''
      adapterRef.current.replaceNext(text)
    }
    const onReplaceAll = (e: Event) => {
      const text = (e as CustomEvent).detail?.text ?? ''
      adapterRef.current.replaceAll(text)
    }
    const onClear = () => adapterRef.current.clear()

    window.addEventListener('editor:find-replace:query', onQuery)
    window.addEventListener('editor:find-replace:replace-text', onReplaceText)
    window.addEventListener('editor:find-replace:find-next', onFindNext)
    window.addEventListener('editor:find-replace:find-prev', onFindPrev)
    window.addEventListener('editor:find-replace:replace-next', onReplaceNext)
    window.addEventListener('editor:find-replace:replace-all', onReplaceAll)
    window.addEventListener('editor:find-replace:clear', onClear)
    return () => {
      window.removeEventListener('editor:find-replace:query', onQuery)
      window.removeEventListener('editor:find-replace:replace-text', onReplaceText)
      window.removeEventListener('editor:find-replace:find-next', onFindNext)
      window.removeEventListener('editor:find-replace:find-prev', onFindPrev)
      window.removeEventListener('editor:find-replace:replace-next', onReplaceNext)
      window.removeEventListener('editor:find-replace:replace-all', onReplaceAll)
      window.removeEventListener('editor:find-replace:clear', onClear)
    }
  }, [])
}
