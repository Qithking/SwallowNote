/**
 * ConflictResolver Component — Conflict file diff viewer
 *
 * Layout:
 * ┌────────────────────────────────────────────────────────┐
 * │ Toolbar: [filename]  [Accept Incoming] [Accept Current] [Abort] │
 * ├──────────┬─────────────────────────────────────────────┤
 * │ Conflict │  Incoming          │  Current               │
 * │ file     │  (read-only)       │  (read-only)           │
 * │ tree     │                    │                        │
 * └──────────┴─────────────────────────────────────────────┘
 *
 * Workflow:
 * 1. Left side shows conflict files in a tree structure
 * 2. Click a conflict file to view the Incoming vs Current diff
 * 3. Use "Accept Incoming" or "Accept Current" to resolve the conflict
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { SplitDiffViewerHandle } from './SplitDiffViewer'
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
  Download,
  Upload,
  Save,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import SplitDiffViewer from './SplitDiffViewer'
import {
  gitGetConflictFiles,
  gitGetConflictLocalContent,
  gitGetConflictRemoteContent,
  gitResolveConflictFile,
  gitSaveConflictFileContent,
  removeConflictRepoRecord,
  readFile,
  ConflictFile,
} from '@/lib/tauri'
import { useUIStore, useGitStore, useFileTreeStore, useEditorStore } from '@/stores'

interface ConflictRepo {
  path: string
  name: string
  files: ConflictFile[]
}

interface ConflictResolverProps {
  repoPath: string
  repoName: string
  /** Relative path of the conflict file to auto-select on mount (for session restore) */
  initialSelectedFile?: string
  /** Cursor line number to restore in the local editor (for session restore) */
  initialCursorLine?: number
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

function ConflictResolver({ repoPath, repoName: _repoName, initialSelectedFile, initialCursorLine }: ConflictResolverProps) {
  const { t } = useTranslation()
  const { showToast } = useUIStore()
  const [conflictRepos, setConflictRepos] = useState<ConflictRepo[]>([])
  const [selectedFile, setSelectedFile] = useState<{ repoPath: string; file: ConflictFile } | null>(null)
  const [localContent, setLocalContent] = useState<string>('')
  const [remoteContent, setRemoteContent] = useState<string>('')
  const [editedLocalContent, setEditedLocalContent] = useState<string>('')
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set([repoPath]))
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [isLoadingRepos, setIsLoadingRepos] = useState(true)
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set())
  // Content version key to ensure SplitDiffViewer remounts when content source changes
  const [contentVersion, setContentVersion] = useState(0)
  // Whether the conflict file tree panel is visible
  const [isTreeVisible, setIsTreeVisible] = useState(true)
  // Track whether initial file restore has been attempted
  const initialRestoreDone = useRef(false)
  // Current cursor line in the local editor (tracked for session persistence)
  const [cursorLine, setCursorLine] = useState<number | undefined>(initialCursorLine)

  // Ref to access SplitDiffViewer's real-time editor content
  const splitDiffRef = useRef<SplitDiffViewerHandle>(null)

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
            stalePaths.push(path)
          }
        } catch (e) {
          console.error('Failed to get conflict files for:', path, e)
        }
      }

      // If ALL repos have no actual conflict files, clean up stale state
      if (repos.length === 0 && stalePaths.length > 0) {
        console.warn('[ConflictResolver] All repos have no actual conflict files - cleaning up stale state')
        const gitStoreNow = useGitStore.getState()
        for (const path of stalePaths) {
          gitStoreNow.updateRepository(path, { status: 'normal' })
        }
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

      // Auto-select initial file for session restore
      if (initialSelectedFile && !initialRestoreDone.current) {
        initialRestoreDone.current = true
        for (const repo of repos) {
          const file = repo.files.find(f => f.path === initialSelectedFile)
          if (file) {
            setSelectedFile({ repoPath: repo.path, file })
            break
          }
        }
      }
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

  // Sync selected file and cursor line to the editor store for session persistence
  useEffect(() => {
    const tabId = `conflict-${repoPath}`
    useEditorStore.getState().updateConflictTabState(
      tabId,
      selectedFile?.file.path,
      cursorLine,
    )
  }, [repoPath, selectedFile, cursorLine])

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
        // First try to read the actual file content (user may have saved changes)
        // Fall back to git conflict content if file read fails
        let local: string
        try {
          local = await readFile(selectedFile.file.abs_path)
        } catch {
          // If reading actual file fails, fall back to git's local version
          local = await gitGetConflictLocalContent(selectedFile.repoPath, selectedFile.file.path)
        }
        const remote = await gitGetConflictRemoteContent(selectedFile.repoPath, selectedFile.file.path)
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

  // Save edited local content back to file (without marking as resolved)
  const handleSave = async () => {
    if (!selectedFile) return
    setIsResolving(true)
    try {
      // Get the latest content from the editor via ref (real-time, not stale state)
      const contentToSave = splitDiffRef.current?.getLocalContent() ?? editedLocalContent
      await gitSaveConflictFileContent(
        selectedFile.repoPath,
        selectedFile.file.abs_path,
        contentToSave
      )
      // Update the base content so hasUnsavedChanges becomes false
      setLocalContent(contentToSave)
      setEditedLocalContent(contentToSave)
      showToast(t('git.saved'), 'success')
    } catch (e) {
      console.error('Failed to save:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  // Mark the conflict as resolved (stages the file)
  const handleMarkResolved = async () => {
    if (!selectedFile) return
    setIsResolving(true)
    try {
      // If there are unsaved changes, save them first
      if (hasUnsavedChanges) {
        await gitSaveConflictFileContent(
          selectedFile.repoPath,
          selectedFile.file.abs_path,
          editedLocalContent
        )
      }

      // Mark as resolved — stage the file
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, 'current')
      showToast(t('git.conflictResolved'), 'success')

      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))
      await handlePostResolve()
    } catch (e) {
      console.error('Failed to mark resolved:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  // Accept Remote — use remote content to resolve conflict
  const handleAcceptRemote = async () => {
    if (!selectedFile) return
    setIsResolving(true)
    try {
      // Save remote content to the file
      await gitSaveConflictFileContent(
        selectedFile.repoPath,
        selectedFile.file.abs_path,
        remoteContent
      )

      // Mark as resolved — content already saved, just stage it
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, 'current')
      showToast(t('git.conflictResolved'), 'success')

      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))
      await handlePostResolve()
    } catch (e) {
      console.error('Failed to accept remote:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  // Accept Local — use local content to resolve conflict
  const handleAcceptLocal = async () => {
    if (!selectedFile) return
    setIsResolving(true)
    try {
      // Save edited local content (or original if unmodified) to the file
      const contentToSave = hasUnsavedChanges ? editedLocalContent : localContent
      await gitSaveConflictFileContent(
        selectedFile.repoPath,
        selectedFile.file.abs_path,
        contentToSave
      )

      // Mark as resolved — content already saved, just stage it
      await gitResolveConflictFile(selectedFile.repoPath, selectedFile.file.abs_path, 'current')
      showToast(t('git.conflictResolved'), 'success')

      setResolvedFiles(prev => new Set(prev).add(selectedFile.file.abs_path))
      await handlePostResolve()
    } catch (e) {
      console.error('Failed to accept local:', e)
      showToast(t('git.conflictResolveFailed', { error: String(e) }), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  // Shared post-resolve logic: refresh file tree, auto-close tab if all resolved
  const handlePostResolve = async () => {
    await loadConflicts()

    const gitStore = useGitStore.getState()
    const repo = gitStore.repositories.find(r => r.path === selectedFile!.repoPath)
    if (repo && repo.status === 'normal') {
      const fileTreeStore = useFileTreeStore.getState()
      fileTreeStore.refreshExpanded()
    }

    setSelectedFile(null)

    // Check if the repo still has conflicts and update the conflict record
    const updatedRepos = useGitStore.getState().repositories
    const stillConflicted = updatedRepos.some(r => r.status === 'conflict')
    if (!stillConflicted) {
      // All conflicts resolved — remove the conflict repo record
      try {
        await removeConflictRepoRecord(repoPath)
        await useGitStore.getState().loadConflictRepos()
      } catch (e) {
        console.error('Failed to remove conflict repo record:', e)
      }

      const { useEditorStore } = await import('@/stores')
      const conflictTabId = `conflict-${repoPath}`
      const editorStore = useEditorStore.getState()
      const tab = editorStore.tabs.find(t => t.id === conflictTabId)
      if (tab) {
        setTimeout(() => {
          editorStore.removeTab(conflictTabId)
        }, 1500)
      }
    } else {
      // Some conflicts still exist — reload conflict repos to update file counts
      await useGitStore.getState().loadConflictRepos()
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
      {isTreeVisible && (
        <div className="w-[220px] shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
          {/* Header — same height as the detail toolbar (h-9) */}
          <div className="flex items-center justify-between h-9 px-3 shrink-0 border-b"
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
      )}

      {/* Right panel - Toolbar + Merge Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* VS Code–style toolbar — same height as the file tree header (h-9) */}
        <div className="flex items-center justify-between h-9 px-3 shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2 min-w-0">
            {/* Toggle file tree visibility */}
            <button
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              onClick={() => setIsTreeVisible(prev => !prev)}
              title={isTreeVisible ? t('git.hideConflictTree') : t('git.showConflictTree')}
            >
              {isTreeVisible ? <PanelLeftClose size={14} style={{ color: 'var(--text-muted)' }} /> : <PanelLeftOpen size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
            {selectedFile && (
              <>
                <FileText size={13} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                  {selectedFile.file.path}
                </span>
                {hasUnsavedChanges && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    {t('git.unsavedChanges')}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Save button — only enabled when there are unsaved changes */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 font-medium"
              disabled={!selectedFile || isResolving || !hasUnsavedChanges}
              onClick={handleSave}
              style={{
                border: '1px solid var(--border-color)',
                ...(!selectedFile || isResolving || !hasUnsavedChanges ? {} : {
                  background: 'rgba(234, 179, 8, 0.1)',
                  color: '#eab308',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                })
              }}
            >
              <Save size={13} />
              {t('git.save')}
            </Button>

            {/* Mark Resolved button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 font-medium"
              disabled={!selectedFile || isResolving}
              onClick={handleMarkResolved}
              style={!selectedFile || isResolving ? {} : {
                background: 'rgba(34, 197, 94, 0.1)',
                color: '#22c55e',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              <CheckCircle2 size={13} />
              {t('git.markResolved')}
            </Button>

            <div className="w-px h-4 mx-1" style={{ background: 'var(--border-color)' }} />

            {/* Accept Remote button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 font-medium"
              disabled={!selectedFile || isResolving}
              onClick={handleAcceptRemote}
              style={!selectedFile || isResolving ? {} : {
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <Download size={13} />
              {t('git.acceptRemote')}
            </Button>

            {/* Accept Local button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 font-medium"
              disabled={!selectedFile || isResolving}
              onClick={handleAcceptLocal}
              style={!selectedFile || isResolving ? {} : {
                background: 'rgba(34, 197, 94, 0.1)',
                color: '#22c55e',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              <Upload size={13} />
              {t('git.acceptLocal')}
            </Button>

          </div>
        </div>

        {/* Diff viewer */}
        <div className="flex-1 overflow-hidden">
          {isLoadingContent ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : selectedFile ? (
            <SplitDiffViewer
              ref={splitDiffRef}
              key={contentVersion}
              localContent={localContent}
              remoteContent={remoteContent}
              localLabel={t('git.local')}
              remoteLabel={t('git.remote')}
              editedContent={editedLocalContent}
              onLocalContentChange={setEditedLocalContent}
              filename={selectedFile.file.path}
              initialCursorLine={initialCursorLine}
              onCursorLineChange={setCursorLine}
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
