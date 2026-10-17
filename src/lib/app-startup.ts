import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export function logTime(stage: string, t0: number) {
  const elapsed = Math.round(performance.now() - t0)
  logger.info('app', `[STARTUP-TIME] ${stage} t=${elapsed}`)
  try {
    // Tauri v2 参数按 camelCase 匹配 Rust 的 elapsed_ms
    invoke('log_startup_time', { stage, elapsedMs: elapsed }).catch((e) => logger.warn('app', 'log_startup_time failed', e))
  } catch { /* ignore */ }
}
