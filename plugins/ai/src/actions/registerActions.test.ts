/** registerActions 单测（P2.5）：payload 组装规则（选区优先/无选区全文/兜底链） */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// SDK 编辑器/文件 API 全部走模块级函数，测试中 mock 以隔离宿主桥
vi.mock('@swallow-note/plugin-sdk', () => ({
  registerContextMenu: vi.fn(),
  openPluginPanel: vi.fn(),
  editor: {
    getSelection: vi.fn(),
    getActiveContent: vi.fn(),
  },
  files: {
    read: vi.fn(),
  },
}))

import { editor, files, registerContextMenu, openPluginPanel } from '@swallow-note/plugin-sdk'
import {
  buildRoleActionPayload,
  buildFileAttachPayload,
  buildAttachPrefill,
  registerFileTreeAction,
} from './registerActions'
import type { ContextMenuContext } from '@swallow-note/plugin-sdk'

const mockedSel = editor.getSelection as ReturnType<typeof vi.fn>
const mockedContent = editor.getActiveContent as ReturnType<typeof vi.fn>
const mockedRead = files.read as ReturnType<typeof vi.fn>

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

describe('buildFileAttachPayload（文件树右键「添加到 AI 对话」）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('文件节点：读文件内容并组装 payload（含路径与文件名）', async () => {
    mockedRead.mockResolvedValue('# todo\n内容')

    const payload = await buildFileAttachPayload({ location: 'fileTree', path: 'notes/todo.md' })

    expect(payload).not.toBeNull()
    expect(payload?.type).toBe('file-attach')
    expect(payload?.path).toBe('notes/todo.md')
    expect(payload?.name).toBe('todo.md')
    expect(payload?.content).toBe('# todo\n内容')
    expect(payload?.id).toBeTruthy()
    expect(mockedRead).toHaveBeenCalledWith('notes/todo.md')
  })

  it('目录 / 空路径：返回 null 且不读文件', async () => {
    await expect(
      buildFileAttachPayload({ location: 'fileTree', path: 'notes', isDirectory: true })
    ).resolves.toBeNull()
    await expect(buildFileAttachPayload({ location: 'fileTree' })).resolves.toBeNull()
    expect(mockedRead).not.toHaveBeenCalled()
  })
})

describe('buildAttachPrefill 预填文本', () => {
  it('包含路径与全文，末尾留空行便于补充问题', () => {
    const text = buildAttachPrefill('notes/todo.md', '内容')
    expect(text).toContain('notes/todo.md')
    expect(text).toContain('内容')
    expect(text.endsWith('\n\n')).toBe(true)
  })
})

describe('registerFileTreeAction 注册', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('注册到 fileTree 位置，when 过滤目录节点', () => {
    registerFileTreeAction()
    expect(registerContextMenu).toHaveBeenCalledTimes(1)
    const [, item] = (registerContextMenu as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { label: string; locations: string[]; when: (ctx: ContextMenuContext) => boolean; onClick: (ctx: ContextMenuContext) => Promise<void> },
    ]
    expect(item.label).toBe('添加到 AI 对话')
    expect(item.locations).toEqual(['fileTree'])
    expect(item.when({ location: 'fileTree', path: 'a.md' })).toBe(true)
    expect(item.when({ location: 'fileTree', path: 'dir', isDirectory: true })).toBe(false)
  })

  it('onClick：payload 构建成功则打开面板；失败（如无权限）静默 warn 不打开', async () => {
    registerFileTreeAction()
    const [, item] = (registerContextMenu as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { onClick: (ctx: ContextMenuContext) => Promise<void> },
    ]
    const onClick = item.onClick

    mockedRead.mockResolvedValueOnce('内容')
    await onClick({ location: 'fileTree', path: 'a.md' })
    expect(openPluginPanel).toHaveBeenCalledTimes(1)
    expect(openPluginPanel).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file-attach', path: 'a.md', content: '内容' })
    )

    ;(openPluginPanel as ReturnType<typeof vi.fn>).mockClear()
    mockedRead.mockRejectedValueOnce(new Error('denied'))
    await onClick({ location: 'fileTree', path: 'a.md' })
    expect(openPluginPanel).not.toHaveBeenCalled()
  })
})
