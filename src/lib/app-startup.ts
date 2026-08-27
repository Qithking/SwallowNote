import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export function logTime(stage: string, t0: number) {
  const elapsed = Math.round(performance.now() - t0)
  logger.info('app', `[STARTUP-TIME] ${stage} t=${elapsed}`)
  try {
    invoke('log_startup_time', { stage, elapsed_ms: elapsed }).catch((e) => logger.warn('app', 'log_startup_time failed', e))
  } catch { /* ignore */ }
}
