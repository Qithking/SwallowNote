/**
 * ConflictResolver Component - Conflict resolution module
 * Left side: repo names and conflict file tree
 * Right side: toolbar (top) + split diff viewer (bottom)
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Loader2,
  XCircle,
  Upload,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import SplitDiffViewer from './SplitDiffViewer'
import {
  gitGetConflictFiles,
  gitGetConflictLocalContent,
  gitGetConflictRemoteContent,
  gitResolveConflictFile,
  gitAbortConflict,
  ConflictFile,
} from '@/lib/tauri'
import { useUIStore, useGitStore, useFileTreeStore } from '@/stores'

interface ConflictRepo {
  path: string
  name: string
  files: ConflictFile[]
}

interface ConflictResolverProps {
  repoPath: string
  repoName: string
}

function ConflictResolver({ repoPath, repoName: _repoName }: ConflictResolverProps) {
  const { t } = useTranslation()
  const { showToast } = useUIStore()
  const [conflictRepos, setConflictRepos] = useState<ConflictRepo[]>([])
  const [selectedFile, setSelectedFile] = useState<{ repoPath: string; file: ConflictFile } | null>(null)
  const [localContent, setLocalContent] = useState<string>('')
  const [remoteContent, setRemoteContent] = useState<string>('')
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set([repoPath]))
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set())
  const [isLoadingRepos, setIsLoadingRepos] = useState(true)
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false)
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState<'local' | 'remote' | null>(null)

  // Load conflict files for all conflicted repos
  const loadConflicts = useCallback(async () => {
    setIsLoadingRepos(true)
    try {
      const gitStore = useGitStore.getState()
      const conflictPaths = gitStore.repositories
        .filter(r => r.status === 'conflict')
        .map(r => r.path)

      // Also check the current repoPath if not in the list
      if (!conflictPaths.includes(repoPath)) {
        conflictPaths.push(repoPath)
      }

      const repos: ConflictRepo[] = []
      for (const path of conflictPaths) {
        try {
          const files = await gitGetConflictFiles(path)
          if (files.length > 0) {
            const repo = gitStore.repositories.find(r => r.path === path)
            const name = repo?.name || path.split('/').pop() || path
            repos.push({ path, name, files })
          }
        } catch (e) {
          console.error('Failed to get conflict files for:', path, e)
        }
      }
      setConflictRepos(repos)
      
      // Auto-expand all repos with conflicts
      setExpandedRepos(new Set(repos.map(r => r.path)))
    } catch (e) {
      console.error('Failed to load conflicts:', e)
    } finally {
      setIsLoadingRepos(false)
    }
  }, [repoPath])

  useEffect(() => {
    loadConflicts()
  }, [loadConflicts])

  // Load file content when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      setLocalContent('')
      setRemoteContent('')
      return
    }

    const loadContent = async () => {
      setIsLoadingContent(true)
      setLocalContent('')
      setRemoteContent('')
      try {
        console.log('[ConflictResolver] Loading content for:', selectedFile.file.path, 'repoPath:', selectedFile.repoPath)
        const [local, remote] = await Promise.all([
          gitGetConflictLocalContent(selectedFile.repoPath, selectedFile.file.path),
          gitGetConflictRemoteContent(selectedFile.repoPath, selectedFile.file.path),
        ])
        console.log('[ConflictResolver] Local content length:', local?.length, 'Remote content length:', remote?.length)
        console.log('[ConflictResolver] Local preview:', local?.substring(0, 100))
        console.log('[ConflictResolver] Remote preview:', remote?.substring(0, 100))
        setLocalContent(local || '')
        setRemoteContent(remote || '')
      } catch (e) {
        console.error('[ConflictResolver] Failed to load conflict content:', e)
        showToast(t('git.loadContentFailed') + ': ' + String(e), 'error')
      } finally {
        setIsLoadingContent(false)
      }
    }
    loadContent()
  }, [selectedFile, showToast, t])

  const toggleRepoExpanded = (path: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleResolve = async (side: 'local' | 'remote') => {
    if (!selectedFile) return
    setIsResolving(true)
    try {
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, side)
      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))
      showToast(t('git.conflictResolved'), 'success')

      // Reload conflicts to check if all are resolved
      await loadConflicts()

      // If all conflicts for this repo are resolved, refresh file tree
      const gitStore = useGitStore.getState()
      const repo = gitStore.repositories.find(r => r.path === selectedFile.repoPath)
      if (repo) {
        // Update repo status
        const files = await gitGetConflictFiles(selectedFile.repoPath)
        if (files.length === 0) {
          gitStore.updateRepository(selectedFile.repoPath, { status: 'normal' })
          const fileTreeStore = useFileTreeStore.getState()
          fileTreeStore.refreshExpanded()
        }
      }

      // Clear selection if the file is resolved
      setSelectedFile(null)
    } catch (e) {
      console.error('Failed to resolve conflict:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  const handleOverwriteLocal = () => {
    setOverwriteConfirmOpen('local')
  }

  const handleOverwriteRemote = () => {
    setOverwriteConfirmOpen('remote')
  }

  const confirmOverwrite = async () => {
    const side = overwriteConfirmOpen
    setOverwriteConfirmOpen(null)
    if (side) {
      await handleResolve(side)
    }
  }

  const handleAbort = async () => {
    setAbortConfirmOpen(false)
    setIsResolving(true)
    try {
      // Abort all conflicted repos
      for (const repo of conflictRepos) {
        try {
          await gitAbortConflict(repo.path)
        } catch (e) {
          console.error('Failed to abort conflict for:', repo.path, e)
        }
      }
      showToast(t('git.abortSuccess'), 'success')

      // Reset repo statuses
      const gitStore = useGitStore.getState()
      for (const repo of conflictRepos) {
        gitStore.updateRepository(repo.path, { status: 'normal' })
      }

      // Refresh file tree
      const fileTreeStore = useFileTreeStore.getState()
      fileTreeStore.refreshExpanded()

      // Close the conflict tab
      const { useEditorStore } = await import('@/stores')
      const conflictTabId = `conflict-${repoPath}`
      useEditorStore.getState().removeTab(conflictTabId)
    } catch (e) {
      console.error('Failed to abort conflict:', e)
      showToast(t('git.abortFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  const totalFiles = conflictRepos.reduce((sum, r) => sum + r.files.length, 0)
  const resolvedCount = resolvedFiles.size
  const allResolved = totalFiles > 0 && resolvedCount >= totalFiles

  // Build file tree path structure for grouping files by directory
  const buildFileTree = (files: ConflictFile[]) => {
    const tree: Map<string, { dirs: Set<string>, files: ConflictFile[] }> = new Map()
    for (const file of files) {
      const parts = file.path.split('/')
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
      if (!tree.has(dir)) {
        tree.set(dir, { dirs: new Set(), files: [] })
      }
      if (parts.length > 1) {
        // Directory is already captured in 'dir' variable
        // No additional intermediate processing needed
        tree.get(dir!)!.files.push(file)
      } else {
        tree.get(dir!)!.files.push(file)
      }
    }
    return tree
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel - Repo and file tree */}
      <div className="w-[260px] shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
        {/* Header */}
        <div className="flex items-center justify-between h-8 px-3 shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-yellow-500" />
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('git.conflictFiles')}
            </span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
            {resolvedCount}/{totalFiles}
          </span>
        </div>

        {/* File tree */}
        <ScrollArea className="flex-1">
          {isLoadingRepos ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : conflictRepos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
              {allResolved ? (
                <>
                  <CheckCircle2 size={24} className="text-green-500 mb-2" />
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('git.allConflictsResolved')}</p>
                </>
              ) : (
                <>
                  <AlertTriangle size={24} className="text-yellow-500 mb-2 opacity-50" />
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('git.noConflicts')}</p>
                </>
              )}
            </div>
          ) : (
            <div className="py-1">
              {conflictRepos.map((repo) => {
                const isExpanded = expandedRepos.has(repo.path)
                const fileTree = buildFileTree(repo.files)

                return (
                  <div key={repo.path}>
                    {/* Repo header */}
                    <div
                      className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--bg-hover)]"
                      onClick={() => toggleRepoExpanded(repo.path)}
                    >
                      {isExpanded ? <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />}
                      <Folder size={13} className="text-yellow-500 shrink-0" />
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
                      <span className="text-[10px] shrink-0 px-1 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        {repo.files.length}
                      </span>
                    </div>

                    {/* Files */}
                    {isExpanded && (
                      <div className="ml-4">
                        {Array.from(fileTree.entries()).map(([dir, data]) => (
                          <div key={dir || '__root__'}>
                            {dir && (
                              <div className="flex items-center gap-1 px-2 py-0.5">
                                <Folder size={11} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
                                <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{dir}</span>
                              </div>
                            )}
                            {data.files.map((file) => {
                              const fileName = file.path.split('/').pop() || file.path
                              const isResolved = resolvedFiles.has(file.abs_path)
                              const isSelected = selectedFile?.file.abs_path === file.abs_path

                              return (
                                <div
                                  key={file.abs_path}
                                  className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs
                                    ${isSelected ? 'bg-primary/10' : 'hover:bg-[var(--bg-hover)]'}
                                    ${dir ? 'ml-4' : ''}
                                  `}
                                  onClick={() => {
                                    if (!isResolved) {
                                      setSelectedFile({ repoPath: repo.path, file })
                                    }
                                  }}
                                  style={{ opacity: isResolved ? 0.5 : 1 }}
                                >
                                  {isResolved ? (
                                    <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                                  ) : (
                                    <FileText size={13} className="text-yellow-500 shrink-0" />
                                  )}
                                  <span className="truncate" style={{ color: isResolved ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                    {fileName}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right panel - Toolbar + Diff viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between h-9 px-3 shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2">
            {selectedFile && (
              <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                {selectedFile.file.path}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Resolve Conflict - marks as resolved (keep current working tree version) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || isResolving}
                  onClick={() => handleResolve('local')}
                >
                  <CheckCircle2 size={13} className="text-green-500" />
                  {t('git.resolveConflict')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.resolveConflict')}</TooltipContent>
            </Tooltip>

            {/* Overwrite Remote (use local) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || isResolving}
                  onClick={handleOverwriteRemote}
                >
                  <Upload size={13} className="text-blue-500" />
                  {t('git.overwriteRemote')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.overwriteRemoteConfirm')}</TooltipContent>
            </Tooltip>

            {/* Overwrite Local (use remote) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || isResolving}
                  onClick={handleOverwriteLocal}
                >
                  <Download size={13} className="text-orange-500" />
                  {t('git.overwriteLocal')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.overwriteLocalConfirm')}</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Abort conflict resolution */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-red-500 hover:text-red-600"
                  disabled={isResolving}
                  onClick={() => setAbortConfirmOpen(true)}
                >
                  <XCircle size={13} />
                  {t('git.abortConflict')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.abortConflict')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Split diff viewer */}
        <div className="flex-1 overflow-hidden">
          {isLoadingContent ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : selectedFile ? (
            <SplitDiffViewer
              localContent={localContent}
              remoteContent={remoteContent}
              localLabel={t('git.local')}
              remoteLabel={t('git.remote')}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('git.clickFileToCompare')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Abort Confirmation Dialog */}
      {abortConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg p-4 max-w-[400px] w-full mx-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{t('git.abortConflict')}</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{t('git.abortConflictConfirm')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAbortConfirmOpen(false)} disabled={isResolving}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleAbort} disabled={isResolving}>
                {isResolving && <Loader2 size={12} className="animate-spin mr-1" />}
                {t('git.abortConflict')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite Confirmation Dialog */}
      {overwriteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg p-4 max-w-[400px] w-full mx-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              {overwriteConfirmOpen === 'local' ? t('git.overwriteLocal') : t('git.overwriteRemote')}
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              {overwriteConfirmOpen === 'local' ? t('git.overwriteLocalConfirm') : t('git.overwriteRemoteConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOverwriteConfirmOpen(null)} disabled={isResolving}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmOverwrite} disabled={isResolving}>
                {isResolving && <Loader2 size={12} className="animate-spin mr-1" />}
                {overwriteConfirmOpen === 'local' ? t('git.overwriteLocal') : t('git.overwriteRemote')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resolving overlay */}
      {isResolving && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{t('git.resolving')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConflictResolver
