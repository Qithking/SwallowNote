/** registerActions 单测（P2.5）：payload 组装规则（选区优先/无选区全文/兜底链） */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// SDK 编辑器 API 全部走模块级函数，测试中 mock 以隔离宿主桥
vi.mock('@swallow-note/plugin-sdk', () => ({
  registerContextMenu: vi.fn(),
  openPluginPanel: vi.fn(),
  editor: {
    getSelection: vi.fn(),
    getActiveContent: vi.fn(),
  },
}))

import { editor } from '@swallow-note/plugin-sdk'
import { buildRoleActionPayload } from './registerActions'
import type { ContextMenuContext } from '@swallow-note/plugin-sdk'

const mockedSel = editor.getSelection as ReturnType<typeof vi.fn>
const mockedContent = editor.getActiveContent as ReturnType<typeof vi.fn>

const baseCtx: ContextMenuContext = {
  location: 'editor',
  path: '/ws/notes/todo.md',
  selection: '菜单快照选区',
}

describe('buildRoleActionPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有选区：content 用实时选区文本，携带行号范围', async () => {
    mockedSel.mockResolvedValue({ text: '选中的正文', lineRange: [3, 7] })

    const payload = await buildRoleActionPayload('polish', '润色', baseCtx)

    expect(payload.type).toBe('role-action')
    expect(payload.roleKey).toBe('polish')
    expect(payload.roleName).toBe('润色')
    expect(payload.hasSelection).toBe(true)
    expect(payload.content).toBe('选中的正文')
    expect(payload.lineRange).toEqual([3, 7])
    expect(payload.filePath).toBe('/ws/notes/todo.md')
    expect(payload.id).toBeTruthy()
    // 无选区路径不应触发全文查询
    expect(mockedContent).not.toHaveBeenCalled()
  })

  it('无选区：回退全文内容，无行号', async () => {
    mockedSel.mockResolvedValue(null)
    mockedContent.mockResolvedValue('# 全文内容\n\n段落')

    const payload = await buildRoleActionPayload('summary', '摘要', { ...baseCtx, selection: undefined })

    expect(payload.hasSelection).toBe(false)
    expect(payload.content).toBe('# 全文内容\n\n段落')
    expect(payload.lineRange).toBeUndefined()
    expect(mockedContent).toHaveBeenCalledTimes(1)
  })

  it('getSelection 异常但 ctx.selection 有值：用快照兜底，视为有选区', async () => {
    mockedSel.mockResolvedValue(null)

    const payload = await buildRoleActionPayload('rewrite', '改写', baseCtx)

    expect(payload.hasSelection).toBe(true)
    expect(payload.content).toBe('菜单快照选区')
  })

  it('全文查询返回 null（编辑器未挂载）：content 兜底空串', async () => {
    mockedSel.mockResolvedValue(null)
    mockedContent.mockResolvedValue(null)

    const payload = await buildRoleActionPayload('explain', '解释', { ...baseCtx, selection: undefined })

    expect(payload.hasSelection).toBe(false)
    expect(payload.content).toBe('')
  })
})
