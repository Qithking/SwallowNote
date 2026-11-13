/**
 * Bug 复现:欢迎页(WelcomeScreen)在 macOS 上渲染崩溃
 *
 * 用户症状:点击 md 文件后编辑器区域显示「加载文件失败: {{error}}」
 *
 * 因果链:C12 删除 CommandPalette 组件时,从 ShortcutKey/DEFAULT_SHORTCUTS
 * 删除了 commandPalette 键,但遗漏了 Editor.tsx 欢迎页的快捷键提示引用:
 *   getShortcut('commandPalette')
 *   → getShortcutKey('commandPalette', {}) 返回 undefined
 *   → formatShortcutForDisplay(undefined) 在 macOS 上调 .replace() 抛 TypeError
 *   → EditorView 渲染崩溃,被 App.tsx 外层 ErrorBoundary 捕获
 *   → fallback 显示 t('editor.loadFailed')(无 error 插值参数)→「加载文件失败: {{error}}」
 *
 * WelcomeScreen 在无活动 tab 时渲染;fallback 一旦显示即持续,用户点击 md 文件
 * 时看到的正是这个持续的 fallback。
 *
 * 本测试 mock macOS userAgent(真实 shortcuts 实现),断言无 tab 时渲染不崩溃。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// macOS 平台:isMacPlatform() 读 navigator.userAgent,触发 .replace() 崩溃路径
beforeAll(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    configurable: true,
  })
})

vi.mock('@/stores/pluginEditor', () => ({
  usePluginEditors: vi.fn(() => ({ extensions: new Set<string>(), revision: 0 })),
  pluginEditorRegistry: {
    getActivePluginExtensions: vi.fn(() => new Set<string>()),
    getEditorForExtension: vi.fn(() => null),
  },
}))

vi.mock('@/components/editors/MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="md-editor" />,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: () => null,
}))

vi.mock('@/lib/tauri', () => ({
  openFolderDialog: vi.fn().mockResolvedValue(null),
  openFileDialog: vi.fn().mockResolvedValue(null),
  getFolderHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/utils/fileTypeUtils', () => ({
  detectFileType: vi.fn((name: string) => (name.endsWith('.md') ? 'markdown' : 'code')),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}))

// '@/stores' 用真实 editor store + stub UI/workspace(Editor.tsx 从 barrel 导入)
vi.mock('@/stores', async () => {
  const editorStore = await import('@/stores/editor')
  const uiState = {
    customShortcuts: {},
    workspaceMode: 'single',
    rightPanelType: null,
    setRightPanelType: vi.fn(),
  }
  const wsState = {
    rootPath: '/tmp',
    workspaceFolders: [],
    loadWorkspaceFile: vi.fn(),
    openFolder: vi.fn(),
    switchMode: vi.fn(),
  }
  const useUIStore: any = (selector?: any) => (selector ? selector(uiState) : uiState)
  const useWorkspaceStore: any = (selector?: any) => (selector ? selector(wsState) : wsState)
  useUIStore.getState = () => uiState
  useWorkspaceStore.getState = () => wsState
  return { ...editorStore, useUIStore, useWorkspaceStore }
})

import { EditorView } from '@/components/Editor'
import { useEditorStore } from '@/stores/editor'

describe('WelcomeScreen 在 macOS 上渲染不崩溃(commandPalette 删键遗漏)', () => {
  afterEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('无活动 tab 时欢迎页正常渲染,快捷键提示不含 commandPalette 项', () => {
    useEditorStore.setState({ tabs: [], activeTabId: null })

    // 修复前:getShortcut('commandPalette') → undefined.replace() 抛 TypeError
    render(<EditorView />)

    // 欢迎页正常渲染(显示欢迎标题)
    expect(screen.getByText('editor.welcome')).toBeInTheDocument()
    // 已删键的 commandPalette 提示项不再出现
    expect(screen.queryByText('welcome.quickOpen')).not.toBeInTheDocument()
    // 其余快捷键提示(基于现存 DEFAULT_SHORTCUTS)正常显示
    expect(screen.getByText('welcome.newFile')).toBeInTheDocument()
    expect(screen.getByText('welcome.save')).toBeInTheDocument()
    expect(screen.getByText('welcome.settings')).toBeInTheDocument()
  })
})
