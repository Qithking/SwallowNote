/**
 * 编辑器 window 事件桥接 hooks。
 * 从 MarkdownEditor.tsx 抽出：滚动定位、AI 插入/替换/全选、远程图片下载。
 */
import { useEffect } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { TextSelection } from 'prosemirror-state'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { downloadCoordinator } from '@/lib/download-coordinator'
import { logger } from '@/lib/logger'
import { walkBlocks, parseMarkdownToBlocks } from './editorBlockTransforms'

/**
 * 滚动定位：监听 scroll-to-line / scroll-to-block-id 事件。
 */
export function useEditorScrollEvents(editor: BlockNoteEditor<any, any, any>) {
  // 滚动到指定行
  const doScrollToLine = (lineNumber: number) => {
    if (!editor) return
    try {
      // 将行号转换为 block 索引（行号从1开始，数组索引从0开始）
      const blockIndex = Math.max(0, Math.min(lineNumber - 1, editor.document.length - 1))
      const block = editor.document[blockIndex]
      if (block) {
        doScrollToBlockId(block.id)
      }
    } catch (e) {
      logger.error('markdown-editor', 'Failed to scroll to line:', e)
    }
  }

  // 根据 block ID 滚动到指定位置，可选通过文本内容查找
  const doScrollToBlockId = (blockId: string, fallbackText?: string) => {
    if (!editor) return
    try {
      const editorContainer = document.querySelector('.blocknote-editor-container')
      if (!editorContainer) return

      let targetElement: Element | null = null

      if (blockId) {
        targetElement = editorContainer.querySelector(`[data-node-type="blockContainer"][data-id="${blockId}"]`)
      }

      if (!targetElement && fallbackText) {
        // Normalise whitespace for comparison so that "A  B" matches "A B".
        const normalise = (s: string) => s.trim().replace(/\s+/g, ' ')
        const target = normalise(fallbackText)
        // Search within heading elements only (<h1>-<h6>) to avoid
        // false matches on paragraph blocks that happen to contain the
        // heading text.  BlockNote renders each heading inside a
        // [data-node-type="blockContainer"] wrapper.
        const headings = editorContainer.querySelectorAll('h1, h2, h3, h4, h5, h6')
        for (const h of headings) {
          const text = normalise(h.textContent || '')
          // Pass 1: exact match (handles plain headings).
          if (text === target) {
            targetElement = h.closest('[data-node-type="blockContainer"]')
            break
          }
        }
        if (!targetElement) {
          // Pass 2: contains match (handles headings with inline
          // formatting where the DOM text has extra characters).
          for (const h of headings) {
            const text = normalise(h.textContent || '')
            if (text && text.includes(target)) {
              targetElement = h.closest('[data-node-type="blockContainer"]')
              break
            }
          }
        }
      }

      if (targetElement) {
        // Manually scroll the Radix ScrollArea Viewport instead of using
        // scrollIntoView.  scrollIntoView can scroll multiple ancestors
        // and behaves inconsistently inside Radix ScrollArea (especially
        // in Tauri WebKit), causing the heading to land off-centre.
        const viewport = editorContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
        if (viewport && targetElement instanceof HTMLElement) {
          const viewportRect = viewport.getBoundingClientRect()
          const targetRect = targetElement.getBoundingClientRect()
          // Centre the target within the viewport.
          const offset =
            targetRect.top - viewportRect.top + viewport.scrollTop -
            (viewportRect.height - targetRect.height) / 2
          viewport.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
        } else {
          // Fallback: native scrollIntoView (e.g. if Radix viewport not found).
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        logger.warn('markdown-editor', 'Block element not found:', blockId, 'fallback:', fallbackText)
      }
    } catch (e) {
      logger.error('markdown-editor', 'Failed to scroll to block:', e)
    }
  }

  // 监听滚动到行事件
  useEffect(() => {
    let cancelled = false
    const handler = (e: Event) => {
      if (cancelled) return
      const line = (e as CustomEvent).detail.line
      doScrollToLine(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => {
      cancelled = true
      window.removeEventListener('scroll-to-line', handler)
    }
  }, [editor])

  // 监听滚动到 block ID 事件
  useEffect(() => {
    let cancelled = false
    const handler = (e: Event) => {
      if (cancelled) return
      const { blockId, fallbackText } = (e as CustomEvent).detail
      doScrollToBlockId(blockId, fallbackText)
    }
    window.addEventListener('scroll-to-block-id', handler)
    return () => {
      cancelled = true
      window.removeEventListener('scroll-to-block-id', handler)
    }
  }, [editor])
}

/**
 * AI 协作事件：监听 insert-at-cursor / replace-content 插入或替换内容，
 * 以及 Cmd/Ctrl+A 全选（Tauri WebView 下原生 selectAll 会先于 ProseMirror 拦截）。
 */
export function useEditorAIEvents(editor: BlockNoteEditor<any, any, any>) {
  // Insert text at cursor position in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      if (!text) return

      try {
        // 解析 Markdown 并应用特殊 block 转换（失败时降级为纯文本段落）
        const blocks = await parseMarkdownToBlocks(editor, text, 'Failed to parse markdown for insert')

        if (blocks.length > 0) {
          const currentBlock = editor.getTextCursorPosition().block
          if (Array.isArray(currentBlock.content) && currentBlock.content.length === 0) {
            // Current block is empty, replace it with the first new block and insert the rest after
            editor.replaceBlocks([currentBlock.id], [blocks[0]])
            if (blocks.length > 1) {
              const firstInserted = editor.getTextCursorPosition().block
              editor.insertBlocks(blocks.slice(1), firstInserted.id, 'after')
            }
          } else {
            // Insert all blocks after the current block
            editor.insertBlocks(blocks, currentBlock.id, 'after')
          }
        }
      } catch (err) {
        logger.error('markdown-editor', 'Failed to insert at cursor in BlockNote:', err)
      }
    }
    window.addEventListener('insert-at-cursor', handler)
    return () => {
      cancelled = true
      window.removeEventListener('insert-at-cursor', handler)
    }
  }, [editor])

  // Replace selected text or entire content in BlockNote
  // AI results are Markdown, so we need to parse them into BlockNote blocks
  // rather than inserting raw Markdown source code.
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      if (cancelled || !editor) return
      const { text } = (e as CustomEvent).detail
      if (!text) return

      try {
        // 解析 Markdown 并应用特殊 block 转换（失败时降级为纯文本段落）
        const blocks = await parseMarkdownToBlocks(editor, text, 'Failed to parse markdown for replace')

        if (blocks.length === 0) return

        const tiptapEditor = (editor as any)._tiptapEditor
        if (tiptapEditor) {
          const { empty } = tiptapEditor.state.selection
          if (!empty) {
            // Replace the blocks that overlap with the current selection
            // Find which blocks are covered by the selection
            const { from, to } = tiptapEditor.state.selection
            const doc = tiptapEditor.state.doc

            // Collect block IDs that are within the selection range
            const blockIdsToRemove: string[] = []
            doc.descendants((node: any, pos: number) => {
              if (node.type.name === 'blockContainer' && node.attrs?.id) {
                const blockStart = pos
                const blockEnd = pos + node.nodeSize
                // Check if this block overlaps with the selection
                if (blockStart < to && blockEnd > from) {
                  blockIdsToRemove.push(node.attrs.id)
                }
              }
            })

            if (blockIdsToRemove.length > 0) {
              editor.replaceBlocks(blockIdsToRemove, blocks)
            } else {
              // Fallback: insert after current block
              const currentBlock = editor.getTextCursorPosition().block
              editor.insertBlocks(blocks, currentBlock.id, 'after')
            }
          } else {
            // Replace entire content
            const allBlockIds = editor.document.map((b: any) => b.id)
            editor.replaceBlocks(allBlockIds, blocks)
          }
        }
      } catch (err) {
        logger.error('markdown-editor', 'Failed to replace content in BlockNote:', err)
      }
    }
    window.addEventListener('replace-content', handler)
    return () => {
      cancelled = true
      window.removeEventListener('replace-content', handler)
    }
  }, [editor])

  // Handle Cmd+A / Ctrl+A select all in BlockNote
  // In Tauri WebView, the browser's native selectAll intercepts Cmd+A before
  // ProseMirror's keymap can handle it. We use a direct DOM onkeydown handler
  // on the ProseMirror editor element to ensure it works reliably.
  useEffect(() => {
    if (!editor) return

    const tiptapEditor = (editor as any)?._tiptapEditor
    const editorElement = tiptapEditor?.view?.dom as HTMLElement | undefined
    if (!editorElement) return

    // Use a direct DOM handler instead of addEventListener for maximum reliability
    const originalOnKeyDown = editorElement.onkeydown
    editorElement.onkeydown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        try {
          // Use ProseMirror's TextSelection with document traversal
          // BlockNote's document structure requires positions to be within valid text nodes
          const { state, dispatch } = tiptapEditor.view
          const doc = state.doc

          // Traverse document to find first and last text positions
          let startPos = 1  // Default fallback
          let endPos = Math.max(1, doc.content.size - 1)  // Default fallback

          // Find first text node position
          doc.descendants((node: any, pos: number) => {
            if (node.isText && startPos === 1) {
              startPos = pos
            }
            // Continue traversal to find last position
            if (node.isText) {
              endPos = pos + node.nodeSize
            }
          })

          // Ensure positions are valid
          startPos = Math.max(1, Math.min(startPos, doc.content.size - 1))
          endPos = Math.max(startPos + 1, Math.min(endPos, doc.content.size))

          // Create TextSelection with found positions
          const selection = TextSelection.create(state.doc, startPos, endPos)
          const tr = state.tr.setSelection(selection)
          dispatch(tr)
        } catch (err) {
          logger.error('markdown-editor', 'Failed to select all:', err)
        }
        return false
      }
      // Call original handler if exists
      if (originalOnKeyDown) {
        return originalOnKeyDown.call(editorElement, e)
      }
    }

    return () => {
      editorElement.onkeydown = originalOnKeyDown
    }
  }, [editor])
}

/**
 * 远程图片下载事件：监听 editor:download-remote-images（由 EditorToolbar 派发，
 * 带 tabId 防止多 tab 错处理），收集远程 image/file block 交给全局协调器。
 */
export function useEditorDownloadEvents({
  editor,
  activeTabId,
  activeTabPath,
  rootPath,
  resolveUploadDir,
}: {
  editor: BlockNoteEditor<any, any, any>
  activeTabId: string | null
  activeTabPath: string
  // workspace 未打开目录时为 null，内部以 '' 兜底
  rootPath: string | null
  resolveUploadDir: () => Promise<string>
}) {
  const { t } = useTranslation()

  // 监听下载远程图片事件（由 EditorToolbar 派发，带 tabId 防止多 tab 错处理）。
  // 流程：仅当事件的 tabId 匹配当前 activeTab.id 时才处理；遍历 editor.document
  // 收集 image/file blocks 中的 http(s) URL，统一交给全局 downloadCoordinator，
  // 由协调器合并多文件进度并即时替换 block URL。
  useEffect(() => {
    let cancelled = false
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      // 事件携带 tabId 时只处理当前 tab；旧版事件无 tabId 时也接受（向后兼容）
      if (detail.tabId && activeTabId && detail.tabId !== activeTabId) return
      if (cancelled || !editor) return
      try {
        // 1. 收集远程图片 block（递归遍历 document，包含嵌套在列表/引用/表格等 children 中的图片）
        const remoteBlocks: { blockId: string; url: string }[] = []
        // 使用 walkBlocks 递归遍历，visitor 仅做副作用收集（返回 undefined 保留原 block）
        walkBlocks(editor.document as any[], (block) => {
          if (block.type === 'image' || block.type === 'file') {
            const url = (block.props as any)?.url
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
              remoteBlocks.push({ blockId: block.id, url })
            }
          }
        })

        if (remoteBlocks.length === 0) {
          toast.info(t('download.noRemoteImages'))
          return
        }

        // 2. 解析上传目录与文件所在目录
        const targetDir = await resolveUploadDir()
        const filePath = activeTabPath || ''
        const fileDir = filePath.split(/[\\/]/).slice(0, -1).join('/')

        // 3. 构造 url → ApplyContext[] 映射（保留所有 block，支持一对多替换）
        //    items 按 URL 去重：同一 URL 只发一个下载请求，由协调器跨批次去重
        const blockContexts = new Map<string, { editor: any; blockId: string }[]>()
        const seenUrls = new Set<string>()
        const items: { url: string; blockId: string }[] = []
        for (const b of remoteBlocks) {
          // blockContexts 追加所有引用此 URL 的 block（一对多）
          const existing = blockContexts.get(b.url) || []
          existing.push({ editor, blockId: b.blockId })
          blockContexts.set(b.url, existing)
          // items 按 URL 去重（后端只下载一次）
          if (!seenUrls.has(b.url)) {
            seenUrls.add(b.url)
            items.push({ url: b.url, blockId: b.blockId })
          }
        }

        // 5. 交给协调器：合并 toast + 即时替换
        downloadCoordinator.enqueueBatch(items, blockContexts, {
          targetDir,
          fileDir,
          rootPath: rootPath || '',
        })
      } catch (err) {
        logger.error('markdown-editor', 'Failed to enqueue download remote images:', err)
        toast.error(t('download.downloadFailed', { error: String(err) }))
      }
    }
    window.addEventListener('editor:download-remote-images', handler)
    return () => {
      cancelled = true
      window.removeEventListener('editor:download-remote-images', handler)
    }
  }, [editor, activeTabId, activeTabPath, rootPath, resolveUploadDir, t])
}
