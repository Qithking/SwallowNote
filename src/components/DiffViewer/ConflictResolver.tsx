/**
 * ConflictResolver Component - Conflict resolution module
 *
 * Workflow:
 * 1. Left side shows repo names and conflict files in a proper tree structure
 * 2. Click a conflict file to open split diff viewer (local editable, remote read-only)
 * 3. User can edit local content and save (writes back to file, but conflict NOT resolved yet)
 * 4. Only when user clicks "Mark as Resolved" is the conflict considered handled
 * 5. Also supports "Overwrite Local" (use remote) and "Overwrite Remote" (use local)
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Loader2,
  XCircle,
  Save,
  CheckCheck,
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
  gitSaveConflictFileContent,
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

// ---- Tree node types for the file tree ----
interface DirNode {
  type: 'dir'
  name: string
  fullPath: string
  children: TreeNode[]
}

interface FileNode {
  type: 'file'
  name: string
  fullPath: string
  file: ConflictFile
}

type TreeNode = DirNode | FileNode

/**
 * Build a proper multi-level tree structure from a flat list of conflict files.
 * Each file's `path` is relative to the repo root, e.g. "docs/notes/test.md"
 */
function buildFileTree(files: ConflictFile[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/')
    let currentLevel = root

    // Navigate/create directory nodes for all parts except the last (which is the filename)
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]
      const dirFullPath = parts.slice(0, i + 1).join('/')

      let existingDir = currentLevel.find(
        (node): node is DirNode => node.type === 'dir' && node.name === dirName
      )

      if (!existingDir) {
        existingDir = {
          type: 'dir',
          name: dirName,
          fullPath: dirFullPath,
          children: [],
        }
        currentLevel.push(existingDir)
      }

      currentLevel = existingDir.children
    }

    // Add the file node
    const fileName = parts[parts.length - 1]
    currentLevel.push({
      type: 'file',
      name: fileName,
      fullPath: file.path,
      file,
    })
  }

  // Sort: directories first, then files, both alphabetically
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    }).map(node => {
      if (node.type === 'dir') {
        return { ...node, children: sortNodes(node.children) }
      }
      return node
    })
  }

  return sortNodes(root)
}

function ConflictResolver({ repoPath, repoName: _repoName }: ConflictResolverProps) {
  const { t } = useTranslation()
  const { showToast } = useUIStore()
  const [conflictRepos, setConflictRepos] = useState<ConflictRepo[]>([])
  const [selectedFile, setSelectedFile] = useState<{ repoPath: string; file: ConflictFile } | null>(null)
  const [localContent, setLocalContent] = useState<string>('')
  const [remoteContent, setRemoteContent] = useState<string>('')
  const [editedLocalContent, setEditedLocalContent] = useState<string>('')
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set([repoPath]))
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [isLoadingRepos, setIsLoadingRepos] = useState(true)
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false)
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState<'local' | 'remote' | null>(null)
  const [markResolvedConfirmOpen, setMarkResolvedConfirmOpen] = useState(false)
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set())
  // Content version key to ensure SplitDiffViewer remounts when content source changes
  const [contentVersion, setContentVersion] = useState(0)

  // Whether the local content has been modified
  const hasUnsavedChanges = editedLocalContent !== localContent

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
      const stalePaths: string[] = [] // Paths with conflict status but no actual conflict files
      for (const path of conflictPaths) {
        try {
          const files = await gitGetConflictFiles(path)
          if (files.length > 0) {
            const repo = gitStore.repositories.find(r => r.path === path)
            const name = repo?.name || path.split('/').pop() || path
            repos.push({ path, name, files })
          } else {
            // Backend returned no conflict files - this is a stale state
            // (state files exist but no unmerged files)
            stalePaths.push(path)
          }
        } catch (e) {
          console.error('Failed to get conflict files for:', path, e)
        }
      }

      // If ALL repos have no actual conflict files, this is a false positive.
      // Clean up the stale state: reset repo status to normal and close the conflict tab.
      if (repos.length === 0 && stalePaths.length > 0) {
        console.warn('[ConflictResolver] All repos have no actual conflict files - cleaning up stale state')
        const gitStoreNow = useGitStore.getState()
        for (const path of stalePaths) {
          gitStoreNow.updateRepository(path, { status: 'normal' })
        }
        // Close the conflict tab
        const { useEditorStore } = await import('@/stores')
        const editorStore = useEditorStore.getState()
        const conflictTabId = `conflict-${repoPath}`
        editorStore.removeTab(conflictTabId)
        return
      }

      // If some repos have real conflicts and some are stale, just reset the stale ones
      if (stalePaths.length > 0) {
        const gitStoreNow = useGitStore.getState()
        for (const path of stalePaths) {
          gitStoreNow.updateRepository(path, { status: 'normal' })
        }
      }

      setConflictRepos(repos)

      // Auto-expand all repos with conflicts
      setExpandedRepos(new Set(repos.map(r => r.path)))

      // Auto-expand all directories in the tree
      const allDirs = new Set<string>()
      for (const repo of repos) {
        const tree = buildFileTree(repo.files)
        collectAllDirs(tree, '', allDirs)
      }
      setExpandedDirs(allDirs)
    } catch (e) {
      console.error('Failed to load conflicts:', e)
    } finally {
      setIsLoadingRepos(false)
    }
  }, [repoPath])

  // Helper to collect all directory paths for auto-expansion
  const collectAllDirs = (nodes: TreeNode[], parentPath: string, result: Set<string>) => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name
        result.add(fullPath)
        collectAllDirs(node.children, fullPath, result)
      }
    }
  }

  useEffect(() => {
    loadConflicts()
  }, [loadConflicts])

  // Load file content when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      setLocalContent('')
      setEditedLocalContent('')
      setRemoteContent('')
      setContentVersion(prev => prev + 1)
      return
    }

    const loadContent = async () => {
      setIsLoadingContent(true)
      // Clear content immediately to prevent stale state
      setLocalContent('')
      setEditedLocalContent('')
      setRemoteContent('')
      try {
        const [local, remote] = await Promise.all([
          gitGetConflictLocalContent(selectedFile.repoPath, selectedFile.file.path),
          gitGetConflictRemoteContent(selectedFile.repoPath, selectedFile.file.path),
        ])
        // Set all content atomically to prevent SplitDiffViewer from seeing mismatched states
        setLocalContent(local || '')
        setEditedLocalContent(local || '')
        setRemoteContent(remote || '')
        // Bump version to force SplitDiffViewer remount with fresh content
        setContentVersion(prev => prev + 1)
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

  const toggleDirExpanded = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }

  // Save edited local content back to file (does NOT mark conflict as resolved)
  const handleSaveLocalContent = async () => {
    if (!selectedFile) return
    setIsSaving(true)
    try {
      await gitSaveConflictFileContent(
        selectedFile.repoPath,
        selectedFile.file.abs_path,
        editedLocalContent
      )
      setLocalContent(editedLocalContent)
      showToast(t('git.saveSuccess'), 'success')
    } catch (e) {
      console.error('Failed to save conflict file content:', e)
      showToast(t('git.saveFailed', { error: String(e) }), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Mark the current conflict file as resolved (uses current file content on disk)
  const handleMarkAsResolved = async () => {
    if (!selectedFile) return
    setMarkResolvedConfirmOpen(false)
    setIsResolving(true)
    try {
      // If there are unsaved changes, save first
      if (hasUnsavedChanges) {
        await gitSaveConflictFileContent(
          selectedFile.repoPath,
          selectedFile.file.abs_path,
          editedLocalContent
        )
      }

      // Mark as resolved using "current" side (keep whatever is on disk)
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, 'current')
      showToast(t('git.conflictResolved'), 'success')

      // Track resolved file
      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))

      await loadConflicts()

      const gitStore = useGitStore.getState()
      const repo = gitStore.repositories.find(r => r.path === selectedFile.repoPath)
      if (repo && repo.status === 'normal') {
        const fileTreeStore = useFileTreeStore.getState()
        fileTreeStore.refreshExpanded()
      }

      setSelectedFile(null)

      // Auto-close tab when all conflicts are resolved
      const updatedRepos = useGitStore.getState().repositories
      const stillConflicted = updatedRepos.some(r => r.status === 'conflict')
      if (!stillConflicted) {
        const { useEditorStore } = await import('@/stores')
        const conflictTabId = `conflict-${repoPath}`
        const editorStore = useEditorStore.getState()
        const tab = editorStore.tabs.find(t => t.id === conflictTabId)
        if (tab) {
          setTimeout(() => {
            editorStore.removeTab(conflictTabId)
          }, 1500)
        }
      }
    } catch (e) {
      console.error('Failed to mark conflict as resolved:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  // Overwrite with local or remote version (marks as resolved immediately)
  const handleOverwrite = async (side: 'local' | 'remote') => {
    if (!selectedFile) return
    setOverwriteConfirmOpen(null)
    setIsResolving(true)
    try {
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, side)
      showToast(t('git.conflictResolved'), 'success')

      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))

      await loadConflicts()

      const gitStore = useGitStore.getState()
      const repo = gitStore.repositories.find(r => r.path === selectedFile.repoPath)
      if (repo && repo.status === 'normal') {
        const fileTreeStore = useFileTreeStore.getState()
        fileTreeStore.refreshExpanded()
      }

      setSelectedFile(null)

      // Auto-close tab when all conflicts are resolved
      const updatedRepos = useGitStore.getState().repositories
      const stillConflicted = updatedRepos.some(r => r.status === 'conflict')
      if (!stillConflicted) {
        const { useEditorStore } = await import('@/stores')
        const conflictTabId = `conflict-${repoPath}`
        const editorStore = useEditorStore.getState()
        const tab = editorStore.tabs.find(t => t.id === conflictTabId)
        if (tab) {
          setTimeout(() => {
            editorStore.removeTab(conflictTabId)
          }, 1500)
        }
      }
    } catch (e) {
      console.error('Failed to resolve conflict:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
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

  // Render tree nodes recursively
  const renderTreeNodes = (nodes: TreeNode[], repoPath: string, depth: number = 0) => {
    return nodes.map((node) => {
      if (node.type === 'dir') {
        const isExpanded = expandedDirs.has(node.fullPath)
        return (
          <div key={`dir-${node.fullPath}`}>
            <div
              className="flex items-center gap-1 cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: '8px', paddingTop: '2px', paddingBottom: '2px' }}
              onClick={() => toggleDirExpanded(node.fullPath)}
            >
              {isExpanded ? (
                <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
              ) : (
                <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen size={13} className="text-yellow-500 shrink-0" />
              ) : (
                <Folder size={13} className="text-yellow-500 shrink-0" />
              )}
              <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                {node.name}
              </span>
            </div>
            {isExpanded && renderTreeNodes(node.children, repoPath, depth + 1)}
          </div>
        )
      }

      // File node
      const isSelected = selectedFile?.file.abs_path === node.file.abs_path
      const isResolved = resolvedFiles.has(node.file.abs_path)
      return (
        <div
          key={`file-${node.file.abs_path}`}
          className={`flex items-center gap-1.5 cursor-pointer text-xs
            ${isSelected ? 'bg-primary/10' : 'hover:bg-[var(--bg-hover)]'}
            ${isResolved ? 'opacity-50' : ''}
          `}
          style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: '8px', paddingTop: '3px', paddingBottom: '3px' }}
          onClick={() => {
            if (!isResolved) {
              setSelectedFile({ repoPath, file: node.file })
            }
          }}
        >
          {isResolved ? (
            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
          ) : (
            <FileText size={13} className="text-yellow-500 shrink-0" />
          )}
          <span className="truncate" style={{ color: isResolved ? 'var(--text-muted)' : 'var(--text-primary)' }}>
            {node.name}
          </span>
        </div>
      )
    })
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
            {totalFiles}
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
              <AlertTriangle size={24} className="text-yellow-500 mb-2" />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('git.noConflictFilesDetected')}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('git.conflictStateHint')}</p>
            </div>
          ) : (
            <div className="py-1">
              {conflictRepos.map((repo) => {
                const isExpanded = expandedRepos.has(repo.path)
                const tree = buildFileTree(repo.files)

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

                    {/* Tree nodes */}
                    {isExpanded && renderTreeNodes(tree, repo.path, 0)}
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
              <>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                  {selectedFile.file.abs_path}
                </span>
                {hasUnsavedChanges && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    {t('git.unsavedChanges')}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Save local content button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || !hasUnsavedChanges || isSaving || isResolving}
                  onClick={handleSaveLocalContent}
                >
                  <Save size={13} className={hasUnsavedChanges ? 'text-orange-500' : ''} />
                  {t('git.saveLocalContent')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.saveLocalContent')}</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Mark as Resolved button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || isResolving}
                  onClick={() => setMarkResolvedConfirmOpen(true)}
                >
                  <CheckCheck size={13} className="text-green-500" />
                  {t('git.markAsResolved')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('git.markAsResolved')}</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Overwrite Remote (use local) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!selectedFile || isResolving}
                  onClick={() => setOverwriteConfirmOpen('remote')}
                >
                  <Folder size={13} className="text-blue-500" />
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
                  onClick={() => setOverwriteConfirmOpen('local')}
                >
                  <FileText size={13} className="text-orange-500" />
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
              key={contentVersion}
              localContent={localContent}
              remoteContent={remoteContent}
              localLabel={t('git.local')}
              remoteLabel={t('git.remote')}
              editedContent={editedLocalContent}
              onLocalContentChange={setEditedLocalContent}
              filename={selectedFile.file.path}
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

      {/* Mark as Resolved Confirmation Dialog */}
      {markResolvedConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg p-4 max-w-[400px] w-full mx-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{t('git.markAsResolved')}</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              {hasUnsavedChanges
                ? t('git.markAsResolvedConfirm') + ' ' + t('git.unsavedChanges') + ' - ' + t('git.saveLocalContent') + '?'
                : t('git.markAsResolvedConfirm')
              }
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMarkResolvedConfirmOpen(false)} disabled={isResolving}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleMarkAsResolved} disabled={isResolving}>
                {isResolving && <Loader2 size={12} className="animate-spin mr-1" />}
                {t('git.markAsResolved')}
              </Button>
            </div>
          </div>
        </div>
      )}

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
              <Button variant="destructive" size="sm" onClick={() => handleOverwrite(overwriteConfirmOpen!)} disabled={isResolving}>
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
