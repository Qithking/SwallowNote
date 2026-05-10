/**
 * Code Editor Component using CodeMirror
 */
import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { rust } from '@codemirror/lang-rust'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { getCodeMirrorLanguage } from '@/lib/utils/fileTypeUtils'

interface CodeEditorProps {
  content: string
  filename: string
  onChange?: (content: string) => void
  className?: string
}

const languageExtensions: Record<string, () => any> = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: false, typescript: true }),
  html: () => html(),
  css: () => css(),
  json: () => json(),
  markdown: () => markdown(),
  python: () => python(),
  rust: () => rust(),
  sql: () => sql(),
  xml: () => xml(),
  yaml: () => yaml(),
  shell: () => [],
  text: () => [],
}

export function CodeEditor({ content, filename, onChange, className = '' }: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const language = getCodeMirrorLanguage(filename)
    const langExt = languageExtensions[language] || (() => [])

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        langExt(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange?.(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
    }
  }, [filename])

  // Update content when it changes externally
  useEffect(() => {
    if (viewRef.current) {
      const currentContent = viewRef.current.state.doc.toString()
      if (content !== currentContent) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
        })
      }
    }
  }, [content])

  return (
    <div
      ref={editorRef}
      className={className}
      style={{
        height: '100%',
        overflow: 'auto',
      }}
    />
  )
}
