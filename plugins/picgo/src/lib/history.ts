/**
 * Upload history persistence.
 *
 * History is stored in the plugin's `PluginStorage` namespace
 * under the `picgo-history` key as a JSON-serializable
 * `UploadResult[]`. The list is capped at `historyRetention`
 * entries (FIFO) on every write.
 */
import type { PluginStorage } from '../types'
import type { UploadResult } from '../types'

export const HISTORY_KEY = 'picgo-history'

export async function loadHistory(
  store: PluginStorage
): Promise<UploadResult[]> {
  try {
    const list = await store.get<UploadResult[]>(HISTORY_KEY)
    if (!Array.isArray(list)) return []
    return list.filter(
      (r) => r && typeof r === 'object' && typeof r.url === 'string'
    )
  } catch (err) {
    console.warn('[picgo] loadHistory failed:', err)
    return []
  }
}

function trimToCapacity(
  list: UploadResult[],
  retention: number
): UploadResult[] {
  const cap = Math.max(1, Math.floor(retention))
  if (list.length <= cap) return list
  return list.slice(list.length - cap)
}

/**
 * Append a successful upload to history, applying the FIFO cap.
 *
 * @param store Plugin storage handle
 * @param entry The upload result to append
 * @param retention Maximum number of entries to keep
 */
export async function appendHistory(
  store: PluginStorage,
  entry: UploadResult,
  retention: number
): Promise<UploadResult[]> {
  const current = await loadHistory(store)
  const next = trimToCapacity([...current, entry], retention)
  await store.set(HISTORY_KEY, next)
  return next
}

/**
 * Remove a single history entry by its URL. Used by the
 * 「图床历史」 tab's delete button.
 */
export async function removeHistoryEntry(
  store: PluginStorage,
  url: string,
  retention: number
): Promise<UploadResult[]> {
  const current = await loadHistory(store)
  const next = trimToCapacity(
    current.filter((r) => r.url !== url),
    retention
  )
  await store.set(HISTORY_KEY, next)
  return next
}

/** Wipe all history (「清空历史」 button). */
export async function clearHistory(store: PluginStorage): Promise<void> {
  await store.set(HISTORY_KEY, [])
}
