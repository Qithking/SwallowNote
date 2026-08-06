/**
 * AIView 组件拆分结构验证测试
 *
 * 行为契约: MessageList 和 InputArea 从 AIView.tsx 抽取后模块存在且导出函数。
 * 行为保持不变由 AIView.characterization.test.tsx + 全量 vitest 守护。
 *
 * Source: plan/large-file-split-batch step 26
 */
import { describe, it, expect, vi } from 'vitest'
import { MessageList } from '@/components/AI/MessageList'
import { InputArea } from '@/components/AI/InputArea'
import { useAiHistory } from '@/hooks/useAiHistory'
import { useAiContextMenu } from '@/hooks/useAiContextMenu'

// MarkdownRenderer 拉取 react-markdown/shiki/katex 等重组件, 静态 mock 在模块图构建阶段生效
vi.mock('@/components/AI/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('AIView components split', () => {
  it('MessageList component exists', () => {
    expect(MessageList).toBeDefined()
    expect(typeof MessageList).toBe('function')
  })

  it('InputArea component exists', () => {
    expect(InputArea).toBeDefined()
    expect(typeof InputArea).toBe('function')
  })

  it('useAiHistory hook exists', () => {
    expect(useAiHistory).toBeDefined()
    expect(typeof useAiHistory).toBe('function')
  })

  it('useAiContextMenu hook exists', () => {
    expect(useAiContextMenu).toBeDefined()
    expect(typeof useAiContextMenu).toBe('function')
  })
})
