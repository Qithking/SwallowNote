/**
 * useAiRolePrompts hook 拆分结构验证测试
 *
 * 行为契约: AiRolePromptsSettings 的状态和 CRUD 操作抽取为 hook 后, 模块存在且被使用。
 * 行为保持不变由 settings-split.test.ts + 全量 vitest 守护。
 */
import { describe, it, expect, vi } from 'vitest'
import { useAiRolePrompts } from '@/hooks/useAiRolePrompts'
import { renderHook } from '@testing-library/react'
import type { AiRolePrompt } from '@/lib/tauri'

vi.mock('@/lib/tauri', () => ({
  loadAiRolePrompts: vi.fn().mockResolvedValue([]),
  addAiRolePrompt: vi.fn(),
  deleteAiRolePrompt: vi.fn(),
  updateAiRolePrompt: vi.fn(),
  updateAiRolePromptName: vi.fn(),
  resetAiRolePrompt: vi.fn(),
}))

describe('useAiRolePrompts split', () => {
  it('hook exists and returns expected shape', async () => {
    expect(useAiRolePrompts).toBeDefined()
    expect(typeof useAiRolePrompts).toBe('function')
  })

  it('returns rolePrompts array and operations', async () => {
    const { result } = renderHook(() => useAiRolePrompts())
    expect(result.current.rolePrompts).toBeDefined()
    expect(Array.isArray(result.current.rolePrompts)).toBe(true)
    expect(result.current.selectedRoleKey).toBeNull()
    expect(result.current.selectedRolePrompt).toBeUndefined()
    expect(typeof result.current.setSelectedRoleKey).toBe('function')
    expect(typeof result.current.addRole).toBe('function')
    expect(typeof result.current.deleteRole).toBe('function')
    expect(typeof result.current.updatePrompt).toBe('function')
    expect(typeof result.current.renameRole).toBe('function')
    expect(typeof result.current.resetRole).toBe('function')
    expect(typeof result.current.resetAllRoles).toBe('function')
  })
})

describe('useAiRolePrompts AiRolePromptsSettings import', () => {
  it('AiRolePromptsSettings imports useAiRolePrompts', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = await fs.readFile(
      path.resolve('src/components/Settings/panels/AiRolePromptsSettings.tsx'),
      'utf-8',
    )
    expect(file).toMatch(/from\s+['"]@\/hooks\/useAiRolePrompts['"]/)
  })
})
