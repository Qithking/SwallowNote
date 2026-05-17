/**
 * GitView Component - Git integration panel with multi-repository support
 */
import { useState, useEffect } from 'react'
import {
  GitBranch,
  RefreshCw,
  ChevronDown,
  Circle,
  Check,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useGitStore, GitRepository } from '@/stores/git'
import { scanGitRepos, GitRepositoryInfo, gitCommitAndPush } from '@/lib/tauri'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWorkspaceStore, useUIStore } from '@/stores'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'

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
  const { showToast } = useUIStore()

  const handleCommit = async () => {
    const commitMessage = 'Sync changes'

    const reposToCommit = selectedRepos.length > 0
      ? allRepos.filter(r => selectedRepos.includes(r.path))
      : allRepos.filter(r => r.hasUncommittedChanges)

    if (reposToCommit.length === 0) {
      showToast('没有需要同步的仓库或没有变更', 'info')
      return
    }

    const reposWithChanges = reposToCommit.filter(r => r.hasUncommittedChanges)
    if (reposWithChanges.length === 0 && selectedRepos.length === 0) {
      showToast('没有需要同步的变更', 'info')
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
        if (errorMessage.includes('没有需要提交的变更') || 
            errorMessage.includes('nothing to commit') ||
            errorMessage.includes('working tree clean') ||
            errorMessage.includes('no changes added to commit') ||
            (errorMessage.includes('modified content') && errorMessage.includes('submodule'))) {
          successCount++
        } else if (errorMessage.includes('子模块内部有未提交的变更')) {
          successCount++
          showToast(`${repo.name}: 子模块内部有未提交的变更，请先在子模块内提交`, 'error')
        } else if (errorMessage.includes('子模块引用需要更新')) {
          successCount++
          showToast(`${repo.name}: 子模块引用需要更新，请先提交子模块变更`, 'error')
        } else {
          failCount++
          showToast(`${repo.name}: ${errorMessage || '未知错误'}`, 'error')
        }
      }
    }

    setIsCommitting(false)

    onRefresh()
    
    if (failCount === 0) {
      if (successCount > 0) {
        showToast(`已同步 ${successCount} 个仓库`, 'success')
      }
    } else {
      showToast(`成功 ${successCount} 个，失败 ${failCount} 个`, 'error')
    }
  }
  
  return (
    <div className="p-2" style={{ borderColor: 'var(--border-color)' }}>
      <Button
        className="w-full h-8 text-xs"
        variant="default"
        onClick={handleCommit}
        disabled={isCommitting}
      >
        {isCommitting && <Loader2 size={12} className="animate-spin" />}
        {isCommitting ? '同步中...' : '同步'}
      </Button>
    </div>
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
              <span className="text-xs px-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>子模块</span>
            )}
            <span style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
          </div>
          
          {/* Git remote URL */}
          <div className="text-xs pl-7" style={{ color: 'var(--text-muted)' }}>
            {repo.remoteUrl || '无远程仓库'}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[300px]">
        <div className="space-y-1">
          <div><span className="font-medium">仓库目录:</span> {repo.path}</div>
          {repo.isSubmodule && repo.parentPath && (
            <div><span className="font-medium">父仓库:</span> {repo.parentPath}</div>
          )}
          {repo.hasUncommittedChanges && (
            <div><span className="font-medium">待提交文件:</span> {repo.uncommittedCount} 个文件</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function GitView() {
  const { repositories, setRepositories, cachedRepositories, scanProgress } = useGitStore()
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode } = useUIStore()
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])

  // 优先使用缓存数据，后台异步刷新
  useEffect(() => {
    // 立即显示缓存数据
    if (cachedRepositories.length > 0) {
      setRepositories(cachedRepositories)
    }

    // 后台异步刷新
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

        const seenPaths = new Set<string>()
        const uniqueRepos = allRepos.filter((repo: GitRepositoryInfo) => {
          if (seenPaths.has(repo.path)) {
            return false
          }
          seenPaths.add(repo.path)
          return true
        })

        const storeRepos: GitRepository[] = uniqueRepos.map((repo: GitRepositoryInfo) => ({
          name: repo.name,
          path: repo.path,
          remoteUrl: repo.remote_url,
          hasUncommittedChanges: repo.has_uncommitted_changes,
          uncommittedCount: repo.uncommitted_count,
          currentBranch: repo.current_branch,
          branches: [],
          isSubmodule: repo.is_submodule,
          parentPath: repo.parent_path,
        }))
        setRepositories(storeRepos)
      } catch (e) {
        console.error('Failed to scan git repos:', e)
        if (cachedRepositories.length === 0) {
          setRepositories([])
        }
      }
    }

    loadRepos()
  }, [rootPath, workspaceFolders, workspaceMode, cachedRepositories, setRepositories])

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

      const seenPaths = new Set<string>()
      const uniqueRepos = allRepos.filter((repo: GitRepositoryInfo) => {
        if (seenPaths.has(repo.path)) {
          return false
        }
        seenPaths.add(repo.path)
        return true
      })

      const storeRepos: GitRepository[] = uniqueRepos.map((repo: GitRepositoryInfo) => ({
        name: repo.name,
        path: repo.path,
        remoteUrl: repo.remote_url,
        hasUncommittedChanges: repo.has_uncommitted_changes,
        uncommittedCount: repo.uncommitted_count,
        currentBranch: repo.current_branch,
        branches: [],
        isSubmodule: repo.is_submodule,
        parentPath: repo.parent_path,
      }))
      setRepositories(storeRepos)
    } catch (e) {
      console.error('Failed to refresh repos:', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium uppercase tracking-wider">同步管理</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh}>
                <RefreshCw size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新所有仓库列表</TooltipContent>
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
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>未发现 Git 仓库</p>
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
