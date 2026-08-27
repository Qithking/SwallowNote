/**
 * StatusBar viewLogsTooltip 快捷键渲染正确性测试
 *
 * Bug: viewLogsTooltip 在 i18n 中硬编码 "Ctrl+Shift+Y"
 *  - 用户重绑 logViewer 快捷键后,tooltip 仍显示旧值
 *  - macOS 上不显示 ⌘⇧Y 符号
 *
 * RED: 当前实现测试应失败
 * GREEN: 修复后通过
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useUIStore } from '@/stores/ui'

// vi.hoisted: 与 vi.mock 同提升级别,避免 mock 闭包捕获 TDZ 变量
const hoisted = vi.hoisted(() => {
  const initial: Record<string, string> = {
    'statusBar.viewLogs': '日志',
    'statusBar.viewLogsTooltip': '查看应用日志（Ctrl+Shift+Y）',
    'statusBar.clonePrefix': '克隆({{url}})',
    'statusBar.cloneProgressTooltip': '克隆进度 {{url}}',
    'statusBar.fmIndexPrefix': '索引',
    'statusBar.fmIndexDoneTooltip': '已完成 {{total}}',
    'statusBar.fmIndexProgressTooltip': 'Frontmatter 索引进度 {{done}}/{{total}}',
    'statusBar.version': '版本',
    'statusBar.versionCheck': '检查更新',
    'statusBar.versionLatest': '已是最新',
    'statusBar.versionHasUpdate': '发现新版本 {{version}}',
    'statusBar.versionChecking': '检查中',
    'statusBar.versionCheckFailed': '检查失败',
    'statusBar.versionDownloading': '下载中 {{percent}}%',
    'statusBar.versionReady': '已下载，点击安装',
    'statusBar.versionDownloadFailed': '下载失败',
    'statusBar.downloadFolder': '下载目录',
    'statusBar.updateInstalled': '已更新，点击重启',
    'statusBar.linkOpen': '打开链接',
    'statusBar.linkCopy': '复制链接',
    'statusBar.noVersionInfo': '无版本信息',
    'statusBar.gitStatus': 'Git 状态',
    'statusBar.noGitRepo': '无 Git 仓库',
    'statusBar.workspace': '工作区',
    'statusBar.fileStatusError': '文件状态异常',
    'statusBar.cloneSuccess': '克隆成功',
    'statusBar.cloneFailed': '克隆失败',
    'statusBar.syncResult': '同步结果',
    'statusBar.syncSucceeded': '成功',
    'statusBar.syncFailed': '失败',
    'statusBar.syncConflicted': '冲突',
  }
  return {
    translated: { ...initial },
    setTranslated: (obj: Record<string, string>) => {
      Object.assign(hoisted.translated, obj)
    },
    /** 供 formatShortcutForDisplay mock 读取的平台开关 */
    mockPlatform: 'Win32' as 'Win32' | 'MacIntel',
  }
})
const { translated, setTranslated } = hoisted

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      let s = translated[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replaceAll(`{{${k}}}`, String(v))
        }
      }
      return s
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/lib/shortcuts', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    // 绕开 jsdom 无法 override navigator.platform 的限制,用测试可控的 mockPlatform
    formatShortcutForDisplay: (shortcut: string) => {
      const isMac = hoisted.mockPlatform.toUpperCase().includes('MAC')
      if (!isMac) return shortcut
      return shortcut
        .replace('Ctrl+', '⌘+')
        .replace('Shift+', '⇧+')
        .replace('Alt+', '⌥+')
    },
  }
})

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
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)
}

function setUiState(partial: Partial<ReturnType<typeof useUIStore.getState>>) {
  useUIStore.setState({
    ...useUIStore.getState(),
    ...partial,
  } as Partial<ReturnType<typeof useUIStore.getState>>)
}

describe('StatusBar viewLogsTooltip 快捷键正确性', () => {
  beforeEach(() => {
    setUiState({
      developerMode: true,
      logViewerVisible: false,
      customShortcuts: {},
    })
    hoisted.mockPlatform = 'Win32'
    setTranslated({ 'statusBar.viewLogsTooltip': '查看应用日志 ({{shortcut}})' })
  })

  function hoverAndGetTooltip() {
    const trigger = screen.getByTestId('statusbar-log-button')
    fireEvent.pointerEnter(trigger)
    fireEvent.mouseOver(trigger)
    fireEvent.focus(trigger)
    return screen.getByRole('tooltip', { timeout: 2000 })
  }

  it('默认快捷键 + Windows 平台 → 显示 Ctrl+Shift+Y', () => {
    hoisted.mockPlatform = 'Win32'
    setUiState({ customShortcuts: {} })
    renderWithProviders(<StatusBar />)
    const tt = hoverAndGetTooltip()
    expect(tt.textContent).toContain('Ctrl+Shift+Y')
  })

  it('AC-1: 重绑 logViewer 为 Ctrl+Shift+L → 显示新快捷键', () => {
    hoisted.mockPlatform = 'Win32'
    setUiState({ customShortcuts: { logViewer: 'Ctrl+Shift+L' } })
    renderWithProviders(<StatusBar />)
    const tt = hoverAndGetTooltip()
    expect(tt.textContent).toContain('Ctrl+Shift+L')
    expect(tt.textContent).not.toContain('Ctrl+Shift+Y')
  })

  it('AC-2: macOS 默认快捷键 → 显示 ⌘+⇧+Y 符号', () => {
    hoisted.mockPlatform = 'MacIntel'
    setUiState({ customShortcuts: {} })
    renderWithProviders(<StatusBar />)
    const tt = hoverAndGetTooltip()
    expect(tt.textContent).toContain('⌘+⇧+Y')
  })

  it('AC-2 + 重绑: macOS + Ctrl+Shift+L → 显示 ⌘+⇧+L', () => {
    hoisted.mockPlatform = 'MacIntel'
    setUiState({ customShortcuts: { logViewer: 'Ctrl+Shift+L' } })
    renderWithProviders(<StatusBar />)
    const tt = hoverAndGetTooltip()
    expect(tt.textContent).toContain('⌘+⇧+L')
  })

  it('英文文案插值 + 重绑 → (Ctrl+Shift+L)', () => {
    hoisted.mockPlatform = 'Win32'
    setTranslated({ 'statusBar.viewLogsTooltip': 'View application logs ({{shortcut}})' })
    setUiState({ customShortcuts: { logViewer: 'Ctrl+Shift+L' } })
    renderWithProviders(<StatusBar />)
    const tt = hoverAndGetTooltip()
    expect(tt.textContent).toContain('(Ctrl+Shift+L)')
    expect(tt.textContent).not.toContain('(Ctrl+Shift+Y)')
  })
})
