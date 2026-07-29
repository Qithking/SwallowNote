/**
 * FindReplacePanel — 查找/替换内嵌面板
 * AC-3/4/5: CodeMirror 完整版(查找+替换+三选项)
 * AC-6/7/8: BlockNote 简化版(查找+替换+大小写敏感)
 * AC-9: Enter 下一个, Shift+Enter 上一个, Esc 关闭
 * Source: plan/editor-find-replace step 3
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronDown, ChevronUp, Replace, ReplaceAll, CaseSensitive, WholeWord, Regex } from 'lucide-react'

export type FindReplaceEditorType = 'codemirror' | 'blocknote'

export interface FindReplaceMatchCount {
  current: number
  total: number
}

export interface FindReplaceOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

export interface FindReplacePanelProps {
  visible: boolean
  editorType: FindReplaceEditorType
  matchCount: FindReplaceMatchCount
  /** 初始查询文本(可选) */
  initialQuery?: string
  /** 初始替换文本(可选) */
  initialReplaceText?: string
  /** 查询选项初始值 */
  initialCaseSensitive?: boolean
  initialWholeWord?: boolean
  initialRegexp?: boolean
  /** 查询错误提示(CM 正则无效等) */
  error?: string | null
  /** 关闭面板 */
  onClose: () => void
  /** 查询文本或选项变化 */
  onQueryChange: (text: string, options: FindReplaceOptions) => void
  /** 替换文本变化(CM/BN) */
  onReplaceTextChange: (text: string) => void
  /** 查找下一个 */
  onFindNext: () => void
  /** 查找上一个 */
  onFindPrev: () => void
  /** 替换下一个(CM/BN) */
  onReplaceNext: (replaceText: string) => void
  /** 全部替换(CM/BN) */
  onReplaceAll: (replaceText: string) => void
}

export function FindReplacePanel(props: FindReplacePanelProps) {
  const {
    visible,
    editorType,
    matchCount,
    initialQuery = '',
    initialReplaceText = '',
    initialCaseSensitive = false,
    initialWholeWord = false,
    initialRegexp = false,
    error,
    onClose,
    onQueryChange,
    onReplaceTextChange,
    onFindNext,
    onFindPrev,
    onReplaceNext,
    onReplaceAll,
  } = props

  const { t } = useTranslation()
  const findInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(initialQuery)
  const [replaceText, setReplaceText] = useState(initialReplaceText)
  const [options, setOptions] = useState<FindReplaceOptions>({
    caseSensitive: initialCaseSensitive,
    wholeWord: initialWholeWord,
    regexp: initialRegexp,
  })

  // 可见时聚焦输入框;外部 initialQuery 变化时同步(如从选中填充)
  useEffect(() => {
    if (visible) {
      const id = window.setTimeout(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      }, 0)
      return () => window.clearTimeout(id)
    }
  }, [visible])

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    setReplaceText(initialReplaceText)
  }, [initialReplaceText])

  if (!visible) return null

  const isCodeMirror = editorType === 'codemirror'
  const matchCountText = t('editorToolbar.findReplace.matchCount', {
    current: matchCount.current,
    total: matchCount.total,
  })

  const emitQuery = (nextQuery: string, nextOptions: FindReplaceOptions) => {
    onQueryChange(nextQuery, nextOptions)
  }

  const handleFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        onFindPrev()
      } else {
        onFindNext()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleFindChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setQuery(next)
    emitQuery(next, options)
  }

  const handleReplaceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setReplaceText(next)
    onReplaceTextChange(next)
  }

  const handleReplaceNext = () => {
    onReplaceNext(replaceText)
  }

  const handleReplaceAll = () => {
    onReplaceAll(replaceText)
  }

  const updateOption = (key: keyof FindReplaceOptions) => {
    const nextOptions = { ...options, [key]: !options[key] }
    setOptions(nextOptions)
    emitQuery(query, nextOptions)
  }

  return (
    <div
      className="find-replace-panel absolute top-full right-0 z-50 flex flex-col gap-1.5 px-3 py-1.5 border rounded shadow-md text-[11px] min-w-[360px]"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
    >
      {/* Find row: search input + prev/next + match count + options + close */}
      <div className="flex items-center gap-1">
        <input
          ref={findInputRef}
          type="text"
          value={query}
          onChange={handleFindChange}
          onKeyDown={handleFindKeyDown}
          placeholder={t('editorToolbar.findReplace.find')}
          className="flex-1 h-6 px-2 rounded border text-[11px] bg-transparent outline-none focus:border-[var(--theme-color)]"
          style={{ borderColor: 'var(--border-color)' }}
        />
        <button
          type="button"
          title={t('editorToolbar.findReplace.find')}
          onClick={onFindPrev}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          title={t('editorToolbar.findReplace.find')}
          onClick={onFindNext}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronDown size={13} />
        </button>
        <span className="text-[10px] shrink-0 min-w-[40px] text-right" style={{ color: 'var(--text-muted)' }}>
          {matchCountText}
        </span>
        {/* Toggle buttons */}
        <button
          type="button"
          title={t('editorToolbar.findReplace.caseSensitive')}
          onClick={() => updateOption('caseSensitive')}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{
            color: options.caseSensitive ? 'var(--theme-color)' : 'var(--text-muted)',
            background: options.caseSensitive ? 'var(--bg-active)' : 'transparent',
          }}
        >
          <CaseSensitive size={13} />
        </button>
        {isCodeMirror && (
          <button
            type="button"
            title={t('editorToolbar.findReplace.wholeWord')}
            onClick={() => updateOption('wholeWord')}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
            style={{
              color: options.wholeWord ? 'var(--theme-color)' : 'var(--text-muted)',
              background: options.wholeWord ? 'var(--bg-active)' : 'transparent',
            }}
          >
            <WholeWord size={13} />
          </button>
        )}
        {isCodeMirror && (
          <button
            type="button"
            title={t('editorToolbar.findReplace.regexp')}
            onClick={() => updateOption('regexp')}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
            style={{
              color: options.regexp ? 'var(--theme-color)' : 'var(--text-muted)',
              background: options.regexp ? 'var(--bg-active)' : 'transparent',
            }}
          >
            <Regex size={13} />
          </button>
        )}
        <button
          type="button"
          title={t('editorToolbar.findReplace.close')}
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Replace row: CM/BN 均提供替换输入与按钮 */}
      <div className="flex items-center gap-1">
        <input
          ref={replaceInputRef}
          type="text"
          value={replaceText}
          onChange={handleReplaceChange}
          placeholder={t('editorToolbar.findReplace.replace')}
          className="flex-1 h-6 px-2 rounded border text-[11px] bg-transparent outline-none focus:border-[var(--theme-color)]"
          style={{ borderColor: 'var(--border-color)' }}
        />
        <button
          type="button"
          title={t('editorToolbar.findReplace.replace')}
          onClick={handleReplaceNext}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <Replace size={13} />
        </button>
        <button
          type="button"
          title={t('editorToolbar.findReplace.replaceAll')}
          onClick={handleReplaceAll}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <ReplaceAll size={13} />
        </button>
      </div>
      {error && (
        <div className="text-[10px] leading-tight" style={{ color: 'var(--error-color, #ef4444)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
