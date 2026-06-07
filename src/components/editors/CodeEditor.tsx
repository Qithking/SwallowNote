/**
 * Code Editor Component using CodeMirror
 *
 * Supports a wide range of programming languages via:
 * - Native CodeMirror 6 language packages (@codemirror/lang-*)
 * - Legacy StreamLanguage modes (@codemirror/legacy-modes)
 */
import { useEffect, useRef, useCallback } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorView as CMView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

// Native CodeMirror 6 language packages
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
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { java } from '@codemirror/lang-java'

// Legacy StreamLanguage modes
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { csharp, kotlin, scala, dart, objectiveC, objectiveCpp } from '@codemirror/legacy-modes/mode/clike'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { r } from '@codemirror/legacy-modes/mode/r'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { fSharp } from '@codemirror/legacy-modes/mode/mllike'
import { oCaml } from '@codemirror/legacy-modes/mode/mllike'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { pug } from '@codemirror/legacy-modes/mode/pug'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { vb } from '@codemirror/legacy-modes/mode/vb'
import { puppet } from '@codemirror/legacy-modes/mode/puppet'
import { gas, gasArm } from '@codemirror/legacy-modes/mode/gas'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'

import { getCodeMirrorLanguage } from '@/lib/utils/fileTypeUtils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EditorContextMenu } from './EditorContextMenu'

interface CodeEditorProps {
  content: string
  filename: string
  onChange?: (content: string) => void
  className?: string
  scrollToLine?: (lineNumber: number) => void
}

// Helper to wrap a legacy StreamParser into a CodeMirror extension
function streamLang(parser: any): any {
  return StreamLanguage.define(parser)
}

const languageExtensions: Record<string, () => any> = {
  // Native CodeMirror 6 packages
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: false, typescript: true }),
  html: () => html(),
  css: () => css(),
  less: () => css(),  // Close enough for highlighting
  json: () => json(),
  markdown: () => markdown(),
  python: () => python(),
  rust: () => rust(),
  sql: () => sql(),
  xml: () => xml(),
  yaml: () => yaml(),
  go: () => go(),
  php: () => php(),
  java: () => java(),
  cpp: () => cpp(),
  vue: () => html(),

  // Legacy StreamLanguage modes
  swift: () => streamLang(swift),
  ruby: () => streamLang(ruby),
  shell: () => streamLang(shell),
  csharp: () => streamLang(csharp),
  kotlin: () => streamLang(kotlin),
  scala: () => streamLang(scala),
  dart: () => streamLang(dart),
  objectivec: () => streamLang(objectiveC),
  objectivecpp: () => streamLang(objectiveCpp),
  lua: () => streamLang(lua),
  perl: () => streamLang(perl),
  r: () => streamLang(r),
  toml: () => streamLang(toml),
  dockerfile: () => streamLang(dockerFile),
  diff: () => streamLang(diff),
  protobuf: () => streamLang(protobuf),
  powershell: () => streamLang(powerShell),
  haskell: () => streamLang(haskell),
  clojure: () => streamLang(clojure),
  erlang: () => streamLang(erlang),
  julia: () => streamLang(julia),
  fsharp: () => streamLang(fSharp),
  ocaml: () => streamLang(oCaml),
  pascal: () => streamLang(pascal),
  cmake: () => streamLang(cmake),
  nginx: () => streamLang(nginx),
  pug: () => streamLang(pug),
  tcl: () => streamLang(tcl),
  vb: () => streamLang(vb),
  puppet: () => streamLang(puppet),
  gas: () => streamLang(gas),
  gasarm: () => streamLang(gasArm),
  shader: () => streamLang(csharp), // Approximate highlighting for shaders
  properties: () => streamLang(properties),
  elixir: () => streamLang(ruby),  // Approximate: Elixir syntax is similar to Ruby
  groovy: () => streamLang(groovy),
  graphql: () => [],  // No dedicated mode, fall back to plain text
  makefile: () => [], // No dedicated mode, fall back to plain text
  bat: () => [],      // No dedicated mode, fall back to plain text
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

  // Insert text at cursor position
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent).detail
      const view = viewRef.current
      if (!view) return
      const cursor = view.state.selection.main.head
      view.dispatch({
        changes: { from: cursor, insert: text },
        selection: { anchor: cursor + text.length },
      })
      view.focus()
    }
    window.addEventListener('insert-at-cursor', handler)
    return () => window.removeEventListener('insert-at-cursor', handler)
  }, [])

  // Replace selected text or entire content
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent).detail
      const view = viewRef.current
      if (!view) return
      const { from, to } = view.state.selection.main
      if (from !== to) {
        // Replace selection
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        })
      } else {
        // Replace entire content
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: text.length },
        })
      }
      view.focus()
    }
    window.addEventListener('replace-content', handler)
    return () => window.removeEventListener('replace-content', handler)
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
    if (viewRef.current && content !== undefined) {
      const currentContent = viewRef.current.state.doc.toString()
      if (content !== currentContent) {
        // Preserve cursor position when updating content from external changes
        const currentCursor = viewRef.current.state.selection.main.head
        const newDocLength = content.length
        // Clamp cursor position to valid range in new content
        const newCursor = Math.min(currentCursor, newDocLength)
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
          selection: { anchor: newCursor },
        })
      }
    }
  }, [content])

  // Methods for the context menu
  const getSelectedText = useCallback(() => {
    const view = viewRef.current
    if (!view) return ''
    const { from, to } = view.state.selection.main
    if (from === to) return '' // No selection
    return view.state.sliceDoc(from, to)
  }, [])

  const getSelectionLineRange = useCallback((): [number, number] | null => {
    const view = viewRef.current
    if (!view) return null
    const { from, to } = view.state.selection.main
    if (from === to) return null // No selection
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number
    return [startLine, endLine]
  }, [])

  const getFullContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() || ''
  }, [])

  return (
    <EditorContextMenu
      getSelectedText={getSelectedText}
      getSelectionLineRange={getSelectionLineRange}
      getFullContent={getFullContent}
    >
      <ScrollArea className={`h-full ${className}`}>
        <div
          ref={editorRef}
          style={{
            minHeight: '100%',
          }}
        />
      </ScrollArea>
    </EditorContextMenu>
  )
}
