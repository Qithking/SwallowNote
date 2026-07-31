/**
 * StatusBar 日志按钮行为测试 (AC: developerMode=true 时显示按钮，点击调用 toggleLogViewer)
 *
 * RED 阶段：按钮尚未实现，测试应失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useUIStore } from '@/stores/ui'

// 隔离 i18n —— StatusBar 用 useTranslation，避免拖入完整 i18n 初始化
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// 隔离 Tauri shell open —— StatusBar 仓库链接会调用
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn().mockResolvedValue(undefined),
}))

// 隔离 Tauri invoke —— 版本检查 / 下载目录会调用
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

// 隔离 Tauri event listen —— 克隆进度监听
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

// 隔离 @/lib/tauri 的版本检查相关 API
vi.mock('@/lib/tauri', () => ({
  checkLatestVersion: vi.fn().mockResolvedValue(null),
  downloadLatestRelease: vi.fn(),
  openInstaller: vi.fn(),
  installAndRestart: vi.fn(),
  DownloadProgress: {},
}))

// 隔离 package.json
vi.mock('../../package.json', () => ({ default: { version: '0.0.0-test' } }))

import { StatusBar } from '@/components/StatusBar'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function setUiState(partial: Partial<ReturnType<typeof useUIStore.getState>>) {
  useUIStore.setState({
    ...useUIStore.getState(),
    ...partial,
  } as Partial<ReturnType<typeof useUIStore.getState>>)
}

describe('StatusBar 日志按钮', () => {
  beforeEach(() => {
    // 重置到稳定的初始状态
    setUiState({
      developerMode: false,
      logViewerVisible: false,
    })
  })

  it('developerMode=false 时不渲染日志按钮', () => {
    setUiState({ developerMode: false })
    renderWithProviders(<StatusBar />)
    expect(screen.queryByTestId('statusbar-log-button')).toBeNull()
  })

  it('developerMode=true 时渲染日志按钮', () => {
    setUiState({ developerMode: true })
    renderWithProviders(<StatusBar />)
    expect(screen.queryByTestId('statusbar-log-button')).not.toBeNull()
  })

  it('点击日志按钮调用 toggleLogViewer', () => {
    setUiState({ developerMode: true, logViewerVisible: false })
    renderWithProviders(<StatusBar />)
    const btn = screen.getByTestId('statusbar-log-button')
    fireEvent.click(btn)
    // 点击后 store 状态应翻转
    expect(useUIStore.getState().logViewerVisible).toBe(true)
  })
})
