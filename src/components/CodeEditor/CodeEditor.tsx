/**
 * CodeEditor —— 基于 CodeMirror 6 的轻量代码编辑器。
 *
 * 特性：
 *  - 支持 CSS / JavaScript / TypeScript / JSON / Markdown 语法高亮
 *  - 默认使用 oneDark 主题（CSS 友好）
 *  - 受控值（value/onChange）
 *  - 通过 forwardRef 暴露 scrollToLine(line) 与 getView() 方法
 *  - onSelectionChange(line, ch) 用于父级联动（如 CSS 模式下与 visual 分类切换）
 */
import type { JSX, Ref } from 'react'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  foldGutter,
  foldKeymap,
} from '@codemirror/language'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'

export type CodeEditorLanguage = 'css' | 'javascript' | 'typescript' | 'json' | 'markdown'
export type CodeEditorTheme = 'light' | 'oneDark'

export interface CodeEditorProps {
  value: string
  onChange: (v: string) => void
  language?: CodeEditorLanguage
  theme?: CodeEditorTheme
  onSelectionChange?: (line: number, ch: number) => void
  onMount?: (view: EditorView) => void
  className?: string
  readOnly?: boolean
}

export interface CodeEditorRef {
  /** 滚动并定位到指定 1-based 行号（不做选中） */
  scrollToLine: (line: number) => void
  /** 滚动并选中整行（用于高亮提示） */
  highlightLine: (line: number) => void
  /** 获取内部 EditorView 实例（高级用法） */
  getView: () => EditorView | null
}

function languageExtension(lang: CodeEditorLanguage) {
  switch (lang) {
    case 'css':
      return css()
    case 'javascript':
      return javascript()
    case 'typescript':
      return javascript({ typescript: true })
    case 'json':
      return json()
    case 'markdown':
      return markdown()
  }
}

const baseExtensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  foldGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
]

const RawCodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    language = 'css',
    theme = 'oneDark',
    onSelectionChange,
    onMount,
    className,
    readOnly = false,
  },
  ref
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartment = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())

  // Mount the editor once
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        baseExtensions,
        languageCompartment.current.of(languageExtension(language)),
        themeCompartment.current.of(theme === 'oneDark' ? oneDark : []),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChange(u.state.doc.toString())
          }
          if (u.selectionSet || u.docChanged) {
            if (onSelectionChange) {
              const pos = u.state.selection.main.head
              const line = u.state.doc.lineAt(pos)
              onSelectionChange(line.number, pos - line.from + 1)
            }
          }
        }),
        EditorState.readOnly.of(readOnly),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view
    onMount?.(view)

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value → editor (避免重复触发 onChange)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
  }, [value])

  // Sync language
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(language)),
    })
  }, [language])

  // Sync theme
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.current.reconfigure(theme === 'oneDark' ? oneDark : []),
    })
  }, [theme])

  useImperativeHandle(ref, () => ({
    scrollToLine(line) {
      const view = viewRef.current
      if (!view) return
      if (line < 1 || line > view.state.doc.lines) return
      const lineObj = view.state.doc.line(line)
      view.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      })
      view.focus()
    },
    highlightLine(line) {
      const view = viewRef.current
      if (!view) return
      if (line < 1 || line > view.state.doc.lines) return
      const lineObj = view.state.doc.line(line)
      view.dispatch({
        selection: { anchor: lineObj.from, head: lineObj.to },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      })
      view.focus()
    },
    getView() {
      return viewRef.current
    },
  }))

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        fontSize: 12,
      }}
    />
  )
})

/**
 * 把 forwardRef 的结果强转为函数组件，规避 React 18（插件）与 React 19
 * （主项目）ReactNode 定义不一致（React 19 的 ReactNode 包含 bigint）导致的 JSX
 * 类型不兼容。运行时仍由 forwardRef 正常处理 ref 转发。
 */
export const CodeEditor = RawCodeEditor as unknown as (
  props: CodeEditorProps & { ref?: Ref<CodeEditorRef> }
) => JSX.Element
