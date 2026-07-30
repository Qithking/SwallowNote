/**
 * MathBlock i18n 键路径一致性测试
 *
 * 验证 MathBlock 使用 editor.katex.* 命名空间,
 * 与 KatexBlockEditor 保持一致,而非 error.renderFailed / ai.emptyFormula。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// 捕获 t() 调用的键
const tCalls: string[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      tCalls.push(key)
      return key
    },
  }),
}))

// mock katex 为立即失败,触发错误分支
vi.mock('katex', () => ({
  default: {
    renderToString: () => {
      throw new Error('render error')
    },
  },
}))

describe('MathBlock i18n 键路径一致性', () => {
  beforeEach(() => {
    tCalls.length = 0
  })

  it('渲染失败时使用 editor.katex.renderFailed 而非 error.renderFailed', async () => {
    const { MathBlock } = await import('@/components/AI/MathBlock')
    render(<MathBlock formula="invalid" display={true} />)
    // 等待 useEffect 触发的异步渲染完成
    await waitFor(() => {
      expect(tCalls).toContain('editor.katex.renderFailed')
    })
    expect(tCalls).not.toContain('error.renderFailed')
  })

  it('空公式时使用 editor.katex.emptyFormula 而非 ai.emptyFormula', async () => {
    const { MathBlock } = await import('@/components/AI/MathBlock')
    render(<MathBlock formula="  " display={false} />)
    await waitFor(() => {
      expect(tCalls).toContain('editor.katex.emptyFormula')
    })
    expect(tCalls).not.toContain('ai.emptyFormula')
  })
})
