/**
 * GitView Component - Git integration panel with multi-repository support
 */
import { useState, useEffect } from 'react'
import {
  GitBranch,
  RefreshCw,
  Circle,
  Check,
  Loader2,
  KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useGitStore, GitRepository, mapRepoInfosToRepositories } from '@/stores/git'
import { scanGitRepos, gitCommitAndPush, gitPushWithCredentials } from '@/lib/tauri'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWorkspaceStore, useUIStore } from '@/stores'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

// Credential input dialog for git push authentication
function CredentialDialog({
  open,
  onClose,
  onSubmit,
  repoName,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (username: string, password: string) => void
  repoName: string
  isLoading: boolean
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { t } = useTranslation()

  useEffect(() => {
    if (open) {
      setUsername('')
      setPassword('')
    }
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (username.trim() && password.trim()) {
      onSubmit(username.trim(), password.trim())
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} />
            {t('git.credentialTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('git.credentialDesc', { repo: repoName })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('git.username')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('git.usernamePlaceholder')}
              autoFocus
              className="flex h-9 w-full rounded-md border px-3 py-2 text-sm bg-[var(--bg-primary)] border-[var(--border-color)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              disabled={isLoading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('git.passwordOrToken')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('git.passwordPlaceholder')}
              className="flex h-9 w-full rounded-md border px-3 py-2 text-sm bg-[var(--bg-primary)] border-[var(--border-color)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              disabled={isLoading}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isLoading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!username.trim() || !password.trim() || isLoading}
            >
              {isLoading && <Loader2 size={12} className="animate-spin mr-1" />}
              {t('git.pushWithCredential')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Commit section with vertical layout
function CommitSection({ 
  selectedRepos, 
  allRepos, 
  onRefresh 
}: { 
  selectedRepos: string[]
  allRepos: GitRepository[]
  onRefresh: () => void
}) {
  const [isCommitting, setIsCommitting] = useState(false)
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean
    repoPath: string
    repoName: string
  }>({ open: false, repoPath: '', repoName: '' })
  const [isPushingWithCredentials, setIsPushingWithCredentials] = useState(false)
  const { showToast } = useUIStore()
  const { t } = useTranslation()

  const handlePushWithCredentials = async (username: string, password: string) => {
    setIsPushingWithCredentials(true)
    try {
      await gitPushWithCredentials(credentialDialog.repoPath, username, password)
      setCredentialDialog({ open: false, repoPath: '', repoName: '' })
      showToast(`${credentialDialog.repoName}: ${t('git.syncSuccess', { count: 1 })}`, 'success')
      onRefresh()
    } catch (e) {
      const errorMessage = String(e).trim()
      showToast(`${credentialDialog.repoName}: ${errorMessage || t('git.unknownError')}`, 'error')
    } finally {
      setIsPushingWithCredentials(false)
    }
  }

  const handleCommit = async () => {
    const commitMessage = 'Sync changes'

    const reposToCommit = selectedRepos.length > 0
      ? allRepos.filter(r => selectedRepos.includes(r.path))
      : allRepos.filter(r => r.hasUncommittedChanges)

    if (reposToCommit.length === 0) {
      showToast(t('git.noReposToSync'), 'info')
      return
    }

    const reposWithChanges = reposToCommit.filter(r => r.hasUncommittedChanges)
    if (reposWithChanges.length === 0 && selectedRepos.length === 0) {
      showToast(t('git.noChangesToSync'), 'info')
      return
    }
    
    const finalRepos = reposWithChanges.length > 0 ? reposWithChanges : reposToCommit

    setIsCommitting(true)
    let successCount = 0
    let failCount = 0

    for (const repo of finalRepos) {
      try {
        await gitCommitAndPush(repo.path, commitMessage)
        successCount++
      } catch (e) {
        const errorMessage = String(e).trim()
        console.error('Failed to commit and push:', repo.path, errorMessage)
        if (errorMessage.startsWith('AUTH_REQUIRED:')) {
          // Authentication failed - show credential dialog
          setCredentialDialog({
            open: true,
            repoPath: repo.path,
            repoName: repo.name,
          })
          // Don't count as failure since user can retry with credentials
          successCount++
        } else if (errorMessage.includes('没有需要提交的变更') || 
            errorMessage.includes('nothing to commit') ||
            errorMessage.includes('working tree clean') ||
            errorMessage.includes('no changes added to commit') ||
            (errorMessage.includes('modified content') && errorMessage.includes('submodule'))) {
          successCount++
        } else if (errorMessage.includes('子模块内部有未提交的变更')) {
          successCount++
          showToast(`${repo.name}: ${t('git.submoduleHasChanges')}`, 'error')
        } else if (errorMessage.includes('子模块引用需要更新')) {
          successCount++
          showToast(`${repo.name}: ${t('git.submoduleRefNeedsUpdate')}`, 'error')
        } else {
          failCount++
          showToast(`${repo.name}: ${errorMessage || t('git.unknownError')}`, 'error')
        }
      }
    }

    setIsCommitting(false)

    onRefresh()
    
    if (failCount === 0) {
      if (successCount > 0 && !credentialDialog.open) {
        showToast(t('git.syncSuccess', { count: successCount }), 'success')
      }
    } else {
      showToast(t('git.syncPartial', { success: successCount, fail: failCount }), 'error')
    }
  }
  
  return (
    <>
      <div className="p-2" style={{ borderColor: 'var(--border-color)' }}>
        <Button
          className="w-full h-8 text-xs"
          variant="default"
          onClick={handleCommit}
          disabled={isCommitting}
        >
          {isCommitting && <Loader2 size={12} className="animate-spin" />}
          {isCommitting ? t('git.syncing') : t('git.sync')}
        </Button>
      </div>
      <CredentialDialog
        open={credentialDialog.open}
        onClose={() => setCredentialDialog({ open: false, repoPath: '', repoName: '' })}
        onSubmit={handlePushWithCredentials}
        repoName={credentialDialog.repoName}
        isLoading={isPushingWithCredentials}
      />
    </>
  )
}

// Repository item with checkbox for multi-select and tooltip
function RepositoryItem({ 
  repo, 
  isSelected, 
  onToggle 
}: { 
  repo: GitRepository
  isSelected: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'p-2 rounded cursor-pointer text-sm flex flex-col gap-1',
            'hover:bg-[var(--bg-hover)]',
            isSelected && 'bg-[var(--bg-hover)]',
            repo.isSubmodule && 'pl-8 ml-4 border-l-2 border-[var(--border-color)]'
          )}
          onClick={onToggle}
        >
          {/* Repo name with status indicator and checkbox */}
          <div className="flex items-center gap-2">
            {/* Checkbox */}
            <div 
              className={cn(
                'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                isSelected 
                  ? 'bg-[var(--accent)] border-[var(--accent)]' 
                  : 'border-[var(--border-color)]'
              )}
            >
              {isSelected && <Check size={10} className="text-[var(--text-primary)]" />}
            </div>
            {/* Status dot: red for uncommitted, green for clean */}
            <div className="relative">
              {repo.hasUncommittedChanges ? (
                <Circle size={8} className="fill-red-500 text-red-500" />
              ) : (
                <Circle size={8} className="fill-green-500 text-green-500" />
              )}
            </div>
            {/* Submodule indicator */}
            {repo.isSubmodule && (
              <span className="text-xs px-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{t('git.submodule')}</span>
            )}
            <span style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
          </div>
          
          {/* Git remote URL */}
          <div className="text-xs pl-7" style={{ color: 'var(--text-muted)' }}>
            {repo.remoteUrl || t('git.noRemote')}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[300px]">
        <div className="space-y-1">
          <div><span className="font-medium">{t('git.repoPath')}:</span> {repo.path}</div>
          {repo.isSubmodule && repo.parentPath && (
            <div><span className="font-medium">{t('git.parentRepo')}:</span> {repo.parentPath}</div>
          )}
          {repo.hasUncommittedChanges && (
            <div><span className="font-medium">{t('git.pendingFiles')}:</span> {repo.uncommittedCount} {t('git.files')}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function GitView() {
  const { repositories, setRepositories, setCachedRepositories, scanProgress } = useGitStore()
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode } = useUIStore()
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const { t } = useTranslation()

  useEffect(() => {
    setSelectedRepos([])

    const currentCached = useGitStore.getState().cachedRepositories
    if (currentCached.length > 0) {
      setRepositories(currentCached)
    }

    const loadRepos = async () => {
      const scanPaths = workspaceMode === 'workspace'
        ? (workspaceFolders || [])
        : (rootPath ? [rootPath] : [])

      if (scanPaths.length === 0) {
        setRepositories([])
        return
      }

      try {
        const scanPromises = scanPaths.map(async (path) => {
          try {
            return await scanGitRepos(path)
          } catch (e) {
            console.error(`Failed to scan git repos in ${path}:`, e)
            return []
          }
        })

        const results = await Promise.all(scanPromises)
        const allRepos = results.flat()

        const storeRepos = mapRepoInfosToRepositories(allRepos)
        setRepositories(storeRepos)
        setCachedRepositories(storeRepos)
      } catch (e) {
        console.error('Failed to scan git repos:', e)
        const latestCached = useGitStore.getState().cachedRepositories
        if (latestCached.length === 0) {
          setRepositories([])
        }
      }
    }

    loadRepos()
  }, [rootPath, workspaceFolders, workspaceMode, setRepositories, setCachedRepositories])

  const toggleRepo = (path: string) => {
    setSelectedRepos(prev => 
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    )
  }

  const handleRefresh = async () => {
    const scanPaths = workspaceMode === 'workspace'
      ? (workspaceFolders || [])
      : (rootPath ? [rootPath] : [])

    setRepositories([])
    setSelectedRepos([])

    if (scanPaths.length === 0) return

    try {
      const scanPromises = scanPaths.map(async (path) => {
        try {
          return await scanGitRepos(path)
        } catch (e) {
          console.error(`Failed to scan git repos in ${path}:`, e)
          return []
        }
      })

      const results = await Promise.all(scanPromises)
      const allRepos = results.flat()

      const storeRepos = mapRepoInfosToRepositories(allRepos)
      setRepositories(storeRepos)
      setCachedRepositories(storeRepos)
    } catch (e) {
      console.error('Failed to refresh repos:', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium uppercase tracking-wider">{t('git.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh}>
                <RefreshCw size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('git.refresh')}</TooltipContent>
          </Tooltip>          
        </div>
      </div>

      {/* Commit Message Input and Sync Button */}
      <CommitSection 
        selectedRepos={selectedRepos}
        allRepos={repositories}
        onRefresh={handleRefresh}
      />

      {/* Scan Progress */}
      {scanProgress && (
        <div className="px-3 py-2">
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            {scanProgress.message} ({scanProgress.current}/{scanProgress.total})
          </div>
          <Progress value={(scanProgress.current / scanProgress.total) * 100} className="h-1" />
        </div>
      )}

      {/* Repositories List */}
      <ScrollArea className="flex-1 p-2">
        {repositories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <GitBranch size={32} className="mb-3 opacity-50" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>{t('git.noGitRepos')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {repositories.map((repo) => (
              <RepositoryItem 
                key={repo.path} 
                repo={repo}
                isSelected={selectedRepos.includes(repo.path)}
                onToggle={() => toggleRepo(repo.path)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export { GitView }
