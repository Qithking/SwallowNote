/**
 * DirectoryView Component - Document outline/TOC panel using rc-tree
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Tree from 'rc-tree'
import 'rc-tree/assets/index.css'
import { Heading1, Heading2, Heading3, Heading4, Heading5, Heading6 } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { TocItem } from '@/utils/tableOfContents'
import { buildTableOfContentsFromMarkdown } from '@/utils/tableOfContents'
import { useTranslation } from 'react-i18next'

interface TreeNode {
  key: string
  title: string
  children?: TreeNode[]
}

function DirectoryView() {
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeTabName = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.name ?? '')
  const activeTabContent = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.content ?? '')
  const viewMode = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.viewMode ?? 'preview')
  // Tracks whether we've received a block-ID-based TOC from the
  // 'block-editor-ready' event.  In preview mode the text-parsed TOC
  // is only a fallback until the event arrives; after that the event
  // is the sole source (it carries block IDs for precise scrolling).
  const hasBlockTocRef = useRef(false)
  const { t } = useTranslation()
  const [toc, setToc] = useState<TocItem | null>(null)
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  function tocToTree(tocItem: TocItem): TreeNode[] {
    return tocItem.children.map((child) => ({
      key: child.blockId || child.id,
      title: child.title,
      children: child.children.length > 0 ? tocToTree(child) : undefined,
    }))
  }

  function flattenTocItems(tocItem: TocItem): TocItem[] {
    const result: TocItem[] = []
    function traverse(item: TocItem) {
      result.push(item)
      for (const child of item.children) {
        traverse(child)
      }
    }
    traverse(tocItem)
    return result
  }

  // BlockNote (preview) mode TOC: listens for 'block-editor-ready' events
  // dispatched by MarkdownEditor.  Always registered so events are never
  // missed, but only acts in preview mode.
  useEffect(() => {
    const handler = (e: Event) => {
      if (viewMode !== 'preview') return
      const detail = (e as CustomEvent).detail
      if (detail.toc && detail.isBlockNote) {
        hasBlockTocRef.current = true
        const newToc = detail.toc as TocItem
        if (newToc.children.length > 0) {
          setToc(newToc)
          setTreeData(tocToTree(newToc))
          setExpandedKeys(
            flattenTocItems(newToc).map((item) => item.blockId || item.id)
          )
        } else {
          setToc(null)
          setTreeData([])
          setExpandedKeys([])
        }
      }
    }
    window.addEventListener('block-editor-ready', handler)
    return () => window.removeEventListener('block-editor-ready', handler)
  }, [viewMode])

  // Reset block-TOC tracking on tab / mode switch so the text fallback
  // can populate the panel before the next 'block-editor-ready' event.
  useEffect(() => {
    hasBlockTocRef.current = false
  }, [viewMode, activeTabId])

  // Markdown text TOC — always runs.  In source mode it is the primary
  // source (with lineNumber for CodeMirror scrolling).  In preview mode it
  // serves as an immediate fallback so the panel isn't empty before the
  // 'block-editor-ready' event arrives; once that event has fired the ref
  // gates further text-based updates to preserve block IDs.
  useEffect(() => {
    if (!activeTabId) {
      setToc(null)
      setTreeData([])
      setExpandedKeys([])
      setSelectedId('')
      return
    }

    setSelectedId('')

    const isMarkdown = activeTabName.toLowerCase().endsWith('.md')
    if (!isMarkdown) {
      setToc(null)
      setTreeData([])
      setExpandedKeys([])
      return
    }

    if (!activeTabContent) {
      setToc(null)
      setTreeData([])
      setExpandedKeys([])
      return
    }

    const timer = setTimeout(() => {
      // In preview mode, skip once block-editor has provided a TOC.
      if (viewMode === 'preview' && hasBlockTocRef.current) return

      const entryTitle = activeTabName.replace(/\.md$/i, '')
      const newToc = buildTableOfContentsFromMarkdown(entryTitle, activeTabContent)

      if (newToc.children.length > 0) {
        setToc(newToc)
        setTreeData(tocToTree(newToc))
        setExpandedKeys(flattenTocItems(newToc).map((item) => item.blockId || item.id))
      } else {
        setToc(null)
        setTreeData([])
        setExpandedKeys([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [viewMode, activeTabId, activeTabName, activeTabContent])

  const scrollToPosition = useCallback((item: TocItem) => {
    setTimeout(() => {
      if (item.blockId) {
        // Block-based TOC (from BlockNote) — always precise in both modes.
        window.dispatchEvent(
          new CustomEvent('scroll-to-block-id', {
            detail: { blockId: item.blockId, fallbackText: item.title },
          })
        )
      } else if (viewMode === 'source' && item.lineNumber) {
        // Source mode — scroll CodeMirror to the heading's line number.
        // Only valid in source mode; in preview mode lineNumber does NOT
        // map 1:1 to BlockNote block indices.
        window.dispatchEvent(
          new CustomEvent('scroll-to-line', {
            detail: { line: item.lineNumber },
          })
        )
      } else if (item.title) {
        // Preview-mode fallback TOC (text-parsed, no blockId): dispatch a
        // scroll-to-block-id with only fallbackText so doScrollToBlockId
        // can find the block by its text content.
        window.dispatchEvent(
          new CustomEvent('scroll-to-block-id', {
            detail: { blockId: '', fallbackText: item.title },
          })
        )
      }
    }, 50)
  }, [viewMode])

  const handleSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string
      setSelectedId(key)
      if (toc) {
        const allItems = flattenTocItems(toc)
        const item = allItems.find((i) => (i.blockId || i.id) === key)
        if (item) {
          scrollToPosition(item)
        }
      }
    }
  }

  const handleExpand = (keys: React.Key[]) => {
    setExpandedKeys(keys as string[])
  }

  const renderTitle = (node: TreeNode) => {
    const isSelected = selectedId === node.key
    let level = 1

    if (toc) {
      const allItems = flattenTocItems(toc)
      const item = allItems.find((i) => (i.blockId || i.id) === node.key)
      if (item) {
        level = item.level
      }
    }

    const IconComponent =
      level === 1
        ? Heading1
        : level === 2
          ? Heading2
          : level === 3
            ? Heading3
            : level === 4
              ? Heading4
              : level === 5
                ? Heading5
                : Heading6

    return (
      <span
        className={`flex items-center h-[24px] cursor-pointer select-none gap-1 text-xs min-w-0 ${
          isSelected ? 'text-[var(--theme-color)]' : 'text-[var(--text-secondary)]'
        }`}
      >
        <IconComponent size={12} className="shrink-0 opacity-70" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 truncate">{node.title}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{node.title}</TooltipContent>
        </Tooltip>
      </span>
    )
  }

  if (!activeTabId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center h-10 px-3 shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2">           
            <span className="text-xs font-medium uppercase tracking-wider">
              {t('directory.title')}
            </span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <p className="text-xs">{t('directory.noFileOpen')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center h-10 px-3 shrink-0 "
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium uppercase tracking-wider"
          >
            {t('directory.title')}
          </span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2">
        {treeData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <p className="text-xs">{t('directory.noToc')}</p>
          </div>
        ) : (
          <Tree
            treeData={treeData}
            selectedKeys={selectedId ? [selectedId] : []}
            expandedKeys={expandedKeys}
            onSelect={handleSelect}
            onExpand={handleExpand}
            titleRender={renderTitle}
            showLine
            showIcon={false}
            className="text-[var(--text-secondary)] my-tree"
          />
        )}
      </ScrollArea>
    </div>
  )
}

export { DirectoryView }