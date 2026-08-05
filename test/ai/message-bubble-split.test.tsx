/**
 * MessageBubble 子组件拆分结构验证测试
 *
 * 行为契约: 单条消息渲染逻辑从 MessageList 抽取为 MessageBubble 后, 模块存在且被使用。
 * 行为保持不变由 AIView.characterization.test.tsx + 全量 vitest 守护。
 */
import { describe, it, expect, vi } from 'vitest'
import { MessageBubble } from '@/components/AI/MessageBubble'
import { MessageList } from '@/components/AI/MessageList'

vi.mock('@/components/AI/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('MessageBubble split', () => {
  it('MessageBubble component exists', () => {
    expect(MessageBubble).toBeDefined()
    expect(typeof MessageBubble).toBe('function')
  })

  it('MessageList imports MessageBubble', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = await fs.readFile(
      path.resolve('src/components/AI/MessageList.tsx'),
      'utf-8',
    )
    expect(file).toMatch(/from\s+['"]\.\/MessageBubble['"]/)
  })
})
