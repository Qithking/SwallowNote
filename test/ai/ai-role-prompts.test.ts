/**
 * P003 - 角色提示词 CRUD 测试
 *
 * 验证角色提示词的加载、新增、更新、删除、重置、名称修改等行为
 * 通过 Tauri invoke 正确序列化参数并返回预期数据。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  loadAiRolePrompts,
  getAiRolePrompt,
  addAiRolePrompt,
  updateAiRolePrompt,
  deleteAiRolePrompt,
  updateAiRolePromptName,
  resetAiRolePrompt,
  type AiRolePrompt,
} from '@/lib/tauri'

const makeRole = (overrides: Partial<AiRolePrompt> = {}): AiRolePrompt => ({
  id: 1,
  role_key: 'custom_role',
  name: '自定义角色',
  prompt: '你是一个测试角色',
  is_builtin: false,
  created_at: '2026-06-17 10:00:00',
  updated_at: '2026-06-17 10:00:00',
  ...overrides,
})

describe('P003: 角色提示词 CRUD 测试', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('P003-01: loadAiRolePrompts 加载全部角色', async () => {
    const roles = [
      makeRole({ role_key: 'chat', name: '智能问答', is_builtin: true }),
      makeRole({ role_key: 'custom_role', name: '自定义' }),
    ]
    vi.mocked(invoke).mockResolvedValueOnce(roles)

    const result = await loadAiRolePrompts()

    expect(invoke).toHaveBeenCalledWith('load_ai_role_prompts')
    expect(result).toHaveLength(2)
    expect(result[0].is_builtin).toBe(true)
  })

  it('P003-02: getAiRolePrompt 通过 roleKey 查询', async () => {
    const role = makeRole({ role_key: 'chat', is_builtin: true })
    vi.mocked(invoke).mockResolvedValueOnce(role)

    const result = await getAiRolePrompt('chat')

    expect(invoke).toHaveBeenCalledWith('get_ai_role_prompt', { roleKey: 'chat' })
    expect(result?.role_key).toBe('chat')
  })

  it('P003-03: getAiRolePrompt 在角色不存在时返回 null', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)

    const result = await getAiRolePrompt('not_exist')

    expect(result).toBeNull()
  })

  it('P003-04: addAiRolePrompt 新增自定义角色', async () => {
    const newRole = makeRole({ role_key: 'new_role', name: '新角色', prompt: '你是一个新角色' })
    vi.mocked(invoke).mockResolvedValueOnce(newRole)

    const result = await addAiRolePrompt('new_role', '新角色', '你是一个新角色')

    expect(invoke).toHaveBeenCalledWith('add_ai_role_prompt', {
      roleKey: 'new_role',
      name: '新角色',
      prompt: '你是一个新角色',
    })
    expect(result.role_key).toBe('new_role')
  })

  it('P003-05: updateAiRolePrompt 更新角色 prompt', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await updateAiRolePrompt('custom_role', '新 prompt 内容')

    expect(invoke).toHaveBeenCalledWith('update_ai_role_prompt', {
      roleKey: 'custom_role',
      prompt: '新 prompt 内容',
    })
  })

  it('P003-06: deleteAiRolePrompt 删除自定义角色', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await deleteAiRolePrompt('custom_role')

    expect(invoke).toHaveBeenCalledWith('delete_ai_role_prompt', { roleKey: 'custom_role' })
  })

  it('P003-07: deleteAiRolePrompt 拒绝删除内置角色时抛出错误', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Cannot delete built-in role'))

    await expect(deleteAiRolePrompt('chat')).rejects.toThrow('Cannot delete built-in role')
  })

  it('P003-08: updateAiRolePromptName 更新角色名称', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await updateAiRolePromptName('custom_role', '新的角色名')

    expect(invoke).toHaveBeenCalledWith('update_ai_role_prompt_name', {
      roleKey: 'custom_role',
      name: '新的角色名',
    })
  })

  it('P003-09: resetAiRolePrompt 重置为默认 prompt', async () => {
    const resetRole = makeRole({
      role_key: 'polish',
      name: '润色',
      prompt: '默认润色 prompt',
      is_builtin: true,
    })
    vi.mocked(invoke).mockResolvedValueOnce(resetRole)

    const result = await resetAiRolePrompt('polish')

    expect(invoke).toHaveBeenCalledWith('reset_ai_role_prompt', { roleKey: 'polish' })
    expect(result.prompt).toBe('默认润色 prompt')
  })

  it('P003-10: 内置角色列表应包含补全/改写/解释 3 个新角色', async () => {
    const roles = [
      makeRole({ role_key: 'chat', name: '智能问答', is_builtin: true }),
      makeRole({ role_key: 'complete', name: '补全', is_builtin: true }),
      makeRole({ role_key: 'rewrite', name: '改写', is_builtin: true }),
      makeRole({ role_key: 'explain', name: '解释', is_builtin: true }),
    ]
    vi.mocked(invoke).mockResolvedValueOnce(roles)

    const result = await loadAiRolePrompts()
    const builtinKeys = result.filter((r) => r.is_builtin).map((r) => r.role_key)

    expect(builtinKeys).toContain('complete')
    expect(builtinKeys).toContain('rewrite')
    expect(builtinKeys).toContain('explain')
  })
})
