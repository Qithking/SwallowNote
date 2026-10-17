/**
 * Markdown Editor Component using BlockNote
 *
 * Note: This component is keyed by activeTab.id in Editor.tsx,
 * so it remounts on tab switch — no need to watch content changes.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { PartialBlock, createCodeBlockSpec, BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  LinkToolbarController,
} from '@blocknote/react'
import { codeBlockOptions } from '@blocknote/code-block'
import { useUIStore, useEditorStore, useEditorSettingsStore, useWorkspaceStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@/components/ui/scroll-area'
import { stripFrontmatter } from '@/lib/utils/frontmatter'
import { useTranslation } from 'react-i18next'
import { EditorContextMenu } from './EditorContextMenu'
import { useEditorPasteUpload } from './useEditorPasteUpload'
import { useEditorLinkHandling } from './useEditorLinkHandling'
import { useCustomSlashMenu } from './useCustomSlashMenu'
import { useEditorSerialization } from './useEditorSerialization'
import {
  useEditorScrollEvents,
  useEditorAIEvents,
  useEditorDownloadEvents,
} from './useEditorWindowEvents'
import { useEditorSearchIntegration, adaptBlockNoteSearch } from './useEditorSearchIntegration'
import { useBlockNoteSearch } from './useBlockNoteSearch'
import { parseMarkdownToBlocks, getSharedParseEditor } from './editorBlockTransforms'
import { MermaidBlockSpec } from './mermaidBlockSpec'
import { KatexBlockSpec } from './katexBlockSpec'
import { MarkmapBlockSpec } from './markmapBlockSpec'
import '@blocknote/mantine/style.css'
import { logger } from '@/lib/logger'
import { logTime } from '@/lib/app-startup'

// 诊断埋点：首个 BlockNote 内容区挂载完成（内容可交互）时间。
// 只记首次，配合 editor_md_chunk_loaded 区分「chunk 求值」与「编辑器创建+解析」耗时。
let mdContentReadyLogged = false

interface MarkdownEditorProps {
  content: string
  onChange?: (content: string) => void
}

/** Inner editor — mounts only after blocks are parsed. */
function BlockNoteInner({
  blocks,
  onChange,
}: {
  blocks: PartialBlock[]
  onChange?: (content: string) => void
}) {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')
  const activeTabName = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.name ?? '')
  const {
    normalPaddingVertical,
    normalPaddingHorizontal,
    widePaddingVertical,
    widePaddingHorizontal,
  } = useEditorSettingsStore(
    useShallow((s) => ({
      normalPaddingVertical: s.normalPaddingVertical,
      normalPaddingHorizontal: s.normalPaddingHorizontal,
      widePaddingVertical: s.widePaddingVertical,
      widePaddingHorizontal: s.widePaddingHorizontal,
    })),
  )
  const noteWidth = useUIStore((state) => state.noteWidth)

  const editorContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mdContentReadyLogged) {
      mdContentReadyLogged = true
      logTime('editor_md_content_ready', 0)
    }
  }, [])

  useEffect(() => {
    const apply = () => {
      const container = editorContainerRef.current
      if (!container) return
      const scrollArea = container.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (!scrollArea) return
      if (noteWidth === 'wide') {
        // 宽模式：应用 wide padding 内联样式
        scrollArea.style.paddingTop = `${widePaddingVertical}px`
        scrollArea.style.paddingBottom = `${widePaddingVertical}px`
        scrollArea.style.paddingLeft = `${widePaddingHorizontal}px`
        scrollArea.style.paddingRight = `${widePaddingHorizontal}px`
      } else {
        // 普通模式：应用用户配置的 normalPadding（保留原业务逻辑）
        scrollArea.style.paddingTop = `${normalPaddingVertical}px`
        scrollArea.style.paddingBottom = `${normalPaddingVertical}px`
        scrollArea.style.paddingLeft = `${normalPaddingHorizontal}px`
        scrollArea.style.paddingRight = `${normalPaddingHorizontal}px`
      }
    }
    const timer = setTimeout(apply, 100)
    return () => clearTimeout(timer)
  }, [noteWidth, normalPaddingVertical, normalPaddingHorizontal, widePaddingVertical, widePaddingHorizontal])

  // codeBlock from @blocknote/code-block provides syntax highlighting via Shiki
  // In newer versions, we need to create the code block spec using createCodeBlockSpec
  // Using type assertion to resolve shiki types conflict
  // Memoized via useMemo to avoid recreating on every render
  const codeBlock = useMemo(() => createCodeBlockSpec(codeBlockOptions as any), [])

  // Create a custom schema that includes the default blocks plus the mermaid block
  // Memoized via useMemo to avoid recreating on every render
  const schema = useMemo(() => BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      mermaidBlock: MermaidBlockSpec(),
      katexBlock: KatexBlockSpec(),
      markmapBlock: MarkmapBlockSpec(),
    } as any,
  }), [])

  const { uploadFile, resolveFileUrl, pasteHandler, resolveUploadDir } = useEditorPasteUpload()

  // 链接处理：应用内打开文件、链接点击、capture 拦截、自定义链接工具栏。
  // editor 依赖 handleLinkClick（links.onClick）才能创建，存在创建顺序循环，
  // 故以 ref 延迟传递，editor 创建后回填，capture listener 在事件触发时读取。
  // 泛型用 any：editor 携带自定义 schema 类型，默认泛型与其不兼容。
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null)
  const { handleLinkClick, customLinkToolbar } = useEditorLinkHandling(editorRef, editorContainerRef)

  const editor = useCreateBlockNote({
    initialContent: blocks,
    schema,
    codeBlock,
    uploadFile,
    resolveFileUrl,
    pasteHandler,
    links: {
      onClick: handleLinkClick,
      // 覆盖 BlockNote 默认的 target="_blank"。
      // Tauri webview 会在 native 层拦截 target="_blank" 并在系统浏览器中打开，
      // 这个过程早于 JS 事件处理，preventDefault() 无法阻止。
      // 设置为 _self 后，即使 preventDefault 失败也只会在当前 webview 内导航，
      // 不会泄漏到系统浏览器。
      HTMLAttributes: { target: '_self' },
    },
  })
  // editor 创建后回填 ref，供 useEditorLinkHandling 的 capture listener 判定 editable
  editorRef.current = editor

  // 挂载查找/替换事件桥接 hook
  const bnSearch = useBlockNoteSearch({ editor })
  useEditorSearchIntegration(adaptBlockNoteSearch(bnSearch))

  // window 事件桥接：滚动定位、AI 插入/替换/全选、远程图片下载
  useEditorScrollEvents(editor)
  useEditorAIEvents(editor)
  useEditorDownloadEvents({
    editor,
    activeTabId,
    activeTabPath,
    rootPath,
    resolveUploadDir,
  })

  // 序列化：blocks → markdown（防抖）、flush 注册、TOC 派发、内容缓存读取
  const { debouncedHandleChange, getFullContent } = useEditorSerialization({
    editor,
    onChange,
    activeTabName,
  })

  const themeSetting = useUIStore((state) => state.theme)
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isAppDark = themeSetting === 'dark' || (themeSetting === 'system' && systemIsDark)
  const blocknoteTheme = isAppDark ? 'dark' as const : 'light' as const


  // Methods for the context menu
  const getSelectedText = useCallback(() => {
    if (!editor) return ''
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (!tiptapEditor) return ''
      const { from, to, empty } = tiptapEditor.state.selection
      if (empty) return ''
      return tiptapEditor.state.doc.textBetween(from, to, '\n')
    } catch {
      return ''
    }
  }, [editor])

  const getSelectionLineRange = useCallback((): [number, number] | null => {
    if (!editor) return null
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (!tiptapEditor) return null
      const { from, to, empty } = tiptapEditor.state.selection
      if (empty) return null
      const textBeforeFrom = tiptapEditor.state.doc.textBetween(0, from, '\n')
      const textBeforeTo = tiptapEditor.state.doc.textBetween(0, to, '\n')
      const startLineNumber = (textBeforeFrom.match(/\n/g) || []).length + 1
      const endLineNumber = (textBeforeTo.match(/\n/g) || []).length + 1
      return [startLineNumber, endLineNumber]
    } catch {
      return null
    }
  }, [editor])


  // Custom slash menu items: default items + Mermaid/KaTeX/Markmap templates
  const getCustomSlashMenuItems = useCustomSlashMenu(editor)

  return (
    <EditorContextMenu
      getSelectedText={getSelectedText}
      getSelectionLineRange={getSelectionLineRange}
      getFullContent={getFullContent}
    >
      <div ref={editorContainerRef} className="blocknote-editor-container flex flex-col h-full">
        <ScrollArea className="flex-1 w-full">
          <div className="w-full">
            <BlockNoteView
              editor={editor}
              theme={blocknoteTheme}
              onChange={debouncedHandleChange}
              slashMenu={false}
              linkToolbar={false}
            >
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={getCustomSlashMenuItems}
              />
              <LinkToolbarController linkToolbar={customLinkToolbar} />
            </BlockNoteView>
          </div>
        </ScrollArea>
      </div>
    </EditorContextMenu>
  )
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null)
  const [blocksKey, setBlocksKey] = useState(0)
  const { t } = useTranslation()
  const prevContentRef = useRef(content)
  const isInternalChange = useRef(false)

  // Track internal changes from the editor's onChange callback
  const handleChangeWrapper = (newContent: string) => {
    isInternalChange.current = true
    onChange?.(newContent)
    // Reset after a microtask to allow the state update to propagate
    queueMicrotask(() => {
      isInternalChange.current = false
    })
  }

  useEffect(() => {
    // Skip re-parsing when the content change originated from the editor itself
    if (isInternalChange.current) {
      prevContentRef.current = content
      return
    }

    // content 未加载（undefined/null）时保持 loading 状态，不 mount BlockNoteInner
    // 避免启动时 content 从 undefined 变成实际内容导致 BlockNoteInner 重复 mount
    if (content == null) {
      prevContentRef.current = content
      return
    }

    let cancelled = false

    // 仅当之前是空字符串（''）时才认为"从空到有内容"，
    // 排除 undefined（未加载状态），避免启动时触发 setBlocksKey
    const wasEmpty = prevContentRef.current === ''
    // 之前是否已加载过内容（用于判断是否需要重置 initialBlocks 触发 remount）
    const hadContent = prevContentRef.current != null
    prevContentRef.current = content

    async function parseContent() {
      try {
        // Handle empty content
        if (!content || content.trim() === '') {
          if (!cancelled) {
            setInitialBlocks([{ type: 'paragraph' }])
          }
          return
        }

        // Strip frontmatter defensively: loadTabContent normally stores
        // only the body in tab.content, but some code paths (e.g.
        // resetDirtyTabs, HistoryView) may store the raw file content
        // which includes frontmatter.  Calling stripFrontmatter on an
        // already-stripped body is a no-op, so this is always safe.
        const body = stripFrontmatter(content)

        const tempEditor = getSharedParseEditor()
        // 解析 Markdown 并应用特殊 block 转换（失败时降级为纯文本段落）
        let blocks = await parseMarkdownToBlocks(tempEditor, body)

        if (cancelled) return
        
        if (blocks && blocks.length > 0) {
          setInitialBlocks(blocks)
        } else {
          setInitialBlocks([{ type: 'paragraph' }])
        }
        
        if (wasEmpty && content) {
          setBlocksKey((k) => k + 1)
        }
      } catch (e) {
        if (cancelled) return
        logger.error('markdown-editor', 'Failed to parse markdown:', e)
        // Don't show error UI, instead show content as plain text
        const lines = stripFrontmatter(content).split('\n')
        setInitialBlocks(lines.map(line => ({
          type: 'paragraph' as const,
          content: line || undefined
        })))
      }
    }

    // 仅当之前已加载过内容时才重置 initialBlocks 为 null（用于外部修改场景触发 remount）
    // 启动时 prevContentRef.current 为 undefined，不重置，避免 BlockNoteInner 重复 mount
    if (hadContent) {
      setInitialBlocks(null)
    }
    parseContent()
    return () => { cancelled = true }
  }, [content])

  if (!initialBlocks) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <p>{t('editor.loading')}</p>
      </div>
    )
  }

  return <BlockNoteInner key={blocksKey} blocks={initialBlocks} onChange={handleChangeWrapper} />
}