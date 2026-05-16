/**
 * Code Editor Component using CodeMirror
 */
import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorView as CMView } from '@codemirror/view'
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

import { getCodeMirrorLanguage } from '@/lib/utils/fileTypeUtils'
import { ScrollArea } from '@/components/ui/scroll-area'

interface CodeEditorProps {
  content: string
  filename: string
  onChange?: (content: string) => void
  className?: string
  scrollToLine?: (lineNumber: number) => void
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

  const scrollToLine = (lineNumber: number) => {
    if (!viewRef.current) return
    try {
      const line = viewRef.current.state.doc.line(Math.min(lineNumber, viewRef.current.state.doc.lines))
      viewRef.current.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
      viewRef.current.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
    } catch (e) {
      console.error('Failed to scroll to line:', e)
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line
      scrollToLine(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => window.removeEventListener('scroll-to-line', handler)
  }, [])

  useEffect(() => {
    if (!editorRef.current) return

    const language = getCodeMirrorLanguage(filename)
    const langExt = languageExtensions[language] || (() => [])

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        langExt(),
        CMView.lineWrapping,
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
    <ScrollArea className={`h-full ${className}`}>
      <div
        ref={editorRef}
        style={{
          minHeight: '100%',
        }}
      />
    </ScrollArea>
  )
}
