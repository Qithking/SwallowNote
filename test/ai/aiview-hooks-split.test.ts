/**
 * AIView hooks 拆分结构验证测试
 *
 * 行为契约: 4 个 hooks 从 AIView.tsx 抽取后模块存在且导出函数。
 * 行为保持不变由 AIView.characterization.test.tsx + 全量 vitest 守护。
 *
 * Source: plan/large-file-split-batch step 22-25
 */
import { describe, it, expect } from 'vitest'

describe('AIView hooks split', () => {
  it('useAiMessageDisplay hook exists', async () => {
    const mod = await import('@/hooks/useAiMessageDisplay')
    expect(mod.useAiMessageDisplay).toBeDefined()
    expect(typeof mod.useAiMessageDisplay).toBe('function')
  })

  it('useAiScroll hook exists', async () => {
    const mod = await import('@/hooks/useAiScroll')
    expect(mod.useAiScroll).toBeDefined()
    expect(typeof mod.useAiScroll).toBe('function')
  })

  it('useAiMessageTrimming hook exists', async () => {
    const mod = await import('@/hooks/useAiMessageTrimming')
    expect(mod.useAiMessageTrimming).toBeDefined()
    expect(typeof mod.useAiMessageTrimming).toBe('function')
  })

  it('useAiChat hook exists', async () => {
    const mod = await import('@/hooks/useAiChat')
    expect(mod.useAiChat).toBeDefined()
    expect(typeof mod.useAiChat).toBe('function')
  })
})
