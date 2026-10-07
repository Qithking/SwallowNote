/**
 * StatusBar 自动推送状态显示测试
 *
 * 需求: 开启自动提交后, 空闲自动推送进行中需在状态栏显示同步状态
 * 缺陷 1: 同步区以 lastSyncTime != null 为唯一显示门槛,
 *          新会话首次同步完成前即使 isSyncing=true 也不渲染 (spinner 不可见)
 * 缺陷 2: 空闲自动推送与普通同步共用「同步仓库」文案, 无法区分
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

// 同步 spinner (lucide-react RefreshCw 的 class 为 lucide-refresh-cw)
function querySyncSpinner(container: HTMLElement) {
  return container.querySelector('.lucide-refresh-cw')
}

describe('StatusBar 自动推送状态显示', () => {
  beforeEach(() => {
    useUIStore.setState({
      developerMode: false,
      logViewerVisible: false,
    })
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: null,
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
      conflictRepos: [],
    })
  })

  it('首次同步完成前 (lastSyncTime=null) 同步进行中仍显示 spinner', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: true,
        isAutoPushing: false,
        lastSyncTime: null,
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
    })
    const { container } = renderWithProviders(<StatusBar />)
    expect(querySyncSpinner(container)).not.toBeNull()
  })

  it('自动推送进行中显示「自动推送中」文案', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: true,
        isAutoPushing: true,
        lastSyncTime: null,
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
    })
    const { container } = renderWithProviders(<StatusBar />)
    expect(container.textContent).toContain('statusBar.autoPushing')
    expect(container.textContent).not.toContain('statusBar.syncRepos')
  })

  it('普通同步进行中仍显示通用同步文案', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: true,
        isAutoPushing: false,
        lastSyncTime: null,
        succeeded: 0,
        failed: 0,
        conflicted: 0,
      },
    })
    const { container } = renderWithProviders(<StatusBar />)
    expect(container.textContent).toContain('statusBar.syncRepos')
  })

  it('自动推送完成后 (isAutoPushing=false, lastSyncTime 有值) 恢复通用结果显示', () => {
    useGitStore.setState({
      syncStatus: {
        isSyncing: false,
        isAutoPushing: false,
        lastSyncTime: Date.now(),
        succeeded: 2,
        failed: 0,
        conflicted: 0,
      },
    })
    const { container } = renderWithProviders(<StatusBar />)
    expect(container.textContent).toContain('statusBar.syncRepos')
    expect(container.textContent).not.toContain('statusBar.autoPushing')
    expect(querySyncSpinner(container)).toBeNull()
  })
})
