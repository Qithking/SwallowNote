/**
 * Provider contract — every image host must implement this.
 *
 * `upload` is called by the uploader pipeline after the file has
 * been preprocessed (MIME / size / canvas re-encode). The provider
 * is responsible only for the network round-trip and parsing the
 * response into a canonical {@link UploadResult}.
 *
 * Errors thrown by `upload` MUST have a message prefixed with the
 * provider's display name (e.g. `SM.MS: rate limit exceeded`) so
 * the UI can show a clean toast.
 */
import type { AllSettings, UploadResult, UploadProgressHandler } from '../types'

export interface PicgoProvider {
  /** Stable id, matches the `ProviderId` union. */
  id: string
  /** Human-readable name for UI display. */
  displayName: string
  /**
   * Send the preprocessed `file` to the image host. `filename` has
   * already been resolved by the uploader's filename strategy.
   * `settings` is the full {@link AllSettings} snapshot.
   * `signal` is the per-upload AbortSignal; providers MUST wire it
   * into `fetch` so cancellation works.
   * `onProgress` is an optional hook for upload progress (fetch
   * doesn't expose upload progress, so most providers just ignore
   * it, but it's there for future use).
   */
  upload(
    file: Blob,
    filename: string,
    settings: AllSettings,
    signal: AbortSignal,
    onProgress?: UploadProgressHandler
  ): Promise<UploadResult>
}
