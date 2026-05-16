import { FolderOpen, ChevronDown, ChevronUp, Check, MoreHorizontal, Trash2, AlertCircle } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUIStore, useWorkspaceStore } from '@/stores'
import { getFolderHistory, openFolderDialog, pathExists, clearOtherFolderHistory, removeFolderHistory } from '@/lib/tauri'
import { useState, useEffect, useRef } from 'react'

interface RecentItem {
  path: string
  name: string
  isWorkspace: boolean
}

function getInitialAndColor(path: string): { initial: string; color: string } {
  const name = path.split('/').pop() || path
  const displayName = name.replace('.swallow-workspace', '')
  const initial = displayName.charAt(0).toUpperCase()
  const colors = [
    'bg-green-500', 'bg-gray-500', 'bg-purple-500', 'bg-blue-500',
    'bg-orange-500', 'bg-teal-500', 'bg-pink-500', 'bg-indigo-500',
  ]
  const colorIndex = initial.charCodeAt(0) % colors.length
  return { initial, color: colors[colorIndex] }
}

export function TitleBarRecentPopover() {
  const { workspaceMode } = useUIStore()
  const { rootPath, currentWorkspacePath, openFolder, loadWorkspaceFile, switchMode } = useWorkspaceStore()
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const displayName = (() => {
    if (workspaceMode === 'workspace' && currentWorkspacePath) {
      return currentWorkspacePath.split('/').pop()?.replace('.swallow-workspace', '') || '工作区'
    }
    if (workspaceMode === 'folder' && rootPath) {
      return rootPath.split('/').pop() || '文件夹'
    }
    return '最近记录'
  })()

  const currentPath = workspaceMode === 'workspace' ? currentWorkspacePath : rootPath

  const loadHistory = async () => {
    try {
      const paths = await getFolderHistory()
      const filtered = paths.filter(p => {
        const isWorkspace = p.endsWith('.swallow-workspace')
        return workspaceMode === 'workspace' ? isWorkspace : !isWorkspace
      })
      const items: RecentItem[] = filtered.map(path => ({
        path,
        name: path.split('/').pop() || path,
        isWorkspace: path.endsWith('.swallow-workspace'),
      }))
      setRecentItems(items)
    } catch (e) {
      console.error('Failed to load history:', e)
    }
  }

  useEffect(() => {
    if (isOpen) loadHistory()
  }, [isOpen, workspaceMode])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleOpenFolder = async () => {
    setIsOpen(false)
    const path = await openFolderDialog()
    if (path) {
      await openFolder(path)
    }
  }

  const handleItemClick = async (item: RecentItem) => {
    setIsOpen(false)
    const exists = await pathExists(item.path)
    if (!exists) {
      const { showToast } = useUIStore.getState()
      showToast(`路径不存在: ${item.path}`, 'error')
      return
    }

    if (item.isWorkspace) {
      if (workspaceMode !== 'workspace') {
        switchMode('workspace')
      }
      await loadWorkspaceFile(item.path)
    } else {
      if (workspaceMode !== 'folder') {
        switchMode('folder')
      }
      await openFolder(item.path)
    }
  }

  const handleClearHistory = async () => {
    try {
      await clearOtherFolderHistory(currentPath)
      await loadHistory()
      setShowClearConfirm(false)
    } catch (e) {
      console.error('Failed to clear history:', e)
    }
  }

  const handleDeleteItem = async (path: string) => {
    try {
      await removeFolderHistory(path)
      await loadHistory()
    } catch (e) {
      console.error('Failed to delete item:', e)
    }
  }

  const isCurrentItem = (path: string) => {
    return currentPath === path
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="h-6 px-2 gap-1 text-xs font-normal max-w-[200px] hover:no-underline focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{ color: isOpen ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        <span className="truncate">{displayName}</span>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </Button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-72 rounded-lg shadow-lg z-50 overflow-hidden"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          <div className="py-1">
            <button
              onClick={handleOpenFolder}
              className="w-full flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <FolderOpen size={14} />
              <span>打开文件夹</span>
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="w-full flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <AlertCircle size={14} />
              <span>清空历史</span>
            </button>
          </div>

          <Separator />

          <div className="py-1 max-h-64 overflow-y-auto">
            <div className="px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              最近
            </div>
            {recentItems.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                暂无历史记录
              </div>
            ) : (
              recentItems.map((item) => {
                const { initial, color } = getInitialAndColor(item.path)
                const displayName = item.name.replace('.swallow-workspace', '')
                const dirPath = item.path.split('/').slice(0, -1).join('/')
                const isCurrent = isCurrentItem(item.path)
                return (
                  <div
                    key={item.path}
                    className="w-full flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)]"
                    onClick={() => !isCurrent && handleItemClick(item)}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center text-white text-xs font-medium shrink-0 mt-0.5 ${color}`}>
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {displayName}
                      </div>
                      <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                        {dirPath}
                      </div>
                    </div>
                    {isCurrent ? (
                      <Check size={14} className="text-green-500 shrink-0 mt-1" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-[var(--bg-hover)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal size={14} style={{ color: 'var(--text-muted)' }} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem
                            className="text-red-500 cursor-pointer"
                            onClick={() => handleDeleteItem(item.path)}
                          >
                            <Trash2 size={14} className="mr-2" />
                            <span>删除</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {showClearConfirm && (
            <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
              <div className="w-64 rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>确认清空历史</div>
                <div className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                  确定要清空所有历史记录吗？（当前打开的记录将保留）
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-1.5 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleClearHistory}
                    className="px-3 py-1.5 text-xs rounded cursor-pointer bg-red-500 text-white hover:bg-red-600"
                  >
                    确认
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
