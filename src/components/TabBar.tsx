/**
 * TabBar Component - Editor tabs management
 * Shows file tabs with dirty/saved status indicators
 */
import { useRef, useState, useEffect } from 'react'
import { X, FileText, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useEditorStore, useFileTreeStore, useWorkspaceStore, useUIStore } from '@/stores'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import type { EditorTab } from '@/stores/editor'

function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useEditorStore()
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode } = useUIStore()
  const { showToast } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const getRelativePath = (path: string): string => {
    if (!rootPath) return path
    return path.substring(rootPath.length + 1)
  }

  const handleClose = (tab: EditorTab) => {
    removeTab(tab.id)
  }

  const handleCloseOthers = (tab: EditorTab) => {
    tabs.forEach(t => {
      if (t.id !== tab.id) {
        removeTab(t.id)
      }
    })
  }

  const handleCloseRight = (tab: EditorTab) => {
    const tabIndex = tabs.findIndex(t => t.id === tab.id)
    tabs.slice(tabIndex + 1).forEach(t => {
      removeTab(t.id)
    })
  }

  const handleCopyPath = async (tab: EditorTab) => {
    try {
      await navigator.clipboard.writeText(tab.path)
      showToast('路径已复制')
    } catch (e) {
      showToast('复制失败')
    }
  }

  const handleCopyRelativePath = async (tab: EditorTab) => {
    try {
      await navigator.clipboard.writeText(getRelativePath(tab.path))
      showToast('相对路径已复制')
    } catch (e) {
      showToast('复制失败')
    }
  }

  const handleShowInFinder = async (tab: EditorTab) => {
    try {
      await invoke('open_in_finder', { path: tab.path })
    } catch (e) {
      showToast('打开失败')
    }
  }

  const checkScroll = () => {
    if (!scrollRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
    setCanScrollLeft(scrollLeft > 0)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1)
    setIsOverflowing(scrollWidth > clientWidth)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (el) {
      el.addEventListener('scroll', checkScroll)
      window.addEventListener('resize', checkScroll)
    }
    return () => {
      if (el) {
        el.removeEventListener('scroll', checkScroll)
      }
      window.removeEventListener('resize', checkScroll)
    }
  }, [tabs])

  // Click outside to close more menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMoreMenu])

  // 当 activeTabId 变化时，自动滚动到活动 tab
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return
    let rafId: number
    const scrollToActiveTab = () => {
      const tabEl = tabRefs.current.get(activeTabId)
      const scrollEl = scrollRef.current
      if (!tabEl || !scrollEl) return

      const scrollRect = scrollEl.getBoundingClientRect()
      const tabRect = tabEl.getBoundingClientRect()
      
      // 计算 tab 相对于滚动容器的位置
      const tabLeft = tabRect.left - scrollRect.left + scrollEl.scrollLeft
      const tabRight = tabLeft + tabRect.width

      // 如果 tab 不在可视范围内
      if (tabLeft < scrollEl.scrollLeft) {
        scrollEl.scrollTo({ left: tabLeft - 4, behavior: 'smooth' })
      } else if (tabRight > scrollEl.scrollLeft + scrollEl.clientWidth) {
        scrollEl.scrollTo({ left: tabRight - scrollEl.clientWidth + 4, behavior: 'smooth' })
      }
    }

    rafId = requestAnimationFrame(scrollToActiveTab)
    return () => cancelAnimationFrame(rafId)
  }, [activeTabId])

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const scrollAmount = 200
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (!scrollRef.current) return
    // 阻止默认垂直滚动，转换为横向滚动
    // 向前滚动（deltaY > 0）→ 向左移动；向后滚动（deltaY < 0）→ 向右移动
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      scrollRef.current.scrollLeft += e.deltaY
    }
  }

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    removeTab(tabId)
  }

  const scrollToTab = (tabId: string) => {
    const tabEl = tabRefs.current.get(tabId)
    const scrollEl = scrollRef.current
    if (!tabEl || !scrollEl) return

    const scrollRect = scrollEl.getBoundingClientRect()
    const tabRect = tabEl.getBoundingClientRect()

    const tabLeft = tabRect.left - scrollRect.left + scrollEl.scrollLeft
    const tabRight = tabLeft + tabRect.width

    if (tabLeft < scrollEl.scrollLeft) {
      scrollEl.scrollTo({ left: tabLeft - 4, behavior: 'smooth' })
    } else if (tabRight > scrollEl.scrollLeft + scrollEl.clientWidth) {
      scrollEl.scrollTo({ left: tabRight - scrollEl.clientWidth + 4, behavior: 'smooth' })
    }
  }

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    scrollToTab(tabId)
    // Sync file tree: expand to and select the file
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      if (workspaceMode === 'workspace' && workspaceFolders.length > 0) {
        // Find which workspace folder contains this file
        const folder = workspaceFolders.find(f => tab.path.startsWith(f))
        if (folder) {
          useFileTreeStore.getState().revealPath(tab.path, folder)
        }
      } else if (rootPath) {
        useFileTreeStore.getState().revealPath(tab.path, rootPath)
      }
    }
  }

  if (tabs.length === 0) {
    return (
      <div className="h-10 flex items-center border-b border-[var(--border-color)] bg-[var(--tab-bg)]">
        <span className="px-4 text-sm text-[var(--text-muted)]">No file open</span>
      </div>
    )
  }

  return (
    <div className="h-10 flex items-center border-b border-border bg-[var(--tab-bg)]">
      {/* Left scroll button - only show when overflowing */}
      {isOverflowing && (
        <button
          onClick={() => scroll('left')}
          className={cn(
            "h-full px-2 flex items-center justify-center shrink-0",
            "border-r border-[var(--border-color)]",
            canScrollLeft
              ? "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] cursor-pointer"
              : "text-[var(--border-color)] cursor-not-allowed"
          )}
        >
          <ChevronLeft size={16} />
        </button>
      )}

      {/* Tabs container */}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex-1 flex overflow-x-auto scrollbar-hide"
        style={{
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const tabIndex = tabs.findIndex(t => t.id === tab.id)
          const hasRightTabs = tabIndex < tabs.length - 1
          const hasOtherTabs = tabs.length > 1
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger>
                <div
                  ref={(el) => {
                    if (el) tabRefs.current.set(tab.id, el)
                    else tabRefs.current.delete(tab.id)
                  }}
                  onClick={() => handleTabClick(tab.id)}
                  className={cn(
                    "group relative flex items-center h-10 px-3 cursor-pointer select-none shrink-0",
                    "text-sm border-r border-[var(--tab-border)] min-w-0",
                    "transition-colors duration-75",
                    isActive
                      ? "bg-[var(--tab-active-bg)] text-[var(--text-primary)] shadow-[inset_0_1px_0_var(--tab-activeBorderTop)]"
                      : "bg-transparent text-[var(--text-muted)] hover:bg-[var(--tab-hover-bg)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {/* Status dot - 编辑过才显示圆点 */}
                  {tab.isEdited && (
                    tab.isDirty ? (
                      <span className="w-2 h-2 rounded-full bg-red-500 mr-1.5 shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5 shrink-0" />
                    )
                  )}

                  {/* File icon + name */}
                  <FileText size={14} className="shrink-0 mr-1" />
                  <span className="truncate max-w-[120px]">{tab.name}</span>

                  {/* Close button */}
                  <button
                    onClick={(e) => handleTabClose(e, tab.id)}
                    className={cn(
                      "ml-2 h-4 w-4 flex items-center justify-center rounded-sm shrink-0",
                      "opacity-0 group-hover:opacity-100",
                      "hover:bg-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <X size={12} />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                className="min-w-[180px]"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                }}
              >
                <ContextMenuItem
                  onClick={() => handleClose(tab)}
                  style={{ color: 'var(--text-secondary)' }}
                  className="cursor-pointer"
                >
                  <X size={12} className="mr-2" />
                  <span>关闭</span>
                </ContextMenuItem>
                {hasOtherTabs && (
                  <ContextMenuItem
                    onClick={() => handleCloseOthers(tab)}
                    style={{ color: 'var(--text-secondary)' }}
                    className="cursor-pointer"
                  >
                    <X size={12} className="mr-2" />
                    <span>关闭其他</span>
                  </ContextMenuItem>
                )}
                {hasRightTabs && (
                  <ContextMenuItem
                    onClick={() => handleCloseRight(tab)}
                    style={{ color: 'var(--text-secondary)' }}
                    className="cursor-pointer"
                  >
                    <X size={12} className="mr-2" />
                    <span>关闭右侧标签页</span>
                  </ContextMenuItem>
                )}
                {(hasOtherTabs || hasRightTabs) && (
                  <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
                )}
                <ContextMenuItem
                  onClick={() => handleCopyPath(tab)}
                  style={{ color: 'var(--text-secondary)' }}
                  className="cursor-pointer"
                >
                  <FileText size={12} className="mr-2" />
                  <span>复制路径</span>
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleCopyRelativePath(tab)}
                  style={{ color: 'var(--text-secondary)' }}
                  className="cursor-pointer"
                >
                  <FileText size={12} className="mr-2" />
                  <span>复制相对路径</span>
                </ContextMenuItem>
                <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
                <ContextMenuItem
                  onClick={() => handleShowInFinder(tab)}
                  style={{ color: 'var(--text-secondary)' }}
                  className="cursor-pointer"
                >
                  <FileText size={12} className="mr-2" />
                  <span>在文件资源管理器中显示</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>

      {/* Right scroll button - only show when overflowing */}
      {isOverflowing && (
        <button
          onClick={() => scroll('right')}
          className={cn(
            "h-full px-2 flex items-center justify-center shrink-0",
            "border-l border-[var(--border-color)]",
            canScrollRight
              ? "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] cursor-pointer"
              : "text-[var(--border-color)] cursor-not-allowed"
          )}
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* More button with dropdown - only show when tabs overflow */}
      {isOverflowing && (
        <div className="relative h-full shrink-0" ref={moreMenuRef}>
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className="h-full px-2 flex items-center justify-center border-l border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
          >
            <MoreHorizontal size={16} />
          </button>

        {/* Dropdown menu */}
        {showMoreMenu && (
          <div
            className={cn(
              "absolute top-full right-0 z-50 mt-1",
              "min-w-[180px] max-h-[300px] overflow-y-auto",
              "bg-[var(--bg-secondary)] border border-[var(--border-color)]",
              "shadow-lg rounded-md py-1"
            )}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    handleTabClick(tab.id)
                    setShowMoreMenu(false)
                  }}
                  className={cn(
                    "group flex items-center h-8 px-3 cursor-pointer select-none",
                    "text-sm",
                    isActive
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  )}
                >
                  {/* Status dot */}
                  {tab.isEdited && (
                    tab.isDirty ? (
                      <span className="w-2 h-2 rounded-full bg-red-500 mr-2 shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-green-500 mr-2 shrink-0" />
                    )
                  )}

                  <FileText size={14} className="shrink-0 mr-2" />
                  <span className="truncate max-w-[200px]">{tab.name}</span>

                  {/* Close button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleTabClose(e, tab.id)
                    }}
                    className={cn(
                      "ml-2 h-4 w-4 flex items-center justify-center rounded-sm shrink-0",
                      "opacity-0 group-hover:opacity-100",
                      "hover:bg-[rgba(255,255,255,0.1)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

export { TabBar }
