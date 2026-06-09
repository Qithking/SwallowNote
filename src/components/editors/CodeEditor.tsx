/**
 * Code Editor Component using CodeMirror
 *
 * Supports a wide range of programming languages via:
 * - Native CodeMirror 6 language packages (@codemirror/lang-*)
 * - Legacy StreamLanguage modes (@codemirror/legacy-modes)
 *
 * Language modules are loaded on-demand to reduce initial bundle size.
 * Commonly used languages (JS, TS, Python, HTML, CSS, JSON, Markdown, etc.)
 * are statically imported for instant availability. Less common languages
 * are dynamically imported when first needed.
 */
import { useEffect, useRef, useCallback } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorView as CMView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

// Statically import commonly used native CodeMirror 6 language packages
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

// Statically import commonly used legacy StreamLanguage modes
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { csharp, kotlin, scala, dart, objectiveC, objectiveCpp } from '@codemirror/legacy-modes/mode/clike'

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

// Cache for dynamically loaded language extensions to avoid re-importing
const dynamicExtensionCache = new Map<string, any>()

/**
 * Language extension registry.
 *
 * Commonly used languages are statically imported and available immediately.
 * Less common languages are loaded on-demand via dynamic import() — the first
 * use triggers a network request, subsequent uses return the cached extension.
 */
const languageExtensions: Record<string, () => any> = {
  // ── Native CodeMirror 6 packages (statically imported) ──
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

  // ── Commonly used legacy StreamLanguage modes (statically imported) ──
  swift: () => streamLang(swift),
  ruby: () => streamLang(ruby),
  shell: () => streamLang(shell),
  csharp: () => streamLang(csharp),
  kotlin: () => streamLang(kotlin),
  scala: () => streamLang(scala),
  dart: () => streamLang(dart),
  objectivec: () => streamLang(objectiveC),
  objectivecpp: () => streamLang(objectiveCpp),

  // ── Less common legacy modes (dynamically imported on first use) ──
  lua: () => import('@codemirror/legacy-modes/mode/lua').then(m => streamLang(m.lua)),
  perl: () => import('@codemirror/legacy-modes/mode/perl').then(m => streamLang(m.perl)),
  r: () => import('@codemirror/legacy-modes/mode/r').then(m => streamLang(m.r)),
  toml: () => import('@codemirror/legacy-modes/mode/toml').then(m => streamLang(m.toml)),
  dockerfile: () => import('@codemirror/legacy-modes/mode/dockerfile').then(m => streamLang(m.dockerFile)),
  diff: () => import('@codemirror/legacy-modes/mode/diff').then(m => streamLang(m.diff)),
  protobuf: () => import('@codemirror/legacy-modes/mode/protobuf').then(m => streamLang(m.protobuf)),
  powershell: () => import('@codemirror/legacy-modes/mode/powershell').then(m => streamLang(m.powerShell)),
  haskell: () => import('@codemirror/legacy-modes/mode/haskell').then(m => streamLang(m.haskell)),
  clojure: () => import('@codemirror/legacy-modes/mode/clojure').then(m => streamLang(m.clojure)),
  erlang: () => import('@codemirror/legacy-modes/mode/erlang').then(m => streamLang(m.erlang)),
  julia: () => import('@codemirror/legacy-modes/mode/julia').then(m => streamLang(m.julia)),
  fsharp: () => import('@codemirror/legacy-modes/mode/mllike').then(m => streamLang(m.fSharp)),
  ocaml: () => import('@codemirror/legacy-modes/mode/mllike').then(m => streamLang(m.oCaml)),
  pascal: () => import('@codemirror/legacy-modes/mode/pascal').then(m => streamLang(m.pascal)),
  cmake: () => import('@codemirror/legacy-modes/mode/cmake').then(m => streamLang(m.cmake)),
  nginx: () => import('@codemirror/legacy-modes/mode/nginx').then(m => streamLang(m.nginx)),
  pug: () => import('@codemirror/legacy-modes/mode/pug').then(m => streamLang(m.pug)),
  tcl: () => import('@codemirror/legacy-modes/mode/tcl').then(m => streamLang(m.tcl)),
  vb: () => import('@codemirror/legacy-modes/mode/vb').then(m => streamLang(m.vb)),
  puppet: () => import('@codemirror/legacy-modes/mode/puppet').then(m => streamLang(m.puppet)),
  gas: () => import('@codemirror/legacy-modes/mode/gas').then(m => streamLang(m.gas)),
  gasarm: () => import('@codemirror/legacy-modes/mode/gas').then(m => streamLang(m.gasArm)),
  properties: () => import('@codemirror/legacy-modes/mode/properties').then(m => streamLang(m.properties)),
  groovy: () => import('@codemirror/legacy-modes/mode/groovy').then(m => streamLang(m.groovy)),
  shader: () => streamLang(csharp), // Approximate highlighting for shaders
  elixir: () => streamLang(ruby),  // Approximate: Elixir syntax is similar to Ruby
  graphql: () => [],  // No dedicated mode, fall back to plain text
  makefile: () => [], // No dedicated mode, fall back to plain text
  bat: () => [],      // No dedicated mode, fall back to plain text
  text: () => [],
}

/**
 * Resolve the language extension for a given language key.
 * Returns the extension synchronously if it's statically imported,
 * or a Promise for dynamically imported extensions.
 * Caches dynamic imports to avoid re-fetching.
 */
function resolveLanguageExtension(lang: string): any | Promise<any> {
  const getter = languageExtensions[lang]
  if (!getter) return []

  // Check cache first
  if (dynamicExtensionCache.has(lang)) {
    return dynamicExtensionCache.get(lang)!
  }

  const result = getter()

  // If the result is a Promise (dynamic import), cache it when resolved
  if (result instanceof Promise) {
    result.then((ext: any) => {
      dynamicExtensionCache.set(lang, ext)
    }).catch(() => {
      // Remove from cache if import failed so it can be retried
      dynamicExtensionCache.delete(lang)
    })
  }

  return result
}

export function CodeEditor({ content, filename, onChange, className = '' }: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const scrollToLine = (lineNumber: number) => {
    if (!viewRef.current) return
    try {
      const line = viewRef.current.state.doc.line(Math.min(lineNumber, viewRef.current.state.doc.lines))
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
    const langResult = resolveLanguageExtension(language)

    // Helper: create the CodeMirror editor with the given language extension
    const createEditor = (langExt: any) => {
      if (!editorRef.current) return

      const state = EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          langExt,
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
    }

    // If the language extension is a Promise (dynamic import), wait for it
    if (langResult instanceof Promise) {
      langResult.then((ext: any) => createEditor(ext)).catch(() => createEditor([]))
    } else {
      createEditor(langResult)
    }

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
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
