/**
 * StatusBar 冲突数显示测试
 *
 * Bug: 解决冲突后状态栏仍显示冲突信息
 * Root cause: StatusBar 只订阅 syncStatus.conflicted (pull 快照),
 *             未订阅实时 conflictRepos, 解决冲突后不归零
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useUIStore } from '@/stores/ui'
import { useGitStore } from '@/stores/git'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@/lib/tauri', () => ({
  checkLatestVersion: vi.fn().mockResolvedValue(null),
  downloadLatestRelease: vi.fn(),
  openInstaller: vi.fn(),
  installAndRestart: vi.fn(),
  DownloadProgress: {},
}))

vi.mock('../../package.json', () => ({ default: { version: '0.0.0-test' } }))

import { StatusBar } from '@/components/StatusBar'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

// 查找冲突图标 (lucide-react AlertTriangle 的 class 为 lucide-triangle-alert)
function queryConflictIcon(container: HTMLElement) {
  return container.querySelector('.lucide-triangle-alert')
}

// 获取冲突图标的数量文本
function getConflictCountText(container: HTMLElement): string | null {
  const svg = queryConflictIcon(container)
  if (!svg) return null
  const parent = svg.parentElement
  return parent?.textContent ?? null
}

describe('StatusBar 冲突数显示', () => {
  beforeEach(() => {
    useUIStore.setState({
      developerMode: false,
      logViewerVisible: false,
    })
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: Date.now(),
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
      conflictRepos: [],
    })
  })

  it('解决冲突后 conflictRepos 为空, 状态栏不应显示冲突图标', () => {
    // syncStatus.conflicted=1 (pull 快照), 但 conflictRepos=[] (已解决)
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: Date.now(),
        succeeded: 1,
        failed: 0,
        conflicted: 1,
      },
      conflictRepos: [],
    })
    const { container } = renderWithProviders(<StatusBar />)
    // AlertTriangle 图标不应出现 (conflictRepos.length === 0)
    expect(queryConflictIcon(container)).toBeNull()
  })

  it('有未解决冲突时显示冲突数 (基于 conflictRepos.length)', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: Date.now(),
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
      conflictRepos: [
        { repo_path: '/ws/repo1', repo_name: 'repo1', conflict_file_count: 2 },
      ],
    })
    const { container } = renderWithProviders(<StatusBar />)
    // 应显示冲突图标, 数量为 1 (conflictRepos.length)
    expect(queryConflictIcon(container)).not.toBeNull()
    expect(getConflictCountText(container)).toBe('1')
  })

  it('syncStatus.conflicted=2 但 conflictRepos 只剩 1 个, 应显示 1 (实时)', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: Date.now(),
        succeeded: 0,
        failed: 0,
        conflicted: 2,
      },
      conflictRepos: [
        { repo_path: '/ws/repo1', repo_name: 'repo1', conflict_file_count: 2 },
      ],
    })
    const { container } = renderWithProviders(<StatusBar />)
    // 应显示 1 (conflictRepos.length), 不是 2 (syncStatus 快照)
    expect(getConflictCountText(container)).toBe('1')
  })
})
