/**
 * useEditorSearchIntegration — 编辑器查找/替换事件桥接 hook
 *
 * 在 MarkdownEditor / CodeEditor 中挂载此 hook,自动:
 * 1. 根据编辑器类型调用 useBlockNoteSearch / useCodeMirrorSearch
 * 2. 监听 window 的 editor:find-replace:* 事件并调用对应 hook 方法
 * 3. 当 matchCount 变化时派发 editor:find-replace:match-count 事件
 *
 * Source: plan/editor-find-replace step 8
 */
import { useEffect, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { useBlockNoteSearch } from './useBlockNoteSearch'
import { useCodeMirrorSearch } from './useCodeMirrorSearch'
import type { FindReplaceOptions } from '@/components/FindReplacePanel'

export type EditorSearchType = 'codemirror' | 'blocknote'

interface UseEditorSearchIntegrationArgs {
  editorType: EditorSearchType
  /** BlockNote editor 实例(editorType === 'blocknote' 时必需) */
  editor?: unknown
  /** CodeMirror viewRef(editorType === 'codemirror' 时必需) */
  viewRef?: React.MutableRefObject<EditorView | null>
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

export function useEditorSearchIntegration({ editorType, editor, viewRef }: UseEditorSearchIntegrationArgs) {
  // 始终调用两个 hook(React hooks rules),但根据 editorType 使用对应的 API
  const bnSearch = useBlockNoteSearch({ editor: editor ?? null } as any)
  const cmSearch = useCodeMirrorSearch({ viewRef: viewRef ?? { current: null } } as any)

  const searchApi = editorType === 'codemirror' ? cmSearch : bnSearch
  const matchCount = searchApi.matchCount

  // 用 ref 持有最新 hook API,避免同步 effect 依赖频繁变化
  const bnSearchRef = useRef(bnSearch)
  const cmSearchRef = useRef(cmSearch)
  bnSearchRef.current = bnSearch
  cmSearchRef.current = cmSearch

  // CM/BN 切换或 hook 初始化时,自动同步已存在的查询/替换文本
  useEffect(() => {
    const q = getSharedFindReplaceQuery()
    if (!q.text) return
    if (editorType === 'codemirror') {
      cmSearchRef.current.setQuery({
        text: q.text,
        caseSensitive: q.caseSensitive,
        wholeWord: q.wholeWord,
        regexp: q.regexp,
      })
      cmSearchRef.current.setReplaceText(getSharedFindReplaceText())
    } else {
      bnSearchRef.current.setQuery(q.text, { caseSensitive: q.caseSensitive })
      bnSearchRef.current.setReplaceText(getSharedFindReplaceText())
    }
  }, [editorType])

  // matchCount 变化时派发事件
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('editor:find-replace:match-count', {
      detail: { current: matchCount.current, total: matchCount.total },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCount.current, matchCount.total])

  // 监听 find-replace 事件
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
      if (editorType === 'codemirror') {
        cmSearch.setQuery({ text, ...options })
      } else {
        bnSearch.setQuery(text, { caseSensitive: options.caseSensitive })
      }
    }
    const onReplaceText = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const text = detail.text ?? ''
      setSharedFindReplaceText(text)
      if (editorType === 'codemirror') {
        cmSearch.setReplaceText(text)
      } else {
        bnSearch.setReplaceText(text)
      }
    }
    const onFindNext = () => searchApi.findNext()
    const onFindPrev = () => searchApi.findPrev()
    const onReplaceNext = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      searchApi.replaceNext(detail.text ?? '')
    }
    const onReplaceAll = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      searchApi.replaceAll(detail.text ?? '')
    }
    const onClear = () => {
      if (editorType === 'blocknote') {
        bnSearch.clear()
      } else {
        // CM: 用空查询重置
        cmSearch.setQuery({ text: '', caseSensitive: false, wholeWord: false, regexp: false })
      }
    }

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
  }, [editorType, bnSearch, cmSearch, searchApi])
}
