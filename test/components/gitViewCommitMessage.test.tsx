/**
 * I16 回归测试：Git 默认提交消息随语言切换更新。
 *
 * 此前 `useState(() => t('git.defaultCommitMessage'))` 仅初始化一次，
 * 语言切换后提交框仍显示旧语言文案（I5 语言持久化修复后更明显）。
 * 修复：语言变化时若用户未手动编辑，则跟随刷新默认文案；用户已编辑则不覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))
vi.mock('@/lib/tauri', () => ({
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(undefined),
}))

import { render, fireEvent, act } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommitSection } from '@/components/Git/GitView'
import type { GitRepository } from '@/stores/git'
import i18n from '@/i18n'

const repo: GitRepository = {
  name: 'repo',
  path: '/repo',
  remoteUrl: null,
  hasUncommittedChanges: false,
  uncommittedCount: 0,
  currentBranch: 'main',
  isSubmodule: false,
  parentPath: null,
  status: 'normal',
}

const baseProps = {
  selectedRepos: ['/repo'],
  allRepos: [repo],
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onStatusUpdate: vi.fn(),
}

function renderCommit() {
  return render(<TooltipProvider><CommitSection {...baseProps} /></TooltipProvider>)
}

// 提交消息输入框是 CommitSection 中唯一的 input[type="text"]
function getCommitInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="text"]') as HTMLInputElement
}

describe('默认提交消息响应语言切换（I16）', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('语言切换后默认提交消息跟随更新（用户未编辑）', async () => {
    const { container } = renderCommit()
    const input = getCommitInput(container)
    expect(input.value).toBe('同步变更')

    // act 包裹：确保语言切换触发的重渲染与 useEffect 完整 flush
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(input.value).toBe('Sync changes')
    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    expect(input.value).toBe('同步变更')
  })

  it('用户已手动编辑时语言切换不覆盖自定义内容', async () => {
    const { container } = renderCommit()
    const input = getCommitInput(container)
    fireEvent.change(input, { target: { value: '我的提交说明' } })

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(input.value).toBe('我的提交说明')
  })
})
