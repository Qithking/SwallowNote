/**
 * 编辑器序列化 hook。
 * 从 MarkdownEditor.tsx 抽出：blocks → markdown 序列化（防抖）、
 * flush 注册、TOC 事件派发、内容缓存读取。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { useTranslation } from 'react-i18next'
import { registerFlushFn } from '@/lib/editor-flush'
import { compactMarkdown } from '@/utils/compact-markdown'
import { buildTableOfContents } from '@/utils/tableOfContents'
import { logger } from '@/lib/logger'
import { serializeBlocksForMarkdown } from './editorBlockTransforms'

interface UseEditorSerializationOptions {
  editor: BlockNoteEditor<any, any, any>
  onChange?: (content: string) => void
  activeTabName: string
}

export function useEditorSerialization({ editor, onChange, activeTabName }: UseEditorSerializationOptions) {
  const { t } = useTranslation()

  // Cache the last onChange result so getFullContent can return it synchronously
  const lastContentRef = useRef<string | null>('')
  // Debounce timer ref — delays expensive serialization to avoid
  // blocking the UI on every keystroke.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The actual serialization + notification logic (expensive).
  // Also dispatches the TOC event so DirectoryView updates are debounced too.
  const serializeAndNotify = useCallback(async () => {
    if (!onChange || !editor) return
    try {
      // 将 mermaid/katex/markmap 特殊 block 转换为 codeBlock，其他 block 保留原样
      const document = serializeBlocksForMarkdown(editor.document as any[])
      const rawMd = await editor.blocksToMarkdownLossy(document as typeof editor.document)
      const md = compactMarkdown(rawMd)
      lastContentRef.current = md
      onChange(md)

      // Update TOC (debounced with content change)
      try {
        const entryTitle = activeTabName.replace(/\.md$/i, '') || t('editor.untitled')
        const toc = buildTableOfContents(entryTitle, editor.document)
        window.dispatchEvent(new CustomEvent('block-editor-ready', {
          detail: { toc, isBlockNote: true }
        }))
      } catch (error) {
        logger.error('markdown-editor', 'Error building table of contents:', error)
      }
    } catch (e) {
      logger.error('markdown-editor', 'Failed to convert blocks to markdown:', e)
      // Don't propagate error to avoid breaking the editor
    }
  }, [onChange, editor, activeTabName, t])

  // Debounced handleChange — coalesces rapid edits into a single
  // serialization pass every 300ms, keeping the UI responsive.
  const debouncedHandleChange = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      serializeAndNotify()
    }, 300)
  }, [serializeAndNotify])

  // Flush pending content immediately (used before save operations).
  const flushPendingContent = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      await serializeAndNotify()
    }
  }, [serializeAndNotify])

  // Register flush function so save handlers can flush before writing.
  useEffect(() => {
    return registerFlushFn(flushPendingContent)
  }, [flushPendingContent])

  // Cleanup debounce timer on unmount — flush pending content to avoid data loss on tab switch.
  // 注：serializeAndNotify 是 async，cleanup 无法 await，此处为 fire-and-forget。
  // tab 切换主路径已由 flushAllEditors()（在 setActiveTab 前 await）保护；
  // app 退出场景由 App.tsx 的 close-requested 监听器调用 flushAllEditors() 兜底。
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
        // 兜底：触发序列化（async，不阻塞 cleanup）
        serializeAndNotify()
      }
      // 释放缓存的文档内容，避免 tab 切换后闭包持有大字符串
      lastContentRef.current = null
    }
  }, [serializeAndNotify])

  // Build initial TOC when editor mounts or tab switches.
  // Subsequent TOC updates are handled by the debounced serializeAndNotify.
  useEffect(() => {
    if (!editor || !editor.document) return

    try {
      const entryTitle = activeTabName.replace(/\.md$/i, '') || t('editor.untitled')
      const toc = buildTableOfContents(entryTitle, editor.document)

      window.dispatchEvent(new CustomEvent('block-editor-ready', {
        detail: { toc, isBlockNote: true }
      }))
    } catch (error) {
      logger.error('markdown-editor', 'Error building table of contents:', error)
    }
  }, [editor, activeTabName, t])

  const getFullContent = useCallback(() => {
    // Return cached content from the last onChange call to avoid expensive re-rendering
    if (lastContentRef.current) return lastContentRef.current
    // Fallback: only compute if we haven't cached yet
    if (!editor) return ''
    try {
      const tiptapEditor = (editor as any)._tiptapEditor
      if (tiptapEditor) {
        return tiptapEditor.state.doc.textContent || ''
      }
    } catch (e) {
      logger.warn('markdown-editor', 'Failed to get editor text content:', e)
    }
    return ''
  }, [editor])

  return { lastContentRef, debouncedHandleChange, getFullContent }
}
