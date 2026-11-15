/**
 * Git 同步审计 P2 前端回归测试（S-13/S-15/S-16）：
 *
 * S-13：force push/pull 与自动同步互斥——isSyncing 时不执行 force 操作。
 * S-15：子模块未提交/引用待更新计入失败而非成功（此前 successCount++ 与
 *       errorPaths.push 矛盾，toast 报成功同时仓库标红）。
 * S-16：全部仓库凭证缺失且凭证框已打开时，取消后应有引导提示（此前完全静默）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@/lib/tauri', () => ({
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(undefined),
  gitForcePush: vi.fn().mockResolvedValue(undefined),
  gitForcePull: vi.fn().mockResolvedValue(undefined),
  gitCredentialSave: vi.fn().mockResolvedValue(undefined),
  gitCredentialGet: vi.fn().mockResolvedValue(undefined),
  gitCredentialDelete: vi.fn().mockResolvedValue(undefined),
  gitAttachBranchToHead: vi.fn().mockResolvedValue(undefined),
  gitSwitchToLocalBranch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/git/service', () => ({
  commitAndPushRepo: vi.fn(),
  withCredentialFallback: vi.fn(),
}))

import { render, fireEvent, act, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommitSection, RepositoryItem } from '@/components/Git/GitView'
import { useGitStore, type GitRepository } from '@/stores/git'
import { useUIStore } from '@/stores/ui'
import { commitAndPushRepo, withCredentialFallback } from '@/lib/git/service'
import { GitErrorCode } from '@/lib/git/errors'
import i18n from '@/i18n'

const showToast = vi.fn()

function makeRepo(path: string, overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    name: path.split('/').pop() || 'repo',
    path,
    remoteUrl: 'https://example.com/repo.git',
    hasUncommittedChanges: true,
    uncommittedCount: 1,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'normal',
    ...overrides,
  }
}

const baseProps = {
  selectedRepos: ['/repo1'],
  allRepos: [] as GitRepository[],
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onStatusUpdate: vi.fn(),
}

beforeEach(async () => {
  vi.clearAllMocks()
  useGitStore.setState({ syncStatus: { isSyncing: false, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 } } as never)
  useUIStore.setState({ showToast } as never)
  await i18n.changeLanguage('zh-CN')
})

describe('S-15 子模块计数（CommitSection.handleCommit）', () => {
  it('子模块未提交变更：计入失败并标红（onStatusUpdate 收到 errorPaths）', async () => {
    const repo = makeRepo('/repo1', { isSubmodule: true, parentPath: '/parent' })
    ;(commitAndPushRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      errorCode: GitErrorCode.SubmoduleUncommitted,
      error: 'submodule has changes',
    })
    const onStatusUpdate = vi.fn()
    const props = { ...baseProps, allRepos: [repo], selectedRepos: ['/repo1'], onStatusUpdate }

    render(
      <TooltipProvider><CommitSection {...props} /></TooltipProvider>
    )
    fireEvent.click(screen.getByText('同步'))
    await act(async () => { await Promise.resolve() })

    // 子模块问题计入失败 → onStatusUpdate 收到 errorPaths（标红）
    const statusCalls = onStatusUpdate.mock.calls as [string[], string[]][]
    const [, errorPaths] = statusCalls[statusCalls.length - 1] ?? [[], []]
    expect(errorPaths).toContain('/repo1')
  })
})

describe('S-16 全部凭证缺失提示（CommitSection.handleCommit）', () => {
  it('全部仓库 needsCredential：凭证框打开且无其它结果时给出引导提示', async () => {
    const repo = makeRepo('/repo1')
    ;(commitAndPushRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      needsCredential: true,
      errorCode: GitErrorCode.AuthRequired,
      error: 'AUTH_REQUIRED',
    })
    const props = { ...baseProps, allRepos: [repo], selectedRepos: ['/repo1'] }

    render(
      <TooltipProvider><CommitSection {...props} /></TooltipProvider>
    )
    fireEvent.click(screen.getByText('同步'))
    await act(async () => { await Promise.resolve() })

    // S-16：凭证框打开 + 无 success/error 详情 → info 提示引导（已翻译文案）
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    const infoCalls = showToast.mock.calls
    expect(infoCalls.some((c) => c[0] === '需要输入凭证才能同步，请在弹窗中输入用户名和密码' && c[1] === 'info')).toBe(true)
    // 不误报成功
    expect(showToast.mock.calls.some((c) => String(c[0]).includes('已同步'))).toBe(false)
  })
})

describe('S-13 force 操作互斥（RepositoryItem）', () => {
  it('isSyncing 时 force push 不执行并提示同步中', async () => {
    useGitStore.setState({ syncStatus: { isSyncing: true, isAutoPushing: false, lastSyncTime: null, succeeded: 0, failed: 0, conflicted: 0 } } as never)
    const repo = makeRepo('/repo1', { hasUncommittedChanges: false })
    ;(withCredentialFallback as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true })

    render(
      <TooltipProvider><RepositoryItem repo={repo} isSelected={false} onToggle={vi.fn()} onRefresh={vi.fn()} /></TooltipProvider>
    )
    // 点击「更多」按钮（RepositoryItem 中唯一无 title 的 icon button）打开
    // DropdownMenu（Radix 用 pointer 事件）→ 点击「强制推送」菜单项 → 确认
    const moreBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg'))!
    fireEvent.pointerDown(moreBtn)
    fireEvent.click(moreBtn)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getAllByText('强制推送')[0])
    await act(async () => { await Promise.resolve() })
    // Dialog 确认按钮（菜单项打开 Dialog 后，Dialog 内按钮文本同为「强制推送」，
    // 取最后一个即确认按钮）
    fireEvent.click(screen.getAllByText('强制推送').at(-1)!)
    await act(async () => { await Promise.resolve() })

    // isSyncing 前置检查短路，不发起 force 操作
    expect(withCredentialFallback).not.toHaveBeenCalled()
  })
})
