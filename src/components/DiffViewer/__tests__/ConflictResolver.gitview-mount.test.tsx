/**
 * Feedback loop for debug session `conflict-panel-blank`.
 * 复刻用户症状路径: 同步面板(GitView)点击 status='conflict' 的仓库
 * → openConflictTab(path, name) 无 options → ConflictResolver 挂载
 * → 期望渲染冲突文件树; 症状 = 应用不显示(渲染崩溃/无限循环 → 测试红).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import ConflictResolver from '../ConflictResolver'
import { useGitStore } from '@/stores/git'
import { useEditorStore } from '@/stores/editor'
import type { GitRepository } from '@/stores/git'

const REPO_PATH = 'D:/notes/workdoc'
const REPO_NAME = 'workdoc'

function seedConflictRepo() {
  const repo: GitRepository = {
    name: REPO_NAME,
    path: REPO_PATH,
    remoteUrl: 'https://example.com/repo.git',
    hasUncommittedChanges: false,
    uncommittedCount: 0,
    currentBranch: 'main',
    isSubmodule: false,
    parentPath: null,
    status: 'conflict',
  }
  useGitStore.setState({ repositories: [repo] })
}

describe('conflict-panel-blank: GitView repo click → ConflictResolver mount', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'git_get_conflict_files') {
        return [{ path: '202608.md', abs_path: `${REPO_PATH}/202608.md` }]
      }
      if (cmd === 'git_get_conflict_local_content') return 'local content'
      if (cmd === 'git_get_conflict_remote_content') return 'remote content'
      return undefined
    })
    seedConflictRepo()
  })

  it('renders conflict tree after openConflictTab without crashing (no options, GitView path)', async () => {
    // 精确复刻 GitView.handleClick 的调用(无 options)
    act(() => {
      useEditorStore.getState().openConflictTab(REPO_PATH, REPO_NAME)
    })

    const rendered = render(
      <ConflictResolver repoPath={REPO_PATH} repoName={REPO_NAME} />,
    )

    // 症状"应用不显示" = 树永不出现或 render 抛错(如 Maximum update depth exceeded)
    await waitFor(() => {
      expect(rendered.getByText(REPO_NAME)).toBeInTheDocument()
      expect(rendered.getByText('202608.md')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
