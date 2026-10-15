/**
 * 编辑器链接处理 hook。
 * 从 MarkdownEditor.tsx 抽出：应用内打开文件、链接点击跳转、
 * capture-phase 点击拦截、自定义链接工具栏。
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { BlockNoteEditor } from '@blocknote/core'
import {
  useComponentsContext,
  useDictionary,
  EditLinkButton,
  DeleteLinkButton,
} from '@blocknote/react'
import type { LinkToolbarProps } from '@blocknote/react'
import { useEditorStore } from '@/stores'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { readFile, pathExists, getFileMetadata } from '@/lib/tauri'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { countWords } from '@/lib/utils/wordCount'
import { logger } from '@/lib/logger'
import { isExternalUrl, resolveFilePath } from './editorBlockTransforms'

export function useEditorLinkHandling(
  // editor 以 ref 延迟传入：handleLinkClick 需在 useCreateBlockNote 创建 editor 时就绪，
  // 而 editor 对象此时尚不存在，故由调用方在创建后回填 ref，事件触发时读取。
  editorRef: RefObject<BlockNoteEditor | null>,
  editorContainerRef: RefObject<HTMLDivElement | null>,
) {
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')
  const addTab = useEditorStore((s) => s.addTab)
  const { t } = useTranslation()

  // Refs to access latest values inside stable callbacks (editor is created once)
  const activeTabPathRef = useRef(activeTabPath)
  activeTabPathRef.current = activeTabPath
  const addTabRef = useRef(addTab)
  addTabRef.current = addTab

  // 通过链接点击在应用内打开文件为新标签页
  const openFileInApp = useCallback(async (filePath: string) => {
    try {
      // 先检查文件是否存在，给出更友好的提示
      const exists = await pathExists(filePath)
      if (!exists) {
        toast.error(t('download.fileNotFound', { path: filePath }))
        return
      }
      const [content, meta] = await Promise.all([
        readFile(filePath),
        getFileMetadata(filePath).catch(() => null),
      ])
      const fileName = filePath.split('/').pop() || filePath
      addTabRef.current({
        id: filePath,
        path: filePath,
        name: fileName,
        content,
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
        // 使用文件元数据中的真实大小和修改时间，回退到近似值
        fileSize: meta
          ? meta.file_size > 1024
            ? `${(meta.file_size / 1024).toFixed(1)}Kb`
            : `${meta.file_size}B`
          : content.length > 1024
            ? `${(content.length / 1024).toFixed(1)}Kb`
            : `${content.length}B`,
        modifiedTime: meta?.modified_time || new Date().toLocaleString(),
        wordCount: countWords(content),
      })
    } catch (e) {
      logger.error('markdown-editor', 'Failed to open file from link:', e)
      toast.error(t('download.openFileFailed', { path: filePath }))
    }
  }, [t])

  // links.onClick 回调：处理链接点击跳转。
  // 注意：capture-phase listener 作为拦截 Tauri webview 导航的第一道防线，
  // 但它依赖 editorContainerRef，在某些场景下可能未注册成功。
  // 因此 handleLinkClick 必须保留完整跳转逻辑作为兜底。
  const handleLinkClick = useCallback((event: MouseEvent, _editor: BlockNoteEditor): boolean | void => {
    const target = event.target as HTMLElement
    const link = target.closest('a[data-inline-content-type="link"]') as HTMLAnchorElement | null
    if (!link) return false

    const href = link.getAttribute('href') || ''
    if (!href) return false
    if (href.startsWith('data:') || href.startsWith('asset://')) return false

    // 阻止 <a> 的默认导航行为
    event.preventDefault()

    if (isExternalUrl(href)) {
      openExternal(href).catch((e) => logger.warn('markdown-editor', 'openExternal failed', href, e))
      return true
    }

    if (href.startsWith('#')) {
      const anchor = href.substring(1)
      const container = editorContainerRef.current
      if (container) {
        const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
        for (const h of headings) {
          const text = h.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || ''
          if (text === anchor.toLowerCase()) {
            h.scrollIntoView({ behavior: 'smooth', block: 'center' })
            break
          }
        }
      }
      return true
    }

    const absolutePath = resolveFilePath(href, activeTabPathRef.current)
    openFileInApp(absolutePath)
    return true
  }, [openFileInApp, editorContainerRef])

  // Capture-phase click listener: 在捕获阶段拦截链接点击并 preventDefault()，
  // 防止 <a> 默认导航。此 listener 对只读模式必需——BlockNote 的 links.onClick
  // 在只读模式下不会被调用（clickHandler.ts 中 !view.editable 时直接 return false）。
  // 分支处理：
  // - 外部链接：仅 preventDefault，由 handleLinkClick 统一打开（编辑模式）。
  // - 锚点跳转：capture listener 直接滚动（编辑模式下 handleLinkClick 的重复滚动
  //   定位到同一元素，无副作用）。
  // - 内部文件链接：编辑模式仅 preventDefault，交给 handleLinkClick 统一打开，
  //   避免双重调用 openFileInApp；只读模式下 links.onClick 不触发，由本 listener
  //   承担唯一打开路径。
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    const handleClickCapture = (event: MouseEvent) => {
      if (event.button !== 0) return

      const target = event.target as HTMLElement
      if (!target) return

      const link = target.closest('a[data-inline-content-type="link"]') as HTMLAnchorElement | null
      if (!link) return

      const href = link.getAttribute('href') || ''
      if (!href) return
      if (href.startsWith('data:') || href.startsWith('asset://')) return

      // 阻止 <a> 的默认导航（target 已改为 _self，但仍需 preventDefault 避免当前 webview 导航）
      event.preventDefault()

      if (isExternalUrl(href)) {
        // 编辑模式下 handleLinkClick 会处理外部链接打开，这里仅 preventDefault 避免双重打开。
        // 若未来引入只读模式（editor.setEditable(false)），需比照下方内部文件分支
        // 增加 editable 判定，改为直接 openExternal(href)。
        return
      }

      if (href.startsWith('#')) {
        const anchor = href.substring(1)
        const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
        for (const h of headings) {
          const text = h.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || ''
          if (text === anchor.toLowerCase()) {
            h.scrollIntoView({ behavior: 'smooth', block: 'center' })
            break
          }
        }
        return
      }

      // 与 BlockNote clickHandler 相同的 editable 判定：读取 tiptap view.editable。
      // 编辑模式下 links.onClick（handleLinkClick）会触发并统一打开，此处直接返回
      // 避免双重调用 openFileInApp；只读模式下 links.onClick 不触发，由本 listener 打开。
      const tiptap = (editorRef.current as any)?._tiptapEditor
      if (tiptap?.view?.editable !== false) return

      const absolutePath = resolveFilePath(href, activeTabPathRef.current)
      openFileInApp(absolutePath)
    }

    container.addEventListener('click', handleClickCapture, true)

    return () => {
      container.removeEventListener('click', handleClickCapture, true)
    }
  }, [openFileInApp, editorContainerRef, editorRef])

  // Custom link toolbar — replaces the default one to handle relative path links.
  // useMemo with stable deps ensures the component type doesn't change across renders.
  const customLinkToolbar = useMemo(() => {
    return function CustomLinkToolbar(props: LinkToolbarProps) {
      const Components = useComponentsContext()!
      const dict = useDictionary()

      const handleOpen = () => {
        const url = props.url
        if (isExternalUrl(url)) {
          openExternal(url).catch((e) => logger.warn('markdown-editor', 'openExternal failed', url, e))
          return
        }
        if (url.startsWith('#')) {
          const anchor = url.substring(1)
          const container = editorContainerRef.current
          if (container) {
            const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
            for (const h of headings) {
              const text = h.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || ''
              if (text === anchor.toLowerCase()) {
                h.scrollIntoView({ behavior: 'smooth', block: 'center' })
                break
              }
            }
          }
          return
        }
        if (url.startsWith('data:') || url.startsWith('asset://')) {
          window.open(url, '_blank')
          return
        }
        // Relative or absolute file path — open in app
        const absolutePath = resolveFilePath(url, activeTabPathRef.current)
        openFileInApp(absolutePath)
      }

      return (
        <Components.LinkToolbar.Root className="bn-toolbar bn-link-toolbar">
          <EditLinkButton
            url={props.url}
            text={props.text}
            range={props.range}
            setToolbarOpen={props.setToolbarOpen}
            setToolbarPositionFrozen={props.setToolbarPositionFrozen}
          />
          <Components.LinkToolbar.Button
            className="bn-button"
            mainTooltip={dict.link_toolbar.open.tooltip}
            label={dict.link_toolbar.open.tooltip}
            isSelected={false}
            onClick={handleOpen}
            icon={<ExternalLink size={16} />}
          />
          <DeleteLinkButton
            range={props.range}
            setToolbarOpen={props.setToolbarOpen}
          />
        </Components.LinkToolbar.Root>
      )
    }
  }, [openFileInApp, editorContainerRef])

  return { openFileInApp, handleLinkClick, customLinkToolbar }
}
