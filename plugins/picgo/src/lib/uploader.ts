/**
 * Uploader pipeline.
 *
 * 1. Read settings (host `getAllSettings`).
 * 2. Resolve the active provider (may be overridden per-call).
 * 3. Preprocess the file (MIME / size / canvas re-encode).
 * 4. Resolve the remote filename.
 * 5. Call the provider with a 30s timeout + AbortController.
 * 6. Append to history when `enableHistory` is true.
 *
 * Errors thrown from any step carry a message that the UI can
 * show verbatim (e.g. `SM.MS: image_repeated`).
 */
import type {
  AllSettings,
  PluginStorage,
  UploadFormat,
  UploadResult,
} from '../types'
import { preprocessImage, ImageValidationError } from './preprocess'
import { resolveFilename } from './filename'
import { appendHistory } from './history'
import { resolveSettings } from './settings'
import { getProvider, getProviderDisplayName } from '../providers'

const DEFAULT_TIMEOUT_MS = 30_000

export interface UploadOptions {
  /** The raw blob (file or clipboard image). */
  file: Blob
  /** Original filename. */
  filename: string
  /** Optional provider override (defaults to settings.defaultProvider). */
  providerId?: string
  /** Optional settings override; otherwise fetched from the host. */
  settings?: AllSettings
  /** Optional timeout override (ms). */
  timeoutMs?: number
  /** Optional progress callback. */
  onProgress?: (state: { loaded: number; total: number; percent: number }) => void
  /** Optional abort signal (caller-driven). */
  signal?: AbortSignal
}

export class UploadCancelledError extends Error {
  readonly name = 'UploadCancelledError'
  constructor(public readonly provider: string) {
    super(`${provider}: 上传已取消`)
  }
}

/**
 * Pull the latest settings from the host. We re-fetch (rather
 * than rely on a stale snapshot) so a user who tweaks their
 * settings mid-session sees the new values immediately.
 */
async function fetchSettings(
  getAllSettings: () => Promise<Record<string, unknown>>
): Promise<AllSettings> {
  try {
    const raw = await getAllSettings()
    return resolveSettings(raw)
  } catch (err) {
    console.warn('[picgo] fetchSettings failed, using defaults:', err)
    return resolveSettings({})
  }
}

/**
 * Combine caller-driven + internal AbortControllers. The
 * returned `dispose` MUST be called once the request settles
 * (success OR failure) to clear the timeout.
 */
function buildAbort(external: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController()
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    () => ctrl.abort(new Error('timeout')),
    timeoutMs
  )
  const onExternalAbort = () => ctrl.abort(external?.reason)
  if (external) {
    if (external.aborted) onExternalAbort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  const dispose = () => {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
  return { signal: ctrl.signal, dispose }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'UploadCancelledError'
}

/**
 * Run the upload pipeline. Returns the {@link UploadResult} on
 * success. Throws an `Error` whose `message` always starts with
 * the provider display name.
 */
export async function uploadImage(
  options: UploadOptions,
  ctx: {
    getAllSettings: () => Promise<Record<string, unknown>>
    store?: PluginStorage
  }
): Promise<UploadResult> {
  const settings = options.settings ?? (await fetchSettings(ctx.getAllSettings))
  const providerId = options.providerId ?? settings.defaultProvider
  const provider = getProvider(providerId)
  const displayName = getProviderDisplayName(providerId)

  // 1. Preprocess. The provider should only see clean blobs.
  const pre = await preprocessImage({
    file: options.file,
    filename: options.filename,
    uploadFormat: settings.uploadFormat satisfies UploadFormat,
    maxFileSizeMB: settings.maxFileSizeMB,
  }).catch((err: Error) => {
    if (err instanceof ImageValidationError) {
      throw new Error(`PicGo: ${err.message}`)
    }
    throw new Error(`PicGo: 预处理失败：${err.message}`)
  })

  // 2. Resolve remote filename.
  const remoteName = resolveFilename(pre.filename, settings.filenameStrategy)

  // 3. Upload.
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const { signal, dispose } = buildAbort(options.signal, timeoutMs)

  let result: UploadResult
  try {
    result = await provider.upload(
      pre.file,
      remoteName,
      settings,
      signal,
      options.onProgress
    )
  } catch (err) {
    if (isAbortError(err)) {
      throw new UploadCancelledError(displayName)
    }
    // Provider already returns a "Provider: reason" error; pass
    // it through so the toast can show the exact wording.
    if (err instanceof Error) {
      if (!err.message.startsWith(displayName)) {
        throw new Error(`${displayName}: ${err.message}`)
      }
      throw err
    }
    throw new Error(`${displayName}: ${String(err)}`)
  } finally {
    dispose()
  }

  // 4. Append history (best-effort — never let storage errors
  //    turn a successful upload into a failed one).
  if (settings.enableHistory && ctx.store) {
    try {
      await appendHistory(ctx.store, result, settings.historyRetention)
    } catch (err) {
      console.warn('[picgo] appendHistory failed:', err)
    }
  }

  return result
}
