/**
 * P1.2 编辑器写 API / 工作区文件 API 桥接单测（P1.3 增补选区查询）。
 *
 * 覆盖方案 §6.2 的安全关键路径：
 * 1. 权限拒绝：无 editor-write / files 授权时抛 PluginPermissionDeniedError
 * 2. replaceSelection 回执：无监听者超时 false、监听者拒绝 false、接受 true
 * 3. getSelection 三态：有选区回执数据、无选区 null、无监听者超时 null
 * 4. 路径安全：`..` 逃逸拒绝、反斜杠归一、绝对路径折叠进根内
 * 5. createNote 防覆盖与调用顺序
 * 6. listWorkspace 相对路径输出与大小写不敏感过滤
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PluginPermissionDeniedError, setGranted, clearAll } from '../plugin-permission-guard'

// file-ops 全部 mock（Tauri invoke 边界）
const fileOps = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  pathExists: vi.fn(),
  createFile: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock('../tauri/file-ops', () => fileOps)

// workspace store mock：桥接只消费 getState().rootPath
const wsState = vi.hoisted(() => ({ rootPath: null as string | null }))
vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: { getState: () => wsState },
}))

import {
  pluginEditorInsertAtCursor,
  pluginEditorGetSelection,
  pluginEditorReplaceSelection,
  pluginEditorReplaceContent,
  pluginFilesCreateNote,
  pluginFilesListWorkspace,
  pluginFilesRead,
} from '../plugin-write-api'

const PID = 'test-plugin'

/** 构造 FileNode 形状的 mock 节点 */
function node(name: string, path: string, isDirectory: boolean) {
  return { id: name, name, path, is_directory: isDirectory }
}

beforeEach(() => {
  clearAll()
  vi.clearAllMocks()
  wsState.rootPath = '/ws'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('权限门禁（editor-write / files）', () => {
  it('无 editor-write 权限：editor.insertAtCursor 抛 PluginPermissionDeniedError', async () => {
    await expect(pluginEditorInsertAtCursor(PID, 'hi')).rejects.toBeInstanceOf(
      PluginPermissionDeniedError
    )
  })

  it('无 editor-write 权限：replaceSelection / replaceContent 同样拒绝', async () => {
    await expect(pluginEditorReplaceSelection(PID, 'hi')).rejects.toMatchObject({
      permission: 'editor-write',
    })
    await expect(pluginEditorReplaceContent(PID, 'hi')).rejects.toMatchObject({
      permission: 'editor-write',
    })
  })

  it('无 files 权限：createNote / listWorkspace 抛错且 permission 为 files', async () => {
    await expect(pluginFilesCreateNote(PID, 'a.md', 'x')).rejects.toMatchObject({
      permission: 'files',
    })
    await expect(pluginFilesListWorkspace(PID)).rejects.toMatchObject({
      permission: 'files',
    })
  })

  it('授权后 editor API 正常派发事件（不再抛错）', async () => {
    setGranted(PID, ['editor-write'])
    const seen: string[] = []
    const handler = (e: Event) => {
      seen.push((e as CustomEvent).detail.text)
      ;(e as CustomEvent).detail.__reply(true)
    }
    window.addEventListener('insert-at-cursor', handler)
    try {
      await expect(pluginEditorInsertAtCursor(PID, 'hi')).resolves.toBe(true)
    } finally {
      window.removeEventListener('insert-at-cursor', handler)
    }
    expect(seen).toEqual(['hi'])
  })
})

describe('编辑器写事件回执', () => {
  beforeEach(() => {
    setGranted(PID, ['editor-write'])
  })

  it('空文本：不派发事件直接返回 false', async () => {
    const spy = vi.fn()
    window.addEventListener('replace-selection', spy)
    try {
      await expect(pluginEditorReplaceSelection(PID, '')).resolves.toBe(false)
    } finally {
      window.removeEventListener('replace-selection', spy)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('无监听者（编辑器未挂载）：1s 超时兜底返回 false', async () => {
    vi.useFakeTimers()
    const promise = pluginEditorReplaceSelection(PID, 'hi')
    const assertion = expect(promise).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('监听者回执 false（模拟无选区拒绝）→ false', async () => {
    const handler = (e: Event) => (e as CustomEvent).detail.__reply(false)
    window.addEventListener('replace-selection', handler)
    try {
      await expect(pluginEditorReplaceSelection(PID, 'hi')).resolves.toBe(false)
    } finally {
      window.removeEventListener('replace-selection', handler)
    }
  })

  it('监听者回执 true（写入成功）→ true；重复回执以首个为准', async () => {
    const replies: Array<(ok: boolean) => void> = []
    const handler = (e: Event) => {
      replies.push((e as CustomEvent).detail.__reply)
      ;(e as CustomEvent).detail.__reply(true)
    }
    window.addEventListener('insert-at-cursor', handler)
    try {
      await expect(pluginEditorInsertAtCursor(PID, 'hi')).resolves.toBe(true)
    } finally {
      window.removeEventListener('insert-at-cursor', handler)
    }
    // 超时定时器已清理后迟到的 false 不影响结果
    replies[0]?.(false)
  })

  it('replaceContent 复用 replace-content 事件（无回执语义）', async () => {
    const seen: string[] = []
    const handler = (e: Event) => seen.push((e as CustomEvent).detail.text)
    window.addEventListener('replace-content', handler)
    try {
      await pluginEditorReplaceContent(PID, 'full text')
    } finally {
      window.removeEventListener('replace-content', handler)
    }
    expect(seen).toEqual(['full text'])
  })
})

describe('选区查询（P1.3：getSelection 三态）', () => {
  it('无 editor-write 权限：抛 PluginPermissionDeniedError', async () => {
    await expect(pluginEditorGetSelection(PID)).rejects.toBeInstanceOf(PluginPermissionDeniedError)
  })

  it('授权后有监听者回执 { text, lineRange }：原样返回', async () => {
    setGranted(PID, ['editor-write'])
    const handler = (e: Event) => {
      // 桥接不派发 text：查询型事件 detail 只含 __reply
      expect((e as CustomEvent).detail.text).toBeUndefined()
      ;(e as CustomEvent).detail.__reply({ text: 'selected', lineRange: [3, 5] })
    }
    window.addEventListener('query-selection', handler)
    try {
      await expect(pluginEditorGetSelection(PID)).resolves.toEqual({
        text: 'selected',
        lineRange: [3, 5],
      })
    } finally {
      window.removeEventListener('query-selection', handler)
    }
  })

  it('监听者回执 null（无选区）→ null', async () => {
    setGranted(PID, ['editor-write'])
    const handler = (e: Event) => (e as CustomEvent).detail.__reply(null)
    window.addEventListener('query-selection', handler)
    try {
      await expect(pluginEditorGetSelection(PID)).resolves.toBeNull()
    } finally {
      window.removeEventListener('query-selection', handler)
    }
  })

  it('无监听者（编辑器未挂载）：1s 超时兜底返回 null', async () => {
    setGranted(PID, ['editor-write'])
    vi.useFakeTimers()
    const promise = pluginEditorGetSelection(PID)
    const assertion = expect(promise).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })
})

describe('createNote 路径安全与防覆盖', () => {
  beforeEach(() => {
    setGranted(PID, ['files'])
  })

  it('`..` 逃逸拒绝：不触碰文件系统', async () => {
    await expect(pluginFilesCreateNote(PID, '../evil.md', 'x')).rejects.toThrow(/invalid workspace path/)
    await expect(pluginFilesCreateNote(PID, 'sub/../../evil.md', 'x')).rejects.toThrow(
      /invalid workspace path/
    )
    expect(fileOps.pathExists).not.toHaveBeenCalled()
    expect(fileOps.createFile).not.toHaveBeenCalled()
  })

  it('空路径 / 纯 `.` 段拒绝', async () => {
    await expect(pluginFilesCreateNote(PID, '', 'x')).rejects.toThrow(/invalid workspace path/)
    await expect(pluginFilesCreateNote(PID, './', 'x')).rejects.toThrow(/invalid workspace path/)
  })

  it('正常创建：反斜杠归一 + createFile 先建空文件 + writeFile 写内容', async () => {
    fileOps.pathExists.mockResolvedValue(false)
    const order: string[] = []
    fileOps.createFile.mockImplementation(async () => {
      order.push('createFile')
      return '/ws/sub/note.md'
    })
    fileOps.writeFile.mockImplementation(async () => {
      order.push('writeFile')
    })
    await pluginFilesCreateNote(PID, 'sub\\note.md', 'content')
    expect(fileOps.createFile).toHaveBeenCalledWith('/ws/sub/note.md', false)
    expect(fileOps.writeFile).toHaveBeenCalledWith('/ws/sub/note.md', 'content')
    expect(order).toEqual(['createFile', 'writeFile'])
  })

  it('目标已存在：抛错且不调 createFile（防覆盖）', async () => {
    fileOps.pathExists.mockResolvedValue(true)
    await expect(pluginFilesCreateNote(PID, 'a.md', 'x')).rejects.toThrow(/already exists/)
    expect(fileOps.createFile).not.toHaveBeenCalled()
    expect(fileOps.writeFile).not.toHaveBeenCalled()
  })

  it('无工作区打开：抛错', async () => {
    wsState.rootPath = null
    await expect(pluginFilesCreateNote(PID, 'a.md', 'x')).rejects.toThrow(/no workspace open/)
  })
})

describe('listWorkspace 递归与过滤', () => {
  beforeEach(() => {
    setGranted(PID, ['files'])
  })

  it('递归列出 Markdown 文件并返回正斜杠相对路径', async () => {
    fileOps.listDirectory.mockImplementation(async (dirAbs: string) => {
      if (dirAbs === '/ws') {
        return [node('sub', '/ws/sub', true), node('top.md', '/ws/top.md', false)]
      }
      if (dirAbs === '/ws/sub') {
        return [node('a.md', '/ws/sub/a.md', false), node('note.md', '/ws/sub/note.md', false)]
      }
      return []
    })
    await expect(pluginFilesListWorkspace(PID)).resolves.toEqual([
      'sub/a.md',
      'sub/note.md',
      'top.md',
    ])
  })

  it('query 大小写不敏感子串过滤', async () => {
    fileOps.listDirectory.mockResolvedValue([
      node('Alpha.md', '/ws/Alpha.md', false),
      node('beta.md', '/ws/beta.md', false),
    ])
    await expect(pluginFilesListWorkspace(PID, 'ALP')).resolves.toEqual(['Alpha.md'])
  })

  it('无工作区打开：抛错', async () => {
    wsState.rootPath = null
    await expect(pluginFilesListWorkspace(PID)).rejects.toThrow(/no workspace open/)
  })
})

describe('files.read 按路径读取（右键「添加到 AI 对话」底座）', () => {
  beforeEach(() => {
    setGranted(PID, ['files'])
  })

  it('无 files 权限：抛 PluginPermissionDeniedError', async () => {
    clearAll()
    await expect(pluginFilesRead(PID, 'a.md')).rejects.toBeInstanceOf(PluginPermissionDeniedError)
  })

  it('正常读取：反斜杠归一后派发 readFile', async () => {
    fileOps.readFile.mockResolvedValue('# hello')
    await expect(pluginFilesRead(PID, 'sub\\note.md')).resolves.toBe('# hello')
    expect(fileOps.readFile).toHaveBeenCalledWith('/ws/sub/note.md')
  })

  it('`..` 逃逸拒绝：不触碰文件系统', async () => {
    await expect(pluginFilesRead(PID, '../evil.md')).rejects.toThrow(/invalid workspace path/)
    expect(fileOps.readFile).not.toHaveBeenCalled()
  })

  it('绝对路径（宿主 ctx.path 一贯语义，如文件树右键）：rootPath 之下正确解析', async () => {
    fileOps.readFile.mockResolvedValue('# abs')
    await expect(pluginFilesRead(PID, '/ws/notes/todo.md')).resolves.toBe('# abs')
    expect(fileOps.readFile).toHaveBeenCalledWith('/ws/notes/todo.md')
  })

  it('绝对路径在工作区之外：拒绝且不触碰文件系统（维持沙箱）', async () => {
    await expect(pluginFilesRead(PID, '/etc/evil.md')).rejects.toThrow(/outside workspace/)
    expect(fileOps.readFile).not.toHaveBeenCalled()
  })

  it('无工作区打开：抛错', async () => {
    wsState.rootPath = null
    await expect(pluginFilesRead(PID, 'a.md')).rejects.toThrow(/no workspace open/)
  })

  it('超长文件截断并附加标记；恰好上限不截断', async () => {
    fileOps.readFile.mockResolvedValue('x'.repeat(200_001))
    const truncated = await pluginFilesRead(PID, 'big.md')
    expect(truncated.startsWith('x'.repeat(200_000))).toBe(true)
    expect(truncated).toContain('已截断')
    fileOps.readFile.mockResolvedValue('x'.repeat(200_000))
    await expect(pluginFilesRead(PID, 'big.md')).resolves.toBe('x'.repeat(200_000))
  })
})
