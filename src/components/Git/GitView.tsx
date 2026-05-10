/**
 * GitView Component - Git integration panel
 */
import {
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequestDraft,
  Plus,
  RefreshCw,
  ChevronDown,
  Check,
} from 'lucide-react'
import { useGitStore } from '@/stores'
import { cn } from '@/lib/utils'

function GitView() {
  const {
    isRepository,
    currentBranch,
    branches,
    hasUncommittedChanges,
    uncommittedCount,
  } = useGitStore()

  if (!isRepository) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4">
        <GitBranch size={32} className="mb-3 opacity-50" />
        <p className="text-sm text-center mb-2">Not a Git repository</p>
        <button className="text-xs text-primary hover:underline">
          Initialize Git
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <GitBranch size={14} />
          <span className="text-sm font-medium">{currentBranch}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1 rounded hover:bg-accent" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button className="p-1 rounded hover:bg-accent" title="Branch Actions">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Changes Section */}
      <div className="flex-1 overflow-auto p-2">
        {/* Uncommitted Changes */}
        {hasUncommittedChanges && (
          <div className="mb-4">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Changes ({uncommittedCount})
              </span>
              <button className="p-1 rounded hover:bg-accent">
                <Plus size={12} />
              </button>
            </div>
            <div className="space-y-1">
              {/* Placeholder for changed files */}
              <div className="p-2 rounded hover:bg-accent cursor-pointer text-sm">
                <span className="text-muted-foreground">No changes</span>
              </div>
            </div>
          </div>
        )}

        {/* Stashes */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Stashes
            </span>
            <button className="p-1 rounded hover:bg-accent">
              <Plus size={12} />
            </button>
          </div>
          <div className="p-2 rounded hover:bg-accent cursor-pointer text-sm">
            <span className="text-muted-foreground">No stashes</span>
          </div>
        </div>

        {/* Branches */}
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Branches
            </span>
          </div>
          <div className="space-y-1">
            {branches.map((branch) => (
              <div
                key={branch.name}
                className={cn(
                  'p-2 rounded cursor-pointer text-sm flex items-center gap-2',
                  branch.isCurrent ? 'bg-accent' : 'hover:bg-accent'
                )}
              >
                {branch.isCurrent && <Check size={12} className="text-primary" />}
                <GitBranch size={12} />
                <span>{branch.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-2 border-t border-border">
        <button className="flex-1 h-7 px-3 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">
          <GitCommit size={12} className="inline mr-1" />
          Commit
        </button>
        <button className="flex-1 h-7 px-3 rounded bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90">
          <GitMerge size={12} className="inline mr-1" />
          Pull
        </button>
        <button className="flex-1 h-7 px-3 rounded bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90">
          <GitPullRequestDraft size={12} className="inline mr-1" />
          Push
        </button>
      </div>
    </div>
  )
}

export { GitView }
