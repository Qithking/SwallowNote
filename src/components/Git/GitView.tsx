/**
 * GitView Component - Git integration panel with multi-repository support
 */
import { useState, useEffect, memo, useRef } from 'react'
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
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useGitStore, GitRepository, PullResult } from '@/stores/git'
import { gitCommitAndPush, gitPushWithCredentials, gitPullWithCredentials, gitForcePushWithCredentials, gitForcePullWithCredentials, gitCredentialSave, gitCredentialGet, gitCredentialDelete, gitForcePush, gitForcePull } from '@/lib/tauri'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWorkspaceStore, useUIStore, useFileTreeStore, useEditorStore } from '@/stores'
import type { GitState } from '@/stores/git'
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

// Credential input dialog for git push authentication
function CredentialDialog({
  open,
  onClose,
  onSubmit,
  repoName,
  repoPath,
  isLoading,
  actionLabel,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (username: string, password: string) => void
  repoName: string
  repoPath: string
  isLoading: boolean
  actionLabel?: string
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
              {actionLabel || t('git.pushWithCredential')}
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
  const [commitMessage, setCommitMessage] = useState('Sync changes')
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean
    repoPath: string
    repoName: string
  }>({ open: false, repoPath: '', repoName: '' })
  const [isPushingWithCredentials, setIsPushingWithCredentials] = useState(false)
  const showToast = useUIStore((s) => s.showToast)
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
        // G-02 修复：后端返回 CommitPushResult，让前端区分"无改动"/"已提交"/"已推送"。
        // 无改动且未推送时仍然计入 success（静默跳过，不显示"提交成功"误导）。
        await gitCommitAndPush(repo.path, commitMessage)
        successCount++
      } catch (e) {
        const errorMessage = String(e).trim()
        console.error('Failed to commit and push:', repo.path, errorMessage)
        // G-06 修复：detached HEAD 返回特定错误码，提示用户手动处理
        if (errorMessage.startsWith('DETACHED_HEAD:')) {
          failCount++
          errorDetails.push(`${repo.name}: ${t('git.detachedHead', { defaultValue: '仓库处于 detached HEAD 状态，请先切换到分支再提交' })}`)
          errorPaths.push(repo.path)
        } else if (errorMessage.startsWith('AUTH_REQUIRED:')) {
          // Try to use saved credentials from keyring first
          let pushedWithSavedCred = false
          try {
            const savedCred = await gitCredentialGet(repo.path)
            if (savedCred) {
              try {
                // gitCommitAndPush 内部 pull 阶段也可能因认证失败返回 AUTH_REQUIRED，
                // 仅调 gitPushWithCredentials 会跳过 pull，导致远端新提交未集成。
                // 先 pull 再 push，pull 已成功时为 no-op。
                await gitPullWithCredentials(repo.path, savedCred.username, savedCred.password)
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
          // Do NOT auto-open conflict tab — user must click conflict icon or repo to open
        } else if (errorMessage.startsWith('REBASE_CONTINUE_FAILED:') || errorMessage.startsWith('MERGE_COMMIT_FAILED:')) {
          // G-04 修复：rebase --continue 或 merge commit 失败，仓库仍处于冲突状态
          failCount++
          errorDetails.push(`${repo.name}: ${t('git.conflictResolveFailed', { defaultValue: '冲突解决失败，请手动处理', error: errorMessage })}`)
          conflictPaths.push(repo.path)
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

    // Sync conflict repos to database for persistence (same as handlePull)
    if (conflictPaths.length > 0) {
      const gitStore = useGitStore.getState()
      const conflictPullResults: PullResult[] = conflictPaths.map(p => ({
        path: p,
        name: allRepos.find(r => r.path === p)?.name || '',
        success: false,
        isConflict: true,
      }))
      await gitStore.syncConflictReposFromPullResults(conflictPullResults)
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
      <div className="p-2 flex flex-col gap-1.5" style={{ borderColor: 'var(--border-color)' }}>
        <input
          type="text"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Sync changes"
          className="flex h-8 w-full rounded-md border px-2.5 py-1 text-xs bg-[var(--bg-primary)] border-[var(--border-color)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          disabled={isCommitting}
        />
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
  const showToast = useUIStore((s) => s.showToast)
  const [isForceAction, setIsForceAction] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'forcePush' | 'forcePull' | null>(null)
  const [showForgetCredential, setShowForgetCredential] = useState(false)
  const [isForgettingCredential, setIsForgettingCredential] = useState(false)
  // 凭证对话框状态：强制推送/拉取认证失败时弹出
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean
    action: 'forcePush' | 'forcePull'
  }>({ open: false, action: 'forcePush' })
  const [isCredentialLoading, setIsCredentialLoading] = useState(false)

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
      await onRefresh()
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
        // 保存凭证也失败，弹出凭证对话框让用户手动输入
        setCredentialDialog({ open: true, action: 'forcePush' })
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
      await onRefresh()
    } catch (e) {
      const errorMessage = String(e).trim()
      if (errorMessage.startsWith('AUTH_REQUIRED:')) {
        // Try saved credentials
        try {
          const savedCred = await gitCredentialGet(repo.path)
          if (savedCred) {
            try {
              await gitForcePullWithCredentials(repo.path, savedCred.username, savedCred.password)
              showToast(t('git.forcePullSuccess', { repo: repo.name }), 'success')
              onRefresh()
              return
            } catch {
              // Saved credentials failed
            }
          }
        } catch {
          // Failed to get credentials
        }
        // 保存凭证也失败，弹出凭证对话框让用户手动输入
        setCredentialDialog({ open: true, action: 'forcePull' })
      } else {
        showToast(t('git.forcePullFailed', { repo: repo.name, error: errorMessage || t('git.unknownError') }), 'error')
      }
    } finally {
      setIsForceAction(false)
    }
  }

  // 凭证对话框提交处理
  const handleCredentialSubmit = async (username: string, password: string) => {
    setIsCredentialLoading(true)
    try {
      if (credentialDialog.action === 'forcePush') {
        await gitForcePushWithCredentials(repo.path, username, password)
        showToast(t('git.forcePushSuccess', { repo: repo.name }), 'success')
      } else {
        await gitForcePullWithCredentials(repo.path, username, password)
        showToast(t('git.forcePullSuccess', { repo: repo.name }), 'success')
      }
      setCredentialDialog({ open: false, action: 'forcePush' })
      await onRefresh()
    } catch (e) {
      const errorMessage = String(e).trim()
      showToast(
        credentialDialog.action === 'forcePush'
          ? t('git.forcePushFailed', { repo: repo.name, error: errorMessage || t('git.unknownError') })
          : t('git.forcePullFailed', { repo: repo.name, error: errorMessage || t('git.unknownError') }),
        'error'
      )
    } finally {
      setIsCredentialLoading(false)
    }
  }

  // 清除已保存的凭证
  const handleForgetCredential = async () => {
    setIsForgettingCredential(true)
    try {
      await gitCredentialDelete(repo.path)
      showToast(t('git.forgetCredentialSuccess'), 'success')
      setShowForgetCredential(false)
    } catch (e) {
      const errorMessage = String(e).trim()
      showToast(t('git.forgetCredentialFailed', { error: errorMessage || t('git.unknownError') }), 'error')
    } finally {
      setIsForgettingCredential(false)
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

      {/* 忘记凭证确认对话框 */}
      <AlertDialog open={showForgetCredential} onOpenChange={(v) => !v && setShowForgetCredential(false)}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 size={16} />
              {t('git.forgetCredential')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('git.forgetCredentialConfirm', { repo: repo.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isForgettingCredential}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isForgettingCredential}
              onClick={(e) => {
                e.preventDefault()
                handleForgetCredential()
              }}
            >
              {isForgettingCredential && <Loader2 size={12} className="animate-spin mr-1" />}
              {t('git.forgetCredential')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 强制推送/拉取凭证对话框 */}
      <CredentialDialog
        open={credentialDialog.open}
        onClose={() => setCredentialDialog({ open: false, action: 'forcePush' })}
        onSubmit={handleCredentialSubmit}
        repoName={repo.name}
        repoPath={repo.path}
        isLoading={isCredentialLoading}
        actionLabel={credentialDialog.action === 'forcePush' ? t('git.pushWithCredential') : t('git.pullWithCredential')}
      />

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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs cursor-pointer gap-2"
                style={{ color: 'var(--text-primary)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowForgetCredential(true)
                }}
              >
                <Trash2 size={12} style={{ color: 'var(--text-muted)' }} />
                <span>{t('git.forgetCredential')}</span>
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

const GitView = memo(function GitView() {
  const repositories = useGitStore((s: GitState) => s.repositories)
  const setRepositories = useGitStore((s: GitState) => s.setRepositories)
  const scanProgress = useGitStore((s: GitState) => s.scanProgress)
  const pullAllRepos = useGitStore((s: GitState) => s.pullAllRepos)
  const updateRepositoryStatuses = useGitStore((s: GitState) => s.updateRepositoryStatuses)
  const loadConflictRepos = useGitStore((s: GitState) => s.loadConflictRepos)
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const showToast = useUIStore((s) => s.showToast)
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [isPullingRepos, setIsPullingRepos] = useState(false)
  const { t } = useTranslation()
  const hasInitialSyncRef = useRef(false)
  // 跟踪已扫描过的路径指纹，避免启动阶段依赖变化触发重复扫描
  const lastScannedPathsRef = useRef<string>('')

  // Load conflict repos from database on mount
  useEffect(() => {
    loadConflictRepos()
  }, [loadConflictRepos])

  // Keep displayed repositories in sync with the canonical cache
  useEffect(() => {
    return useGitStore.subscribe((state, prevState) => {
      if (prevState && state.cachedRepositories !== prevState.cachedRepositories) {
        setRepositories(state.cachedRepositories)
      }
    })
  }, [setRepositories])

  useEffect(() => {
    setSelectedRepos([])

    const scanPaths = workspaceMode === 'workspace'
      ? (workspaceFolders || [])
      : (rootPath ? [rootPath] : [])

    const currentCached = useGitStore.getState().cachedRepositories
    if (currentCached.length > 0) {
      setRepositories(currentCached)
    }

    if (!hasInitialSyncRef.current) {
      hasInitialSyncRef.current = true
      lastScannedPathsRef.current = scanPaths.join(',')
      // 首次挂载：workspace.ts 的 scanAndCacheGitRepos 会在启动时扫描，避免重复
      return
    }

    const pathsKey = scanPaths.join(',')

    // 缓存为空时由 workspace.ts 负责首次扫描，GitView 不触发
    if (currentCached.length === 0 && scanPaths.length > 0) {
      lastScannedPathsRef.current = pathsKey
      return
    }

    // 路径未变则跳过
    if (pathsKey === lastScannedPathsRef.current) return
    lastScannedPathsRef.current = pathsKey

    // 路径/模式变化时重新扫描
    if (scanPaths.length === 0) {
      setRepositories([])
      return
    }

    const gitStore = useGitStore.getState()
    gitStore.scanAndCacheRepos(scanPaths)
  }, [rootPath, workspaceFolders, workspaceMode, setRepositories])

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
      ? repositories.filter((r: GitRepository) => selectedRepos.includes(r.path))
      : repositories

    const reposWithRemote = reposToPull.filter((r: GitRepository) => r.remoteUrl)
    if (reposWithRemote.length === 0) {
      showToast(t('git.noReposToSync'), 'info')
      return
    }

    setIsPullingRepos(true)
    // Don't reset all statuses — only update repos that were actually pulled.
    // resetRepositoryStatuses() would clear conflict states of repos not in this pull.
    const gitStore = useGitStore.getState()
    gitStore.setSyncStatus({ isSyncing: true })

    try {
      const results = await pullAllRepos(reposWithRemote)
      const succeeded = results.filter((r: PullResult) => r.success).length
      const failed = results.filter((r: PullResult) => !r.success && !r.isConflict).length
      const conflicted = results.filter((r: PullResult) => r.isConflict).length

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
        const conflictNames = results.filter((r: PullResult) => r.isConflict).map((r: PullResult) => r.name).join(', ')
        showToast(t('git.pullConflict', { repos: conflictNames }), 'error')
        
        // Do NOT auto-open conflict tabs — user must click conflict icon or repo to open

        // Sync conflict repos to database
        const gitStore = useGitStore.getState()
        await gitStore.syncConflictReposFromPullResults(results)
      } else if (failed > 0) {
        // G-06 修复：批量 pull 遇到 detached HEAD 时给出更明确的提示
        const detachedNames = results.filter((r: PullResult) => r.isDetachedHead).map((r: PullResult) => r.name).join(', ')
        if (detachedNames) {
          showToast(t('git.pullDetachedHead', { defaultValue: '{{repos}}: 仓库处于 detached HEAD 状态，请先切换到分支再拉取', repos: detachedNames }), 'error')
        } else {
          showToast(t('git.pullResult', { success: succeeded, fail: failed }), 'error')
        }
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
      const gitStore = useGitStore.getState()
      await gitStore.scanAndCacheRepos(scanPaths)
      // Reload conflict repos from database to ensure conflict status is accurate
      await loadConflictRepos()
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
            {repositories.map((repo: GitRepository) => (
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
})

export { GitView }
