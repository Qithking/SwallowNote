import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '../logger'

export async function checkLatestVersion(): Promise<{ latest: string; current: string; hasUpdate: boolean } | null> {
  try {
    const packageJson = await import('../../../package.json')
    const current = packageJson.default.version
    // 走 Rust 后端避免 CORS / 504
    const [latest, hasUpdate] = await invoke<[string, boolean]>('check_latest_version', { currentVersion: current })
    return { latest, current, hasUpdate }
  } catch (e) {
    logger.error('tauri', 'Failed to check latest version:', e)
    return null
  }
}

export interface DownloadProgress {
  progress: number
  downloaded: number
  total: number
}

export interface DownloadComplete {
  path: string
}

export function downloadLatestRelease(
  onProgress: (progress: DownloadProgress) => void,
  onComplete: (path: string) => void,
  onError: (error: string) => void
): () => void {
  let unlistenProgress: (() => void) | null = null
  let unlistenComplete: (() => void) | null = null
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    unlistenProgress?.()
    unlistenComplete?.()
  }

  // async IIFE 保证监听器先注册再 invoke
  void (async () => {
    try {
      const fnProgress = await listen<DownloadProgress>('download-progress', (event) => {
        onProgress(event.payload)
      })
      // 注册期间可能已被调用方取消：立即卸载并放弃后续流程
      if (cleanedUp) { fnProgress(); return }
      unlistenProgress = fnProgress

      const fnComplete = await listen<DownloadComplete>('download-complete', (event) => {
        onComplete(event.payload.path)
        cleanup()
      })
      if (cleanedUp) { fnComplete(); return }
      unlistenComplete = fnComplete

      // 两个监听器均已注册，安全地触发后端下载
      await invoke('download_latest_release')
    } catch (e) {
      onError(String(e))
      cleanup()
    }
  })()

  return cleanup
}

export async function openInstaller(path: string): Promise<void> {
  await invoke('open_installer', { path })
}

export async function installAndRestart(dmgPath: string): Promise<void> {
  await invoke('install_and_restart', { dmgPath })
}
