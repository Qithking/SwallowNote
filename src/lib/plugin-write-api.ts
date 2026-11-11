/**
 * 插件编辑器写/读 API 与工作区文件 API 的共享桥接。
 *
 * 供两处消费：
 * 1. plugin-host-takeover.ts（SDK HostOverrides 的 __editor_* / __files_* override，生命周期 hook 场景）
 * 2. plugin-utils.tsx（PluginPanelProps / ToolbarButtonProps 的 editor / files 成员，面板场景）
 *
 * 权限检查在此内聚：所有函数按调用方传入的 pluginId 走 assertPermission，
 * 面板场景由 props 闭包保证 pluginId 正确，避免模块级 API 多插件并发时的解析歧义。
 */
import { assertPermission } from './plugin-permission-guard'
import { useWorkspaceStore } from '@/stores/workspace'
import type { PluginEditorSelection } from '@/types/plugin'
import { listDirectory, pathExists, createFile, writeFile, readFile } from './tauri/file-ops'

/** 编辑器写事件回执的超时兜底：编辑器未挂载/无监听者场景 1s 后回执 false。 */
const EDITOR_WRITE_REPLY_TIMEOUT_MS = 1000
/** 全文序列化（blocksToMarkdownLossy）在大文档上可能超过 1s，单独放宽（P2.5）。 */
const EDITOR_CONTENT_REPLY_TIMEOUT_MS = 5000

/** 派发编辑器事件并等待回执；旧派发方（editorStore）不带 __reply 自动兼容，超时以 timeoutResult 兜底。 */
function dispatchEditorEvent<T>(
  eventName: string,
  detail: Record<string, unknown>,
  timeoutResult: T,
  timeoutMs: number = EDITOR_WRITE_REPLY_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish(timeoutResult), timeoutMs)
    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { ...detail, __reply: (result: T) => finish(result) },
      })
    )
  })
}

/** 将插件传入的相对路径规范化为工作区内绝对路径；绝对路径限根内直接使用（宿主 ctx.path 一贯为绝对路径），根外拒绝，`..` 逃逸直接拒绝。 */
function resolveWorkspacePath(relPath: string, rootPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').trim()
  const rootNorm = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  // 绝对路径分支：根内放行（文件树/编辑器/Tab 传给插件的 ctx.path 均为绝对路径），根外维持沙箱
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    if (normalized === rootNorm || normalized.startsWith(`${rootNorm}/`)) {
      return normalized
    }
    throw new Error(`[plugin-write-api] path outside workspace: "${relPath}"`)
  }
  const segments = normalized.split('/').filter((s) => s.length > 0 && s !== '.')
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error(`[plugin-write-api] invalid workspace path: "${relPath}"`)
  }
  return `${rootNorm}/${segments.join('/')}`
}

/** 递归列出目录下全部 Markdown 文件（复用 list_directory 的 markdown_only 过滤），返回相对路径。 */
async function listMarkdownFiles(dirAbs: string, relBase: string): Promise<string[]> {
  const nodes = await listDirectory(dirAbs, false, true)
  const out: string[] = []
  for (const node of nodes) {
    if (node.is_directory) {
      out.push(...(await listMarkdownFiles(node.path, relBase ? `${relBase}/${node.name}` : node.name)))
    } else {
      out.push(relBase ? `${relBase}/${node.name}` : node.name)
    }
  }
  return out
}

/** 编辑器写 API：光标处插入文本，回执执行结果（编辑器未挂载时超时兜底 false）。 */
export async function pluginEditorInsertAtCursor(pluginId: string, text: string): Promise<boolean> {
  assertPermission(pluginId, 'editor-write', 'editor.insertAtCursor')
  if (!text) return false
  return dispatchEditorEvent('insert-at-cursor', { text }, false)
}

/** 编辑器写 API：替换当前选区，无选区/未挂载时回执 false（绝不整文替换，见方案 §6.2）。 */
export async function pluginEditorReplaceSelection(pluginId: string, text: string): Promise<boolean> {
  assertPermission(pluginId, 'editor-write', 'editor.replaceSelection')
  if (!text) return false
  return dispatchEditorEvent('replace-selection', { text }, false)
}

/** 编辑器写 API：整文替换（复用 replace-content 事件，与 editorStore 派发同语义）。 */
export async function pluginEditorReplaceContent(pluginId: string, text: string): Promise<void> {
  assertPermission(pluginId, 'editor-write', 'editor.replaceContent')
  window.dispatchEvent(new CustomEvent('replace-content', { detail: { text } }))
}

/** 编辑器读 API：查询当前选区（文本 + 1-based 行号范围），无选区/编辑器未挂载超时兜底 null（P1.3）。 */
export async function pluginEditorGetSelection(pluginId: string): Promise<PluginEditorSelection | null> {
  assertPermission(pluginId, 'editor-write', 'editor.getSelection')
  return dispatchEditorEvent('query-selection', {}, null)
}

/** 编辑器读 API：查询当前笔记全文（markdown 源码），无笔记/未挂载超时兜底 null（P2.5，用户确认新增）。 */
export async function pluginEditorGetActiveContent(pluginId: string): Promise<string | null> {
  assertPermission(pluginId, 'editor-write', 'editor.getActiveContent')
  return dispatchEditorEvent('query-content', {}, null, EDITOR_CONTENT_REPLY_TIMEOUT_MS)
}

/** 文件 API：在工作区内创建笔记（已存在抛错；createFile 先建空文件防覆盖，writeFile 自动建父目录）。 */
export async function pluginFilesCreateNote(pluginId: string, relPath: string, content: string): Promise<void> {
  assertPermission(pluginId, 'files', 'files.createNote')
  const rootPath = useWorkspaceStore.getState().rootPath
  if (!rootPath) {
    throw new Error('[plugin-write-api] files.createNote: no workspace open')
  }
  const abs = resolveWorkspacePath(relPath, rootPath)
  if (await pathExists(abs)) {
    throw new Error(`[plugin-write-api] files.createNote: "${relPath}" already exists`)
  }
  // createFile 对已存在文件拒绝（双重防覆盖），writeFile 自动创建缺失父目录
  await createFile(abs, false)
  await writeFile(abs, content)
}

/** 文件 API：递归列出工作区内 Markdown 文件（相对路径），query 大小写不敏感子串过滤。 */
export async function pluginFilesListWorkspace(pluginId: string, query?: string): Promise<string[]> {
  assertPermission(pluginId, 'files', 'files.listWorkspace')
  const rootPath = useWorkspaceStore.getState().rootPath
  if (!rootPath) {
    throw new Error('[plugin-write-api] files.listWorkspace: no workspace open')
  }
  const files = await listMarkdownFiles(rootPath, '')
  if (!query) return files
  const q = query.toLowerCase()
  return files.filter((p) => p.toLowerCase().includes(q))
}

/** 文件读取上限（字符数）：防超大文件撑爆插件面板，超出截断并附加标记。 */
const FILE_READ_MAX_CHARS = 200_000

/** 文件 API：按工作区相对路径读取文本文件内容（UTF-8），超长截断。 */
export async function pluginFilesRead(pluginId: string, relPath: string): Promise<string> {
  assertPermission(pluginId, 'files', 'files.read')
  const rootPath = useWorkspaceStore.getState().rootPath
  if (!rootPath) {
    throw new Error('[plugin-write-api] files.read: no workspace open')
  }
  const abs = resolveWorkspacePath(relPath, rootPath)
  const content = await readFile(abs)
  if (content.length > FILE_READ_MAX_CHARS) {
    return `${content.slice(0, FILE_READ_MAX_CHARS)}\n\n[文件过大，已截断至前 ${FILE_READ_MAX_CHARS} 字符]`
  }
  return content
}
