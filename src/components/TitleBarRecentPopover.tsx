import { FolderOpen, ChevronDown, ChevronUp, Check, MoreHorizontal, Trash2, AlertCircle, GitBranch, FolderPlus, Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUIStore, useWorkspaceStore } from '@/stores'
import { getFolderHistory, openFolderDialog, pathExists, clearOtherFolderHistory, removeFolderHistory, gitClone } from '@/lib/tauri'
import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'

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
  const { rootPath, currentWorkspacePath, openFolder, loadWorkspaceFile, switchMode, addWorkspaceFolder } = useWorkspaceStore()
  const { t } = useTranslation()
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showCloneDialog, setShowCloneDialog] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneLocalPath, setCloneLocalPath] = useState('')
  const [isCloning, setIsCloning] = useState(false)
  const [cloneProgress, setCloneProgress] = useState('')
  const [cloneError, setCloneError] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  const displayName = (() => {
    if (workspaceMode === 'workspace' && currentWorkspacePath) {
      return currentWorkspacePath.split('/').pop()?.replace('.swallow-workspace', '') || t('recent.workspace')
    }
    if (workspaceMode === 'folder' && rootPath) {
      return rootPath.split('/').pop() || t('recent.folder')
    }
    return t('recent.title')
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

  useEffect(() => {
    if (!showCloneDialog) return

    let unlisten: (() => void) | undefined

    const setupListener = async () => {
      unlisten = await listen('git-clone-progress', (event) => {
        const payload = event.payload as { status: string; message: string }
        if (payload.status === 'progress') {
          setCloneProgress(payload.message)
          setCloneError('')
        } else if (payload.status === 'completed') {
          setCloneProgress('克隆完成')
        } else if (payload.status === 'error') {
          setCloneError(payload.message)
        } else if (payload.status === 'started') {
          setCloneProgress(payload.message)
          setCloneError('')
        }
      })
    }

    setupListener()

    return () => {
      if (unlisten) unlisten()
    }
  }, [showCloneDialog])

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
      showToast(t('recent.pathNotFound', { path: item.path }), 'error')
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

  const handleOpenCloneDialog = () => {
    setIsOpen(false)
    setShowCloneDialog(true)
    setCloneUrl('')
    setCloneLocalPath('')
    setCloneProgress('')
    setCloneError('')
  }

  const handleSelectClonePath = async () => {
    const path = await openFolderDialog()
    if (path) {
      setCloneLocalPath(path)
    }
  }

  const handleClone = async () => {
    if (!cloneUrl.trim()) {
      const { showToast } = useUIStore.getState()
      showToast(t('recent.enterRepoUrl'), 'error')
      return
    }
    if (!cloneLocalPath.trim()) {
      const { showToast } = useUIStore.getState()
      showToast(t('recent.selectLocalPath'), 'error')
      return
    }

    setIsCloning(true)
    try {
      const clonedPath = await gitClone(cloneUrl.trim(), cloneLocalPath.trim())
      setShowCloneDialog(false)
      setCloneUrl('')
      setCloneLocalPath('')

      if (workspaceMode === 'workspace') {
        await addWorkspaceFolder(clonedPath)
      } else {
        await openFolder(clonedPath)
      }
    } catch (e: any) {
      const { showToast } = useUIStore.getState()
      showToast(t('recent.cloneFailed', { error: e }), 'error')
    } finally {
      setIsCloning(false)
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
              <span>{t('recent.openFolder')}</span>
            </button>
            <button
              onClick={handleOpenCloneDialog}
              className="w-full flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <GitBranch size={14} />
              <span>{t('recent.cloneGitRepo')}</span>
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="w-full flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <AlertCircle size={14} />
              <span>{t('recent.clearHistory')}</span>
            </button>
          </div>

          <Separator />

          <div className="py-1 max-h-64 overflow-y-auto">
            <div className="px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('recent.recent')}
            </div>
            {recentItems.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                {t('recent.noHistory')}
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
                            <span>{t('common.delete')}</span>
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
                <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{t('dialog.confirmClearHistoryTitle')}</div>
                <div className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                  {t('dialog.confirmClearHistory')}
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-1.5 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleClearHistory}
                    className="px-3 py-1.5 text-xs rounded cursor-pointer bg-red-500 text-white hover:bg-red-600"
                  >
                    {t('common.confirm')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showCloneDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-80 rounded-lg p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>{t('recent.cloneGitRepo')}</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('recent.repoUrl')}</label>
                <input
                  type="text"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full px-2 py-1.5 text-xs rounded"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  disabled={isCloning}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('recent.localPath')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cloneLocalPath}
                    onChange={(e) => setCloneLocalPath(e.target.value)}
                    placeholder="/path/to/local"
                    className="flex-1 px-2 py-1.5 text-xs rounded"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                    disabled={isCloning}
                  />
                  <button
                    onClick={handleSelectClonePath}
                    className="px-2 py-1.5 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                    disabled={isCloning}
                  >
                    <FolderPlus size={12} />
                  </button>
                </div>
              </div>
              {(cloneProgress || cloneError) && (
                <div className="mt-2 p-2 rounded text-xs max-h-20 overflow-y-auto" style={{
                  background: cloneError ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-tertiary)',
                  color: cloneError ? 'var(--danger-color, #ef4444)' : 'var(--text-secondary)',
                  border: `1px solid ${cloneError ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)'}`
                }}>
                  {cloneError || cloneProgress}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => {
                  setShowCloneDialog(false)
                  setCloneProgress('')
                  setCloneError('')
                }}
                className="px-3 py-1.5 text-xs rounded cursor-pointer hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-primary)' }}
                disabled={isCloning}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleClone}
                className="px-3 py-1.5 text-xs rounded cursor-pointer bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-1"
                disabled={isCloning}
              >
                {isCloning && <Loader2 size={12} className="animate-spin" />}
                {isCloning ? t('recent.cloning') : t('recent.cloneAndOpen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
