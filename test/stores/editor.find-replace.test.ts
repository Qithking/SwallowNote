/**
 * EditorToolbarConfig.showFindReplace 字段测试
 * Source: plan/editor-find-replace step 2, AC-14
 */
import { describe, it, expect } from 'vitest'
import type { EditorToolbarConfig } from '@/stores/editor'

describe('EditorToolbarConfig.showFindReplace', () => {
  it('should accept showFindReplace field', () => {
    const config: EditorToolbarConfig = {
      showFindReplace: true,
    }
    expect(config.showFindReplace).toBe(true)
  })

  it('should accept showFindReplace set to false', () => {
    const config: EditorToolbarConfig = {
      showFindReplace: false,
    }
    expect(config.showFindReplace).toBe(false)
  })

  it('should make showFindReplace optional (default true)', () => {
    const config: EditorToolbarConfig = {}
    // 字段不存在时,消费方默认 true;这里只验证字段是 optional
    expect(config.showFindReplace).toBeUndefined()
  })
})
