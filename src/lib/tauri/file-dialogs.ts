import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'

// 路径分隔符统一为正斜杠
export function normalizePath(path: string | null): string | null {
  if (!path) return null
  return path.replace(/\\/g, '/')
}

// Dialog APIs
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  })
  return normalizePath(selected as string | null)
}

export async function openFileDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

export async function saveWorkspaceFileDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [
      { name: 'Swallow Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

// .zip 过滤的保存对话框
export async function savePluginConfigsDialog(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath: defaultPath ?? 'swallownote-plugin-configs.zip',
    filters: [
      { name: 'Zip archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

/**
 * Open dialog filtered to `.zip` for the plugin-configs import.
 * Multiple selection is disabled — a bundle is a single archive.
 */
export async function openPluginConfigsDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Zip archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

export async function openWorkspaceDialog(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: 'Workspace', extensions: ['swallow-workspace'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected as string | null)
}

// ===== 日志导出（Source: spec/settings-log-export-update-channel AC-3）=====

// 导出日志默认文件名：SwallowNote-logs-YYYYMMDD.zip（按当天日期生成）
function logExportDefaultName(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `SwallowNote-logs-${d.getFullYear()}${mm}${dd}.zip`
}

// 弹出导出日志的保存对话框（zip 过滤，默认名 SwallowNote-logs-YYYYMMDD.zip）
export async function saveLogExportDialog(): Promise<string | null> {
  const selected = await save({
    defaultPath: logExportDefaultName(),
    filters: [
      { name: 'Zip archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return normalizePath(selected)
}

// 导出日志：打包日志目录全部轮转日志写入 dest，返回导出文件数（0 个时后端返回 NO_LOGS 错误）
export async function exportLogs(dest: string): Promise<number> {
  return invoke<number>('export_logs', { dest })
}

// 打开日志目录（系统文件管理器）
export async function openLogDir(): Promise<void> {
  await invoke('open_log_dir')
}
