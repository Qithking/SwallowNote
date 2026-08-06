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
