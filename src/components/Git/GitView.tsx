/**
 * GitView Component - Git integration panel with multi-repository support
 */
import { useState, useRef, useEffect } from 'react'
import {
  GitBranch,
  RefreshCw,
  ChevronDown,
  Circle,
  Check,
  Loader2,
} from 'lucide-react'
import { useGitStore, GitRepository } from '@/stores/git'
import { scanGitRepos, GitRepositoryInfo, gitCommitAndPush } from '@/lib/tauri'
import { useWorkspaceStore, useUIStore } from '@/stores'
import { cn } from '@/lib/utils'

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
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const { showToast } = useUIStore()

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      showToast('请输入提交信息')
      return
    }

    // Determine which repos to commit
    // 如果选中了仓库，只提交选中的（即使显示没有变更也尝试提交）
    // 如果没选中任何仓库，提交所有有待提交变更的仓库
    const reposToCommit = selectedRepos.length > 0
      ? allRepos.filter(r => selectedRepos.includes(r.path))
      : allRepos.filter(r => r.hasUncommittedChanges)

    if (reposToCommit.length === 0) {
      showToast('没有需要提交的仓库或没有变更')
      return
    }

    // 进一步过滤：移除没有实际变更的仓库
    const reposWithChanges = reposToCommit.filter(r => r.hasUncommittedChanges)
    if (reposWithChanges.length === 0 && selectedRepos.length === 0) {
      showToast('没有需要提交的变更')
      return
    }
    
    // 如果用户明确选中了仓库，即使没有显示变更也尝试提交
    const finalRepos = reposWithChanges.length > 0 ? reposWithChanges : reposToCommit

    setIsCommitting(true)
    let successCount = 0
    let failCount = 0

    for (const repo of finalRepos) {
      try {
        await gitCommitAndPush(repo.path, commitMessage)
        successCount++
      } catch (e) {
        console.error('Failed to commit and push:', repo.path, e)
        // 忽略"没有需要提交的变更"错误
        if (String(e).includes('没有需要提交的变更')) {
          successCount++
        } else {
          failCount++
          showToast(`${repo.name}: ${e}`)
        }
      }
    }

    setIsCommitting(false)
    setCommitMessage('')

    // Refresh and show final result
    onRefresh()
    
    if (failCount === 0) {
      if (successCount > 0) {
        showToast(`已提交 ${successCount} 个仓库`)
      }
    } else {
      showToast(`成功 ${successCount} 个，失败 ${failCount} 个`)
    }
  }
  
  return (
    <div className="p-2 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border-color)' }}>
      <input
        type="text"
        placeholder="提交信息"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        className="w-full h-8 px-3 text-xs rounded outline-none"
        style={{ 
          backgroundColor: 'var(--bg-tertiary)', 
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)'
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isCommitting) {
            handleCommit()
          }
        }}
      />
      <button 
        className="w-full h-8 px-3 text-xs rounded font-medium flex items-center justify-center gap-2"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--text-primary)' }}
        onClick={handleCommit}
        disabled={isCommitting}
      >
        {isCommitting && <Loader2 size={12} className="animate-spin" />}
        {isCommitting ? '提交中...' : '提交'}
      </button>
    </div>
  )
}

// Repository item with checkbox for multi-select
function RepositoryItem({ 
  repo, 
  isSelected, 
  onToggle 
}: { 
  repo: GitRepository
  isSelected: boolean
  onToggle: () => void
}) {
  const [showPopover, setShowPopover] = useState(false)
  const timerRef = useRef<NodeJS.Timeout>()

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => setShowPopover(true), 300)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShowPopover(false)
  }

  return (
    <div className="relative">
      <div
        className={cn(
          'p-2 rounded cursor-pointer text-sm flex flex-col gap-1',
          'hover:bg-[var(--bg-hover)]',
          isSelected && 'bg-[var(--bg-hover)]'
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
          <span style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
        </div>
        
        {/* Git remote URL */}
        <div className="text-xs pl-7" style={{ color: 'var(--text-muted)' }}>
          {repo.remoteUrl || '无远程仓库'}
        </div>
      </div>

      {/* Popover on hover */}
      {showPopover && (
        <div
          className="absolute left-0 top-full mt-1 p-2 rounded shadow-lg z-50 text-xs min-w-[200px]"
          style={{ 
            backgroundColor: 'var(--bg-tertiary)', 
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)'
          }}
          onMouseEnter={() => { if (timerRef.current) clearTimeout(timerRef.current) }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="font-medium mb-1">仓库目录</div>
          <div className="text-[var(--text-muted)] break-all mb-2">{repo.path}</div>
          {repo.hasUncommittedChanges && (
            <>
              <div className="font-medium mb-1">待提交文件</div>
              <div style={{ color: 'var(--text-muted)' }}>
                {repo.uncommittedCount} 个文件
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GitView() {
  const { repositories, setRepositories } = useGitStore()
  const { rootPath } = useWorkspaceStore()
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])

  // Scan for git repositories in workspace
  useEffect(() => {
    const loadRepos = async () => {
      if (!rootPath) return
      
      try {
        const repos = await scanGitRepos(rootPath)
        // Convert backend format to store format
        const storeRepos: GitRepository[] = repos.map((repo: GitRepositoryInfo) => ({
          name: repo.name,
          path: repo.path,
          remoteUrl: repo.remote_url,
          hasUncommittedChanges: repo.has_uncommitted_changes,
          uncommittedCount: repo.uncommitted_count,
          currentBranch: repo.current_branch,
          branches: [],
        }))
        setRepositories(storeRepos)
        // Clear selection when repos change
        setSelectedRepos([])
      } catch (e) {
        console.error('Failed to scan git repos:', e)
        setRepositories([])
      }
    }
    
    loadRepos()
  }, [rootPath, setRepositories])

  const toggleRepo = (path: string) => {
    setSelectedRepos(prev => 
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    )
  }

  const handleRefresh = async () => {
    if (!rootPath) return
    try {
      const repos = await scanGitRepos(rootPath)
      const storeRepos: GitRepository[] = repos.map((repo: GitRepositoryInfo) => ({
        name: repo.name,
        path: repo.path,
        remoteUrl: repo.remote_url,
        hasUncommittedChanges: repo.has_uncommitted_changes,
        uncommittedCount: repo.uncommitted_count,
        currentBranch: repo.current_branch,
        branches: [],
      }))
      setRepositories(storeRepos)
    } catch (e) {
      console.error('Failed to refresh repos:', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[40px] px-3 shrink-0 select-none" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>源代码管理</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            className="p-1 rounded hover:bg-[var(--bg-hover)]" 
            title="刷新"
            style={{ color: 'var(--text-muted)' }}
          >
            <RefreshCw size={14} />
          </button>
          <button 
            className="p-1 rounded hover:bg-[var(--bg-hover)]" 
            title="分支操作"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Repositories List */}
      <div className="flex-1 overflow-auto p-2">
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
      </div>

      {/* Commit Message Input and Sync Button */}
      <CommitSection 
        selectedRepos={selectedRepos}
        allRepos={repositories}
        onRefresh={handleRefresh}
      />
    </div>
  )
}

export { GitView }
