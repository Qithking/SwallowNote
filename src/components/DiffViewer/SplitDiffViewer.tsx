/** SplitDiffViewer — two-pane diff via @codemirror/merge. Remote (read-only) | Local (editable). */

import { useEffect, useRef, useMemo, useState, useImperativeHandle, forwardRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Pencil, Copy, Check } from 'lucide-react'

// @codemirror/merge — provides MergeView for side-by-side diff
import { MergeView } from '@codemirror/merge'

// CodeMirror core
import { EditorView, keymap, drawSelection, highlightActiveLine, highlightSpecialChars, lineNumbers, ViewUpdate } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { EditorState, Extension, Compartment } from '@codemirror/state'

// Language support — all dynamically imported to reduce initial bundle size
import { StreamLanguage } from '@codemirror/language'

import { getCodeMirrorLanguage } from '@/lib/utils/fileTypeUtils'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface SplitDiffViewerProps {
  localContent: string      // Local (HEAD) content — the original unedited content
  remoteContent: string     // Remote (theirs) content
  localLabel?: string       // Label for local side
  remoteLabel?: string      // Label for remote side
  editedContent?: string    // Edited local content (controlled) — only used for initial sync
  onLocalContentChange?: (content: string) => void
  filename?: string
  /** Initial cursor line to scroll to in the local (right) editor */
  initialCursorLine?: number
  /** Callback when cursor position changes in the local editor */
  onCursorLineChange?: (line: number) => void
}

export interface SplitDiffViewerHandle {
  /** Get the current content of the local (editable) editor */
  getLocalContent: () => string
}

// ──────────────────────────────────────────────
// Language extensions
// ──────────────────────────────────────────────

function streamLang(parser: any): any {
  return StreamLanguage.define(parser)
}

const languageExtensions: Record<string, () => any> = {
  javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: false })),
  typescript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: false, typescript: true })),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  css: () => import('@codemirror/lang-css').then(m => m.css()),
  less: () => import('@codemirror/lang-css').then(m => m.css()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  python: () => import('@codemirror/lang-python').then(m => m.python()),
  rust: () => import('@codemirror/lang-rust').then(m => m.rust()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql()),
  xml: () => import('@codemirror/lang-xml').then(m => m.xml()),
  yaml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  go: () => import('@codemirror/lang-go').then(m => m.go()),
  php: () => import('@codemirror/lang-php').then(m => m.php()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
  cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  vue: () => import('@codemirror/lang-html').then(m => m.html()),
  swift: () => import('@codemirror/legacy-modes/mode/swift').then(m => streamLang(m.swift)),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby').then(m => streamLang(m.ruby)),
  shell: () => import('@codemirror/legacy-modes/mode/shell').then(m => streamLang(m.shell)),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.csharp)),
  kotlin: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.kotlin)),
  scala: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.scala)),
  dart: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.dart)),
  objectivec: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.objectiveC)),
  objectivecpp: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.objectiveCpp)),
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
  shader: () => import('@codemirror/legacy-modes/mode/clike').then(m => streamLang(m.csharp)),
  properties: () => import('@codemirror/legacy-modes/mode/properties').then(m => streamLang(m.properties)),
  elixir: () => import('@codemirror/legacy-modes/mode/ruby').then(m => streamLang(m.ruby)),
  groovy: () => import('@codemirror/legacy-modes/mode/groovy').then(m => streamLang(m.groovy)),
  graphql: () => [],
  makefile: () => [],
  bat: () => [],
  text: () => [],
}

// ──────────────────────────────────────────────
// Theme extensions for merge view editors
// ──────────────────────────────────────────────

const mergeEditorTheme = EditorView.theme({
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '4px 0',
  },
})

// ──────────────────────────────────────────────
// SplitDiffViewer Component
// ──────────────────────────────────────────────

const SplitDiffViewer = forwardRef<SplitDiffViewerHandle, SplitDiffViewerProps>(({
  localContent,
  remoteContent,
  localLabel,
  remoteLabel,
  editedContent: editedContentProp,
  onLocalContentChange,
  filename,
  initialCursorLine,
  onCursorLineChange,
}, ref) => {
  const { t } = useTranslation()
  const mergeContainerRef = useRef<HTMLDivElement>(null)
  const mergeViewRef = useRef<MergeView | null>(null)

  // The initial content for the local editor. Uses `editedContent` if provided
  // (i.e., parent has unsaved edits), otherwise falls back to the original `localContent`.
  const initialLocalContent = editedContentProp ?? localContent

  // Stable callback refs to avoid recreating effects
  const onContentChangeRef = useRef(onLocalContentChange)
  onContentChangeRef.current = onLocalContentChange
  const onCursorLineChangeRef = useRef(onCursorLineChange)
  onCursorLineChangeRef.current = onCursorLineChange

  // Track if initial edited content has been applied to prevent recreating editor
  const initialContentAppliedRef = useRef(false)
  const prevLocalContentRef = useRef(localContent)
  const prevRemoteContentRef = useRef(remoteContent)

  // Copy feedback state
  const [remoteCopied, setRemoteCopied] = useState(false)
  const [localCopied, setLocalCopied] = useState(false)
  const remoteCopiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const localCopiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Expose getLocalContent via ref for parent components (e.g., ConflictResolver save logic)
  useImperativeHandle(ref, () => ({
    getLocalContent: () => {
      return mergeViewRef.current?.b.state.doc.toString() ?? initialLocalContent
    },
  }), [initialLocalContent])

  const handleCopyRemote = () => {
    navigator.clipboard.writeText(remoteContent)
    setRemoteCopied(true)
    clearTimeout(remoteCopiedTimer.current)
    remoteCopiedTimer.current = setTimeout(() => setRemoteCopied(false), 3000)
  }

  const handleCopyLocal = () => {
    navigator.clipboard.writeText(
      mergeViewRef.current?.b.state.doc.toString() ?? localContent
    )
    setLocalCopied(true)
    clearTimeout(localCopiedTimer.current)
    localCopiedTimer.current = setTimeout(() => setLocalCopied(false), 3000)
  }

  // Copy entire remote content to local (overwrite)
  const handleCopyRemoteToLocal = useCallback(() => {
    const mv = mergeViewRef.current
    if (!mv) return

    const remoteDoc = mv.a.state.doc.toString()
    // Preserve current cursor position/selection if possible
    const currentSelection = mv.b.state.selection.main
    mv.b.dispatch({
      changes: { from: 0, to: mv.b.state.doc.length, insert: remoteDoc },
      selection: { 
        anchor: Math.min(currentSelection.anchor, remoteDoc.length),
        head: Math.min(currentSelection.head, remoteDoc.length)
      },
    })
    onContentChangeRef.current?.(remoteDoc)
  }, [])

  // Copy entire local content to remote (overwrite) — remote is read-only, so this is mainly for symmetry
  const handleCopyLocalToRemote = useCallback(() => {
    const mv = mergeViewRef.current
    if (!mv) return

    const localDoc = mv.b.state.doc.toString()
    // Remote is read-only, but we can still update its content programmatically
    // Preserve current cursor position/selection if possible
    const currentSelection = mv.a.state.selection.main
    mv.a.dispatch({
      changes: { from: 0, to: mv.a.state.doc.length, insert: localDoc },
      selection: { 
        anchor: Math.min(currentSelection.anchor, localDoc.length),
        head: Math.min(currentSelection.head, localDoc.length)
      },
    })
  }, [])

  // Stable refs for renderRevertControl callback (to avoid recreating MergeView on every render)
  const handleCopyLocalToRemoteRef = useRef(handleCopyLocalToRemote)
  handleCopyLocalToRemoteRef.current = handleCopyLocalToRemote
  const handleCopyRemoteToLocalRef = useRef(handleCopyRemoteToLocal)
  handleCopyRemoteToLocalRef.current = handleCopyRemoteToLocal
  const tRef = useRef(t)
  tRef.current = t

  // Get language extension based on filename
  const langExt = useMemo(() => {
    const lang = filename ? getCodeMirrorLanguage(filename) : 'text'
    return languageExtensions[lang] || (() => [])
  }, [filename])

  // Detect dark mode
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  // ── Create / recreate MergeView when content changes ──
  useEffect(() => {
    if (!mergeContainerRef.current) return

    // Only recreate if the source content (from props) actually changed, not edited content
    const localContentChanged = prevLocalContentRef.current !== localContent
    const remoteContentChanged = prevRemoteContentRef.current !== remoteContent
    
    // Update refs
    prevLocalContentRef.current = localContent
    prevRemoteContentRef.current = remoteContent

    // If only edited content changed (not source), don't recreate - update editor instead
    if (mergeViewRef.current && !localContentChanged && !remoteContentChanged) {
      // Check if we need to apply initial edited content
      if (editedContentProp && !initialContentAppliedRef.current) {
        const mv = mergeViewRef.current
        const currentDoc = mv.b.state.doc.toString()
        if (currentDoc !== editedContentProp) {
          mv.b.dispatch({
            changes: { from: 0, to: currentDoc.length, insert: editedContentProp },
          })
        }
        initialContentAppliedRef.current = true
      }
      return
    }

    // Reset the flag when source content changes
    initialContentAppliedRef.current = false

    // Destroy previous merge view if exists
    if (mergeViewRef.current) {
      mergeViewRef.current.destroy()
      mergeViewRef.current = null
    }

    // Shared base extensions for both panes
    // langExt() returns a Promise for most languages — a Promise is NOT a valid
    // CodeMirror Extension and would be silently ignored (or could cause issues).
    // Use a Compartment to load the language extension asynchronously after
    // the MergeView is created.
    const langCompartment = new Compartment()
    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      EditorView.lineWrapping,
      langCompartment.of([]),
      mergeEditorTheme,
    ]

    // Left pane (Remote/A) — read-only
    const aExtensions: Extension = [
      ...baseExtensions,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ]

    // Right pane (Local/B) — editable with history and keymap
    const bExtensions: Extension = [
      ...baseExtensions,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          onContentChangeRef.current?.(update.state.doc.toString())
        }
        // Track cursor position for session persistence
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head
          const line = update.state.doc.lineAt(pos).number
          onCursorLineChangeRef.current?.(line)
        }
      }),
    ]

    try {
      const mv = new MergeView({
        parent: mergeContainerRef.current,
        a: {
          doc: remoteContent,
          extensions: aExtensions,
        },
        b: {
          doc: initialLocalContent,
          extensions: bExtensions,
        },
        revertControls: 'a-to-b',
        highlightChanges: true,
        gutter: true,
        // Custom render function for revert controls — replaces default ⇝ button
        // with our left/right arrow buttons for full content overwrite
        renderRevertControl: () => {
          
          const wrapper = document.createElement('div')
          wrapper.className = 'cm-diff-arrows-wrapper'
          // position:absolute required — CM6 sets style.top.
          wrapper.style.cssText = 'position:absolute;display:flex;flex-direction:row;gap:2px;'

          // Use refs to access latest callbacks without recreating MergeView
          const copyLocalToRemote = () => handleCopyLocalToRemoteRef.current()
          const copyRemoteToLocal = () => handleCopyRemoteToLocalRef.current()
          const translate = (key: string, fallback: string) => tRef.current(key, { defaultValue: fallback })

          // Left arrow — copy local to remote
          const leftBtn = document.createElement('button')
          leftBtn.className = 'cm-diff-arrow-btn cm-diff-arrow-left'
          leftBtn.title = translate('git.copyLocalToRemote', 'Copy local to remote')
          leftBtn.textContent = '\u2190' // ←
          leftBtn.style.cssText = 'width:20px;height:20px;font-size:11px;font-weight:500;line-height:1;padding:0;border:none;border-radius:4px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,0.08);transition:all 0.15s ease;';
          leftBtn.onmouseenter = () => { leftBtn.style.background = 'hsl(var(--primary) / 0.9)' };
          leftBtn.onmouseleave = () => { leftBtn.style.background = 'hsl(var(--primary))' };
          leftBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            
            copyLocalToRemote()
          })

          // Right arrow — copy remote to local
          const rightBtn = document.createElement('button')
          rightBtn.className = 'cm-diff-arrow-btn cm-diff-arrow-right'
          rightBtn.title = translate('git.copyRemoteToLocal', 'Copy remote to local')
          rightBtn.textContent = '\u2192' // →
          rightBtn.style.cssText = 'width:20px;height:20px;font-size:11px;font-weight:500;line-height:1;padding:0;border:none;border-radius:4px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,0.08);transition:all 0.15s ease;';
          rightBtn.onmouseenter = () => { rightBtn.style.background = 'hsl(var(--primary) / 0.9)' };
          rightBtn.onmouseleave = () => { rightBtn.style.background = 'hsl(var(--primary))' };
          rightBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            
            copyRemoteToLocal()
          })

          wrapper.appendChild(leftBtn)
          wrapper.appendChild(rightBtn)
          
          return wrapper
        },
      })

      mergeViewRef.current = mv

      // Asynchronously load and apply the language extension to both panes.
      // langExt() returns a Promise<Extension[]> — we await it and then use
      // Compartment.reconfigure to inject the result into each editor.
      langExt().then((langResult: any) => {
        const exts = Array.isArray(langResult) ? langResult : [langResult]
        if (exts.length > 0 && mergeViewRef.current) {
          try {
            mergeViewRef.current.a.dispatch({
              effects: langCompartment.reconfigure(exts as Extension),
            })
            mergeViewRef.current.b.dispatch({
              effects: langCompartment.reconfigure(exts as Extension),
            })
          } catch {
            // Language extension failed to apply — editor still works without syntax highlighting
          }
        }
      })

      // Restore initial cursor position if specified
      if (initialCursorLine && initialCursorLine > 1) {
        try {
          const lineInfo = mv.b.state.doc.line(Math.min(initialCursorLine, mv.b.state.doc.lines))
          mv.b.dispatch({
            selection: { anchor: lineInfo.from },
            scrollIntoView: true,
          })
        } catch {
          // Ignore invalid line numbers
        }
      }
    } catch (e) {
      console.error('[SplitDiffViewer] Failed to create MergeView:', e)
    }

    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy()
        mergeViewRef.current = null
      }
    }
    // We intentionally depend on content strings so the merge view is recreated
    // when files switch. The parent should also pass a changing `key` prop.
    // Only depend on source content and config, not edited content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteContent, localContent, langExt, isDark])

  // ── Note: Custom revert buttons are rendered via renderRevertControl in MergeView config ──
  // The renderRevertControl callback lets us inject custom elements that survive CM6's measure cycle.

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header toolbar — two-column layout matching MergeView editors below */}
      <div className="flex h-7 text-xs font-medium shrink-0 border-b"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
        {/* Left column — Remote (aligns with left editor) */}
        <div className="flex items-center justify-between pl-3 pr-2 flex-1">
          <div className="flex items-center gap-1">
            <span>{remoteLabel || t('git.remote')}</span>
            <span className="flex items-center gap-0.5 text-[10px] px-1 rounded" style={{ background: 'rgba(156, 163, 175, 0.15)', color: 'var(--text-muted)' }}>
              <Lock size={9} />
            </span>
          </div>
          <button
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] transition-colors shrink-0"
            onClick={handleCopyRemote}
            title={t('git.copyRemoteContent')}
          >
            {remoteCopied
              ? <Check size={12} className="text-green-500" />
              : <Copy size={12} style={{ color: 'var(--text-muted)' }} />}
          </button>
        </div>

        {/* Divider line (aligns with .cm-merge-revert gutter) */}
        <div className="w-px h-full" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Right column — Local (aligns with right editor) */}
        <div className="flex items-center justify-between pr-3 pl-2 flex-1">
          <div className="flex items-center gap-1">
            <span>{localLabel || t('git.local')}</span>
            <span className="flex items-center gap-0.5 text-[10px] px-1 rounded" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
              <Pencil size={9} />
            </span>
          </div>
          <button
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] transition-colors shrink-0"
            onClick={handleCopyLocal}
            title={t('git.copyLocalContent')}
          >
            {localCopied
              ? <Check size={12} className="text-green-500" />
              : <Copy size={12} style={{ color: 'var(--text-muted)' }} />}
          </button>
        </div>
      </div>

      {/* MergeView container — renders both side-by-side editors */}
      <div ref={mergeContainerRef} className="flex-1 min-h-0 overflow-hidden cm-split-diff-viewer" />

      {/* Global styles for the merge view */}
      <style>{`
        /* Root container — constrain outer height only. */
        .cm-split-diff-viewer > .cm-mergeView {
          height: 100% !important;
          /* Keep CM6's default overflowY:auto for unified scrolling */
        }
        .cm-split-diff-viewer .cm-mergeViewEditors {
          display: flex;
          /* Don't constrain height or overflow — let it grow with content */
        }
        /* Each editor pane */
        .cm-split-diff-viewer .cm-mergeViewEditor {
          flex: 1;
          min-width: 0;
        }
        /* ── Gutter background: distinguish the revert control column from editor content ── */
        .cm-split-diff-viewer .cm-merge-revert {
          background: var(--bg-secondary);
        }
        /* ── Per-chunk diff arrows (replace default revert buttons, scrolls with content) ── */
        /* CM6 positions these via style.top (document coord) inside .cm-merge-revert (position:relative) */
        .cm-split-diff-viewer .cm-merge-revert .cm-diff-arrows-wrapper {
          display: flex;
          flex-direction: row;
          gap: 2px;
          /* Inherit position:absolute from CM6's .cm-merge-revert button rule */
        }
        .cm-split-diff-viewer .cm-merge-revert .cm-diff-arrow-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
          padding: 0;
          border: none;
          transition: all 0.15s ease;
          box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        .cm-split-diff-viewer .cm-merge-revert .cm-diff-arrow-btn:hover {
          background: hsl(var(--primary) / 0.9);
        }
        .cm-split-diff-viewer .cm-merge-revert button {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 11px;
          cursor: pointer;
          color: var(--text-muted);
        }
        .cm-split-diff-viewer .cm-merge-revert button:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  )
})

SplitDiffViewer.displayName = 'SplitDiffViewer'

export default SplitDiffViewer
