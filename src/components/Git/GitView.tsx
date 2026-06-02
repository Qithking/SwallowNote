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
  MoreHorizontal,
  ArrowUpFromLine,
  ArrowDownToLine,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useGitStore, GitRepository, mapRepoInfosToRepositories } from '@/stores/git'
import { scanGitRepos, gitCommitAndPush, gitPushWithCredentials, gitForcePushWithCredentials, gitCredentialSave, gitCredentialGet, gitForcePush, gitForcePull } from '@/lib/tauri'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWorkspaceStore, useUIStore, useFileTreeStore, useEditorStore } from '@/stores'
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
  repoPath,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (username: string, password: string) => void
  repoName: string
  repoPath: string
  isLoading: boolean
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saveCredential, setSaveCredential] = useState(true)
  const { t } = useTranslation()

  useEffect(() => {
    if (open) {
      // Try to load saved credentials from keyring
      gitCredentialGet(repoPath).then(cred => {
        if (cred) {
          setUsername(cred.username)
          setPassword(cred.password)
        } else {
          setUsername('')
          setPassword('')
        }
      }).catch(() => {
        setUsername('')
        setPassword('')
      })
      setSaveCredential(true)
    }
  }, [open, repoPath])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (username.trim() && password.trim()) {
      // Save credentials to keyring if checkbox is checked
      if (saveCredential) {
        gitCredentialSave(repoPath, username.trim(), password.trim()).catch(console.error)
      }
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
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="saveCredential"
              checked={saveCredential}
              onChange={(e) => setSaveCredential(e.target.checked)}
              className="rounded border-[var(--border-color)]"
              disabled={isLoading}
            />
            <label htmlFor="saveCredential" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('git.rememberCredential')}
            </label>
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
  onRefresh,
  onStatusUpdate,
}: { 
  selectedRepos: string[]
  allRepos: GitRepository[]
  onRefresh: () => Promise<void>
  onStatusUpdate: (conflictPaths: string[], errorPaths: string[]) => void
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
    const errorDetails: string[] = []
    const conflictPaths: string[] = []
    const errorPaths: string[] = []

    for (const repo of finalRepos) {
      try {
        await gitCommitAndPush(repo.path, commitMessage)
        successCount++
      } catch (e) {
        const errorMessage = String(e).trim()
        console.error('Failed to commit and push:', repo.path, errorMessage)
        if (errorMessage.startsWith('AUTH_REQUIRED:')) {
          // Try to use saved credentials from keyring first
          let pushedWithSavedCred = false
          try {
            const savedCred = await gitCredentialGet(repo.path)
            if (savedCred) {
              try {
                await gitPushWithCredentials(repo.path, savedCred.username, savedCred.password)
                pushedWithSavedCred = true
                successCount++
              } catch {
                // Saved credentials failed, fall through to show dialog
              }
            }
          } catch {
            // Failed to get saved credentials, fall through
          }
          if (!pushedWithSavedCred) {
            // Show credential dialog for manual input
            // Don't count as success or failure since user can retry with credentials
            setCredentialDialog({
              open: true,
              repoPath: repo.path,
              repoName: repo.name,
            })
          }
        } else if (errorMessage.includes('nothing to commit') ||
            errorMessage.includes('working tree clean') ||
            errorMessage.includes('no changes added to commit') ||
            (errorMessage.includes('modified content') && errorMessage.includes('submodule'))) {
          successCount++
        } else if (errorMessage.startsWith('SUBMODULE_UNCOMMITTED:')) {
          successCount++
          errorDetails.push(`${repo.name}: ${t('git.submoduleHasChanges')}`)
          errorPaths.push(repo.path)
        } else if (errorMessage.startsWith('SUBMODULE_REF_NEEDS_UPDATE:')) {
          successCount++
          errorDetails.push(`${repo.name}: ${t('git.submoduleRefNeedsUpdate')}`)
          errorPaths.push(repo.path)
        } else if (errorMessage.startsWith('REBASE_CONFLICT:')) {
          failCount++
          errorDetails.push(`${repo.name}: ${t('git.pullConflict', { repos: repo.name })}`)
          conflictPaths.push(repo.path)
          // Auto-open conflict resolution tab
          useEditorStore.getState().openConflictTab(repo.path, repo.name)
        } else {
          failCount++
          errorDetails.push(`${repo.name}: ${errorMessage || t('git.unknownError')}`)
          errorPaths.push(repo.path)
        }
      }
    }

    setIsCommitting(false)

    await onRefresh()
    
    // Update repository statuses after refresh (refresh resets all to normal)
    if (conflictPaths.length > 0 || errorPaths.length > 0) {
      onStatusUpdate(conflictPaths, errorPaths)
    }
    
    if (failCount === 0) {
      if (successCount > 0 && !credentialDialog.open) {
        showToast(t('git.syncSuccess', { count: successCount }), 'success')
      }
    } else {
      showToast(t('git.syncPartial', { success: successCount, fail: failCount }), 'error')
    }
    // Show collected errors as a single warning toast (max 3 repos shown)
    if (errorDetails.length > 0) {
      const shown = errorDetails.slice(0, 3).join('\n')
      const suffix = errorDetails.length > 3 ? `\n... +${errorDetails.length - 3}` : ''
      showToast(shown + suffix, 'error')
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
        repoPath={credentialDialog.repoPath}
        isLoading={isPushingWithCredentials}
      />
    </>
  )
}

// Repository item with checkbox for multi-select and tooltip
function RepositoryItem({ 
  repo, 
  isSelected, 
  onToggle,
  onRefresh,
}: { 
  repo: GitRepository
  isSelected: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useUIStore()
  const [isForceAction, setIsForceAction] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'forcePush' | 'forcePull' | null>(null)

  const handleClick = () => {
    if (repo.status === 'conflict') {
      // Open conflict resolution tab for this repo
      useEditorStore.getState().openConflictTab(repo.path, repo.name)
    } else {
      onToggle()
    }
  }

  const handleForcePush = async () => {
    setIsForceAction(true)
    setConfirmAction(null)
    try {
      await gitForcePush(repo.path)
      showToast(t('git.forcePushSuccess', { repo: repo.name }), 'success')
      onRefresh()
    } catch (e) {
      const errorMessage = String(e).trim()
      if (errorMessage.startsWith('AUTH_REQUIRED:')) {
        // Try saved credentials
        try {
          const savedCred = await gitCredentialGet(repo.path)
          if (savedCred) {
            try {
              // Force push with credentials
              await gitForcePushWithCredentials(repo.path, savedCred.username, savedCred.password)
              showToast(t('git.forcePushSuccess', { repo: repo.name }), 'success')
              onRefresh()
              return
            } catch {
              // Saved credentials failed
            }
          }
        } catch {
          // Failed to get credentials
        }
        showToast(t('git.forcePushFailed', { repo: repo.name, error: t('git.credentialTitle') }), 'error')
      } else {
        showToast(t('git.forcePushFailed', { repo: repo.name, error: errorMessage || t('git.unknownError') }), 'error')
      }
    } finally {
      setIsForceAction(false)
    }
  }

  const handleForcePull = async () => {
    setIsForceAction(true)
    setConfirmAction(null)
    try {
      await gitForcePull(repo.path)
      showToast(t('git.forcePullSuccess', { repo: repo.name }), 'success')
      onRefresh()
    } catch (e) {
      const errorMessage = String(e).trim()
      showToast(t('git.forcePullFailed', { repo: repo.name, error: errorMessage || t('git.unknownError') }), 'error')
    } finally {
      setIsForceAction(false)
    }
  }

  return (
    <>
      {/* Confirm Dialog for force actions */}
      <Dialog open={confirmAction !== null} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{confirmAction === 'forcePush' ? t('git.forcePush') : t('git.forcePull')}</DialogTitle>
            <DialogDescription>
              {confirmAction === 'forcePush'
                ? t('git.forcePushConfirm', { repo: repo.name })
                : t('git.forcePullConfirm', { repo: repo.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={isForceAction}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isForceAction}
              onClick={confirmAction === 'forcePush' ? handleForcePush : handleForcePull}
            >
              {isForceAction && <Loader2 size={12} className="animate-spin mr-1" />}
              {confirmAction === 'forcePush' ? t('git.forcePush') : t('git.forcePull')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          'group p-2 rounded cursor-pointer text-sm flex flex-col gap-1',
          'hover:bg-[var(--bg-hover)]',
          isSelected && 'bg-[var(--bg-hover)]',
          repo.isSubmodule && 'pl-8 ml-4 border-l-2 border-[var(--border-color)]'
        )}
        onClick={handleClick}
        title={[repo.path, repo.isSubmodule && repo.parentPath ? `${t('git.parentRepo')}: ${repo.parentPath}` : '', repo.hasUncommittedChanges ? `${t('git.pendingFiles')}: ${repo.uncommittedCount} ${t('git.files')}` : '', repo.status === 'conflict' ? t('git.conflictTitle') : ''].filter(Boolean).join('\n')}
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
          {/* Status dot: red for error, yellow for conflict, orange for uncommitted, green for clean */}
          <div className="relative">
            {repo.status === 'conflict' ? (
              <Circle size={8} className="fill-yellow-500 text-yellow-500" />
            ) : repo.status === 'error' ? (
              <Circle size={8} className="fill-red-500 text-red-500" />
            ) : repo.hasUncommittedChanges ? (
              <Circle size={8} className="fill-orange-500 text-orange-500" />
            ) : (
              <Circle size={8} className="fill-green-500 text-green-500" />
            )}
          </div>
          {/* Submodule indicator */}
          {repo.isSubmodule && (
            <span className="text-xs px-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{t('git.submodule')}</span>
          )}
          <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
          {/* Action menu - outside Tooltip to avoid portal conflicts */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity hover:bg-[var(--bg-hover)]"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <DropdownMenuItem
                className="text-xs cursor-pointer gap-2"
                style={{ color: 'var(--text-primary)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmAction('forcePush')
                }}
                disabled={!repo.remoteUrl}
              >
                <ArrowUpFromLine size={12} style={{ color: 'var(--text-muted)' }} />
                <div className="flex flex-col">
                  <span>{t('git.forcePush')}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('git.forcePushDesc')}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs cursor-pointer gap-2"
                style={{ color: 'var(--text-primary)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmAction('forcePull')
                }}
                disabled={!repo.remoteUrl}
              >
                <ArrowDownToLine size={12} style={{ color: 'var(--text-muted)' }} />
                <div className="flex flex-col">
                  <span>{t('git.forcePull')}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('git.forcePullDesc')}</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        {/* Git remote URL */}
        <div className="text-xs pl-7" style={{ color: 'var(--text-muted)' }}>
          {repo.remoteUrl || t('git.noRemote')}
        </div>
      </div>
    </>
  )
}

function GitView() {
  const { repositories, setRepositories, setCachedRepositories, scanProgress, pullAllRepos, updateRepositoryStatuses, resetRepositoryStatuses } = useGitStore()
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode, showToast } = useUIStore()
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [isPullingRepos, setIsPullingRepos] = useState(false)
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

  const handlePull = async () => {
    if (repositories.length === 0) return

    const reposToPull = selectedRepos.length > 0
      ? repositories.filter(r => selectedRepos.includes(r.path))
      : repositories

    const reposWithRemote = reposToPull.filter(r => r.remoteUrl)
    if (reposWithRemote.length === 0) {
      showToast(t('git.noReposToSync'), 'info')
      return
    }

    setIsPullingRepos(true)
    // Reset statuses before pulling
    resetRepositoryStatuses()
    const gitStore = useGitStore.getState()
    gitStore.setSyncStatus({ isSyncing: true })

    try {
      const results = await pullAllRepos(reposWithRemote)
      const succeeded = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success && !r.isConflict).length
      const conflicted = results.filter(r => r.isConflict).length

      // Update repository statuses based on pull results
      updateRepositoryStatuses(results)

      gitStore.setSyncStatus({
        isSyncing: false,
        lastSyncTime: Date.now(),
        succeeded,
        failed,
        conflicted,
      })

      if (succeeded > 0 || conflicted > 0) {
        const fileTreeStore = useFileTreeStore.getState()
        fileTreeStore.refreshExpanded()
      }

      // Consolidate toast messages: show one summary toast instead of per-repo toasts
      if (conflicted > 0) {
        const conflictNames = results.filter(r => r.isConflict).map(r => r.name).join(', ')
        showToast(t('git.pullConflict', { repos: conflictNames }), 'error')
        
        // Auto-open conflict resolution tabs for conflicted repos
        const editorStore = useEditorStore.getState()
        for (const result of results) {
          if (result.isConflict) {
            editorStore.openConflictTab(result.path, result.name)
          }
        }
      } else if (failed > 0) {
        showToast(t('git.pullResult', { success: succeeded, fail: failed }), 'error')
      } else if (succeeded > 0) {
        showToast(t('git.pullSuccess', { count: succeeded }), 'success')
      }
    } catch (e) {
      console.error('Pull failed:', e)
      gitStore.setSyncStatus({ isSyncing: false })
    } finally {
      setIsPullingRepos(false)
    }
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePull} disabled={isPullingRepos || repositories.length === 0}>
                {isPullingRepos ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{selectedRepos.length > 0 ? t('git.pullSelected') : t('git.pull')}</TooltipContent>
          </Tooltip>
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
        onStatusUpdate={(conflictPaths, errorPaths) => {
          // Update repository statuses based on commit+push results
          const { updateRepositoryStatuses: updateStatuses } = useGitStore.getState()
          const pullResults = [
            ...conflictPaths.map(p => ({ path: p, name: '', success: false, isConflict: true })),
            ...errorPaths.map(p => ({ path: p, name: '', success: false, isConflict: false })),
          ]
          updateStatuses(pullResults)
        }}
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
                onRefresh={handleRefresh}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export { GitView }
