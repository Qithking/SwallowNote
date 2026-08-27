/**
 * AIView 拆分前 characterization 测试
 *
 * 行为契约: 拆分 hooks 后, AIView 的两条核心渲染路径保持不变:
 *  1. 未配置 AI 模型时显示 "ai.notConfigured" 引导与 "ai.goToSettings" 按钮
 *  2. 已配置但无消息时显示 "ai.placeholderResponse" 占位
 *
 * Source: plan/large-file-split-batch Phase 3 (Critic reservation #4)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    status: 'ready',
    stop: vi.fn(),
    error: null,
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
  }),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: class {
    api: string
    constructor(opts: { api: string }) {
      this.api = opts.api
    }
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/tauri', () => ({
  restartAiProxy: vi.fn().mockResolvedValue(undefined),
  saveAiMessage: vi.fn().mockResolvedValue(1),
  loadAiMessages: vi.fn().mockResolvedValue([]),
  loadAiRolePrompts: vi.fn().mockResolvedValue([]),
  writeFile: vi.fn().mockResolvedValue(undefined),
  createFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api', () => ({ loadFileContent: vi.fn().mockResolvedValue('') }))

vi.mock('@/lib/ai', () => ({ getAiProxyUrl: vi.fn().mockReturnValue('http://127.0.0.1:0/api/chat') }))

// MarkdownRenderer 拉取 react-markdown/shiki/katex 等重组件, 测试中替换为桩
vi.mock('@/components/AI/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

import { useUIStore } from '@/stores/ui'
import { useEditorStore } from '@/stores/editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { AIView } from '@/components/AI/AIView'
import { TooltipProvider } from '@/components/ui/tooltip'

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('AIView characterization (拆分前行为基线)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null, insertAtCursor: vi.fn(), replaceContent: vi.fn() })
    useWorkspaceStore.setState({ rootPath: '' })
  })

  it('未配置 AI 模型时显示 notConfigured 引导与 goToSettings 按钮', () => {
    useUIStore.setState({
      aiModels: [],
      activeAiModelId: '',
      defaultAiModelId: '',
      aiPort: 0,
      aiAttachedFiles: [],
      aiContextMenuRequest: null,
    })
    const { container, getByText } = renderWithProviders(<AIView />)
    expect(getByText('ai.notConfigured')).toBeDefined()
    expect(getByText('ai.goToSettings')).toBeDefined()
    // 未配置时不渲染占位提示
    expect(container.textContent).not.toContain('ai.placeholderResponse')
  })

  it('已配置但无消息时显示 placeholderResponse 占位', () => {
    useUIStore.setState({
      aiModels: [
        { id: 'm1', name: 'M', model: 'm', provider: 'openai', baseUrl: '', category: 'api' },
      ],
      activeAiModelId: 'm1',
      defaultAiModelId: 'm1',
      aiPort: 0,
      aiAttachedFiles: [],
      aiContextMenuRequest: null,
    })
    const { getByText } = renderWithProviders(<AIView />)
    expect(getByText('ai.placeholderResponse')).toBeDefined()
  })
})
