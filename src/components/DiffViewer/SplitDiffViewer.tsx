/**
 * SplitDiffViewer - Side-by-side diff comparison component
 * Shows remote content on the left (read-only CodeMirror) and local content on the right (editable CodeMirror)
 * Highlights differences between the two versions
 *
 * IMPORTANT: This component relies on the parent using a `key` prop to force remount
 * when switching between different files. This ensures clean editor state on file change.
 */
import { useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { keymap, drawSelection, highlightActiveLine, highlightSpecialChars, lineNumbers } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { EditorState, Extension, RangeSetBuilder, Compartment, StateField } from '@codemirror/state'
import { Decoration, DecorationSet } from '@codemirror/view'
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

// Maximum content size for diff comparison (characters)
// Files larger than this will be truncated to prevent main thread freeze
const MAX_DIFF_CONTENT_SIZE = 500_000 // ~500KB

interface SplitDiffViewerProps {
  localContent: string
  remoteContent: string
  localLabel?: string
  remoteLabel?: string
  editedContent?: string
  onLocalContentChange?: (content: string) => void
  filename?: string
}

interface DiffLine {
  type: 'context' | 'added' | 'removed' | 'empty'
  content: string
  lineNum: number
}

function computeDiffLines(localLines: string[], remoteLines: string[]): { left: DiffLine[], right: DiffLine[] } {
  const m = localLines.length
  const n = remoteLines.length

  // For large files, use a sliding-window heuristic to avoid O(m*n) DP freeze
  // Threshold: total lines > 1000 triggers the fast path
  if (m + n > 1000) {
    return computeDiffLinesFast(localLines, remoteLines)
  }
  return computeDiffLinesDP(localLines, remoteLines)
}

/// Fast sliding-window alignment: O((m+n) * WINDOW) instead of O(m*n)
function computeDiffLinesFast(localLines: string[], remoteLines: string[]): { left: DiffLine[], right: DiffLine[] } {
  const WINDOW = 15
  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let li = 0, ri = 0

  while (li < localLines.length || ri < remoteLines.length) {
    if (li >= localLines.length) {
      left.push({ type: 'removed', content: remoteLines[ri], lineNum: ri + 1 })
      right.push({ type: 'empty', content: '', lineNum: -1 })
      ri++
    } else if (ri >= remoteLines.length) {
      left.push({ type: 'empty', content: '', lineNum: -1 })
      right.push({ type: 'added', content: localLines[li], lineNum: li + 1 })
      li++
    } else if (localLines[li] === remoteLines[ri]) {
      left.push({ type: 'context', content: remoteLines[ri], lineNum: ri + 1 })
      right.push({ type: 'context', content: localLines[li], lineNum: li + 1 })
      li++; ri++
    } else {
      let matched = false
      // Look ahead in local for current remote line
      for (let w = 1; w <= WINDOW && li + w < localLines.length; w++) {
        if (localLines[li + w] === remoteLines[ri]) {
          for (let k = 0; k < w; k++) {
            left.push({ type: 'empty', content: '', lineNum: -1 })
            right.push({ type: 'added', content: localLines[li], lineNum: li + 1 })
            li++
          }
          matched = true
          break
        }
      }
      if (matched) continue
      // Look ahead in remote for current local line
      for (let w = 1; w <= WINDOW && ri + w < remoteLines.length; w++) {
        if (localLines[li] === remoteLines[ri + w]) {
          for (let k = 0; k < w; k++) {
            left.push({ type: 'removed', content: remoteLines[ri], lineNum: ri + 1 })
            right.push({ type: 'empty', content: '', lineNum: -1 })
            ri++
          }
          matched = true
          break
        }
      }
      if (!matched) {
        left.push({ type: 'removed', content: remoteLines[ri], lineNum: ri + 1 })
        right.push({ type: 'added', content: localLines[li], lineNum: li + 1 })
        li++; ri++
      }
    }
  }
  return { left, right }
}

/// Full DP LCS: O(m*n) — used only for small files
function computeDiffLinesDP(localLines: string[], remoteLines: string[]): { left: DiffLine[], right: DiffLine[] } {
  const m = localLines.length
  const n = remoteLines.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (localLines[i - 1] === remoteLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let i = m, j = n

  const changes: Array<{ type: 'context' | 'added' | 'removed'; localIdx: number; remoteIdx: number }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && localLines[i - 1] === remoteLines[j - 1]) {
      changes.unshift({ type: 'context', localIdx: i - 1, remoteIdx: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'added', localIdx: -1, remoteIdx: j - 1 })
      j--
    } else {
      changes.unshift({ type: 'removed', localIdx: i - 1, remoteIdx: -1 })
      i--
    }
  }

  let li = 0, ri = 0
  for (const change of changes) {
    if (change.type === 'context') {
      left.push({ type: 'context', content: remoteLines[change.remoteIdx], lineNum: ri + 1 })
      right.push({ type: 'context', content: localLines[change.localIdx], lineNum: li + 1 })
      li++
      ri++
    } else if (change.type === 'removed') {
      left.push({ type: 'empty', content: '', lineNum: -1 })
      right.push({ type: 'added', content: localLines[change.localIdx], lineNum: li + 1 })
      li++
    } else {
      left.push({ type: 'removed', content: remoteLines[change.remoteIdx], lineNum: ri + 1 })
      right.push({ type: 'empty', content: '', lineNum: -1 })
      ri++
    }
  }

  return { left, right }
}

// Helper to wrap a legacy StreamParser into a CodeMirror extension
function streamLang(parser: any): any {
  return StreamLanguage.define(parser)
}

const languageExtensions: Record<string, () => any> = {
  javascript: () => javascript({ jsx: true, typescript: false }),
  typescript: () => javascript({ jsx: false, typescript: true }),
  html: () => html(),
  css: () => css(),
  less: () => css(),
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
  shader: () => streamLang(csharp),
  properties: () => streamLang(properties),
  elixir: () => streamLang(ruby),
  groovy: () => streamLang(groovy),
  graphql: () => [],
  makefile: () => [],
  bat: () => [],
  text: () => [],
}

// Diff highlight decorations
const addedLineDecoration = Decoration.line({ class: 'cm-diff-added-line' })
const removedLineDecoration = Decoration.line({ class: 'cm-diff-removed-line' })

/**
 * Compute decorations for a document based on its corresponding diff lines.
 * The key insight: diffLines includes 'empty' placeholders that have no counterpart in the document.
 * We walk through both simultaneously, advancing the doc position only for non-empty lines.
 */
function computeDiffDecorations(content: string, diffLines: DiffLine[]): DecorationSet {
  if (!content || diffLines.length === 0) {
    return Decoration.none
  }

  try {
    const builder = new RangeSetBuilder<Decoration>()
    const docLines = content.split('\n')
    let docLineIdx = 0
    let pos = 0
    let hasAnyDecoration = false

    for (const line of diffLines) {
      if (line.type === 'empty') {
        // Empty placeholder - no corresponding line in the document, skip
        continue
      }

      // Safety check
      if (docLineIdx >= docLines.length) break

      if (line.type === 'added') {
        builder.add(pos, pos, addedLineDecoration)
        hasAnyDecoration = true
      } else if (line.type === 'removed') {
        builder.add(pos, pos, removedLineDecoration)
        hasAnyDecoration = true
      }
      // 'context' lines get no decoration

      // Advance position by this line's length + newline
      const lineLength = docLines[docLineIdx].length
      pos += lineLength + 1
      docLineIdx++
    }

    if (!hasAnyDecoration) return Decoration.none
    return builder.finish()
  } catch (e) {
    console.error('[SplitDiffViewer] computeDiffDecorations error:', e)
    return Decoration.none
  }
}

// StateField-based diff decoration extension
// Uses the `provide` pattern to connect the StateField to EditorView.decorations facet.
// This is the idiomatic CodeMirror 6 approach: the StateField declares what facet it provides,
// and CodeMirror handles the wiring internally. Never use EditorView.decorations.of(StateField).
function createDiffDecorationExtension(diffLines: DiffLine[]): Extension {
  const field = StateField.define<DecorationSet>({
    create(state: EditorState) {
      return computeDiffDecorations(state.doc.toString(), diffLines)
    },
    update(value: DecorationSet, tr: any) {
      if (tr.docChanged) {
        return computeDiffDecorations(tr.state.doc.toString(), diffLines)
      }
      return value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  return field
}

function SplitDiffViewer({ localContent, remoteContent, localLabel, remoteLabel, editedContent: editedContentProp, onLocalContentChange, filename }: SplitDiffViewerProps) {
  const { t } = useTranslation()
  const leftContainerRef = useRef<HTMLDivElement>(null)
  const rightContainerRef = useRef<HTMLDivElement>(null)
  const leftViewRef = useRef<EditorView | null>(null)
  const rightViewRef = useRef<EditorView | null>(null)
  const isSyncingScroll = useRef(false)

  // The effective content for diff display: use prop if provided, else localContent
  const effectiveEditedContent = editedContentProp ?? localContent

  // Truncate oversized content to prevent CodeMirror initialization freeze
  const truncatedRemote = remoteContent.length > MAX_DIFF_CONTENT_SIZE
    ? remoteContent.slice(0, MAX_DIFF_CONTENT_SIZE) + '\n\n... [truncated]'
    : remoteContent
  const truncatedLocal = effectiveEditedContent.length > MAX_DIFF_CONTENT_SIZE
    ? effectiveEditedContent.slice(0, MAX_DIFF_CONTENT_SIZE) + '\n\n... [truncated]'
    : effectiveEditedContent

  // Stable callback ref for onLocalContentChange
  const onContentChangeRef = useRef(onLocalContentChange)
  onContentChangeRef.current = onLocalContentChange

  // Compute diff data
  const diffData = useMemo(() => {
    const localLines = truncatedLocal.split('\n')
    const remoteLines = truncatedRemote.split('\n')
    return computeDiffLines(localLines, remoteLines)
  }, [truncatedLocal, truncatedRemote])

  // Get language extension
  const langExt = useMemo(() => {
    const lang = filename ? getCodeMirrorLanguage(filename) : 'text'
    return languageExtensions[lang] || (() => [])
  }, [filename])

  // Create left editor (remote, read-only) - created once on mount
  // Parent uses `key` to force remount when switching files
  // NOTE: Intentionally NOT using basicSetup to avoid expensive extensions
  // (autocomplete, search, fold, bracket matching) that freeze on large files
  useEffect(() => {
    if (!leftContainerRef.current) return

    const compartment = new Compartment()

    const extensions: Extension[] = [
      // Minimal editor setup (avoid basicSetup's heavy extensions)
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      EditorView.editorAttributes.of({ class: 'cm-readonly-diff' }),
      compartment.of(langExt()),
      createDiffDecorationExtension(diffData.left),
    ]

    const state = EditorState.create({
      doc: truncatedRemote,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: leftContainerRef.current,
    })

    leftViewRef.current = view

    return () => {
      view.destroy()
      leftViewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount only - parent key controls remounting

  // Create right editor (local, editable) - created once on mount
  // NOTE: Intentionally NOT using basicSetup to avoid expensive extensions
  // (autocomplete, search, fold, bracket matching) that freeze on large files
  useEffect(() => {
    if (!rightContainerRef.current) return

    const extensions: Extension[] = [
      // Minimal editor setup with editing support
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      EditorView.lineWrapping,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      langExt(),
      createDiffDecorationExtension(diffData.right),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onContentChangeRef.current?.(update.state.doc.toString())
        }
      }),
    ]

    const state = EditorState.create({
      doc: truncatedLocal,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: rightContainerRef.current,
    })

    rightViewRef.current = view

    return () => {
      view.destroy()
      rightViewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount only - parent key controls remounting

  // Sync scrolling between left and right panels
  useEffect(() => {
    const timer = setTimeout(() => {
      const leftEl = leftContainerRef.current?.querySelector('.cm-scroller')
      const rightEl = rightContainerRef.current?.querySelector('.cm-scroller')

      if (!leftEl || !rightEl) return

      const handleLeftScroll = () => {
        if (isSyncingScroll.current) return
        isSyncingScroll.current = true
        ;(rightEl as HTMLElement).scrollTop = (leftEl as HTMLElement).scrollTop
        ;(rightEl as HTMLElement).scrollLeft = (leftEl as HTMLElement).scrollLeft
        requestAnimationFrame(() => { isSyncingScroll.current = false })
      }

      const handleRightScroll = () => {
        if (isSyncingScroll.current) return
        isSyncingScroll.current = true
        ;(leftEl as HTMLElement).scrollTop = (rightEl as HTMLElement).scrollTop
        ;(leftEl as HTMLElement).scrollLeft = (rightEl as HTMLElement).scrollLeft
        requestAnimationFrame(() => { isSyncingScroll.current = false })
      }

      leftEl.addEventListener('scroll', handleLeftScroll)
      rightEl.addEventListener('scroll', handleRightScroll)

      ;(leftEl as any)._scrollCleanup = () => {
        leftEl.removeEventListener('scroll', handleLeftScroll)
        rightEl.removeEventListener('scroll', handleRightScroll)
      }
    }, 100)

    return () => {
      clearTimeout(timer)
      const leftEl = leftContainerRef.current?.querySelector('.cm-scroller')
      if ((leftEl as any)?._scrollCleanup) {
        (leftEl as any)._scrollCleanup()
      }
    }
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel - Remote (Read-only CodeMirror) */}
      <div className="flex-1 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-center h-7 px-3 text-xs font-medium shrink-0 border-b gap-1"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          {remoteLabel || t('git.remote')}
          <span className="flex items-center gap-0.5 text-[10px] px-1 rounded" style={{ background: 'rgba(156, 163, 175, 0.15)', color: 'var(--text-muted)' }}>
            <Lock size={9} />
            {t('git.remoteReadOnly')}
          </span>
        </div>
        <div ref={leftContainerRef} className="flex-1 overflow-hidden split-diff-editor" style={{ minHeight: 0 }} />
      </div>

      {/* Right panel - Local (Editable CodeMirror) */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-center h-7 px-3 text-xs font-medium shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          <span className="text-xs font-medium">{localLabel || t('git.local')}</span>
          <span className="ml-1 text-[10px] px-1 rounded" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
            {t('git.localEditable')}
          </span>
        </div>
        <div ref={rightContainerRef} className="flex-1 overflow-hidden split-diff-editor" style={{ minHeight: 0 }} />
      </div>
    </div>
  )
}

export default SplitDiffViewer
