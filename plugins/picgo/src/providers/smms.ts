/**
 * SM.MS provider.
 *
 * - Endpoint: `POST https://sm.ms/api/v2/upload`
 * - Body: multipart/form-data, file field `smfile`
 * - Auth: optional `Authorization: <token>` (anonymous uploads
 *   are allowed but rate-limited)
 * - Response: `{ success, code, message, data: { url, ... } }`
 */
import type { AllSettings, UploadResult, UploadProgressHandler } from '../types'
import type { PicgoProvider } from './types'

const SMMS_ENDPOINT = 'https://sm.ms/api/v2/upload'

export const smmsProvider: PicgoProvider = {
  id: 'smms',
  displayName: 'SM.MS',
  async upload(
    file: Blob,
    filename: string,
    settings: AllSettings,
    signal: AbortSignal,
    onProgress?: UploadProgressHandler
  ): Promise<UploadResult> {
    const form = new FormData()
    form.append('smfile', file, filename)

    const headers: Record<string, string> = {}
    const token = settings.smmsToken?.trim()
    if (token) headers['Authorization'] = token

    let resp: Response
    try {
      resp = await fetch(SMMS_ENDPOINT, {
        method: 'POST',
        body: form,
        headers,
        signal,
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err
      throw new Error(`SM.MS: 网络错误：${(err as Error).message || 'fetch 失败'}`)
    }

    // SM.MS returns HTTP 200 for both success and most "soft"
    // failures (e.g. image_repeated, code: "image_too_large").
    let json: {
      success?: boolean
      code?: string
      message?: string
      data?: { url?: string; images?: string }
    }
    try {
      json = await resp.json()
    } catch (err) {
      throw new Error(`SM.MS: 响应解析失败：${(err as Error).message}`)
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('SM.MS: 鉴权失败，请检查 Token 设置')
    }
    if (!resp.ok) {
      throw new Error(`SM.MS: HTTP ${resp.status}${json.message ? ` ${json.message}` : ''}`)
    }

    if (!json.success) {
      // Common soft-fail codes: image_repeated, image_too_large, ...
      const code = json.code || 'unknown_error'
      const message = json.message || code
      throw new Error(`SM.MS: ${message}`)
    }

    const url = json.data?.url
    if (!url) {
      throw new Error('SM.MS: 响应中未包含 data.url')
    }

    onProgress?.({ loaded: file.size, total: file.size, percent: 100 })

    return {
      url,
      provider: 'smms',
      filename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      mime: file.type || undefined,
    }
  },
}
